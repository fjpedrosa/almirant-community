import type { AlmirantWorkerClient, WorkerInteraction } from "../../client/types";
import type { OutputEvent } from "../../core/events";
import { formatQuestionPrompt } from "./formatter";
import type {
  DiscordRichChannelAdapter,
  DiscordThreadReply,
} from "./types";

type PromptTarget = {
  sendPrompt: (
    sessionId: string,
    input: { prompt: string; metadata?: Record<string, unknown> }
  ) => Promise<unknown>;
};

type PendingQuestion = {
  question: string;
  options: string[];
};

type BidirectionalRelayConfig = {
  channelAdapter: Pick<DiscordRichChannelAdapter, "sendMessage" | "sendRichMessage">;
  runtime: PromptTarget;
  threadId: string;
  sessionId: string;
  workerClient: Pick<AlmirantWorkerClient, "createInteraction" | "pollInteraction">;
  jobId: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  optionsMergeWindowMs?: number;
  signal?: AbortSignal;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_OPTIONS_MERGE_WINDOW_MS = 250;

const wait = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const sanitizeResponse = (content: string, options: string[]): string => {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }

  const asNumber = Number.parseInt(trimmed, 10);
  if (!Number.isNaN(asNumber) && asNumber >= 1 && asNumber <= options.length) {
    return options[asNumber - 1] ?? trimmed;
  }

  return trimmed;
};

export class BidirectionalRelay {
  private readonly config: BidirectionalRelayConfig;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly queue: PendingQuestion[] = [];
  private readonly abortController = new AbortController();
  private readonly onExternalAbort: (() => void) | null;
  private processing = false;
  private processingPromise: Promise<void> | null = null;
  private stopped = false;

  constructor(config: BidirectionalRelayConfig) {
    this.config = config;
    this.now = config.now ?? (() => Date.now());
    this.sleep = config.sleep ?? wait;
    this.onExternalAbort = config.signal
      ? () => {
          this.stopped = true;
          this.abortController.abort(config.signal?.reason);
        }
      : null;
    if (config.signal?.aborted) {
      this.onExternalAbort?.();
    } else if (this.onExternalAbort) {
      config.signal?.addEventListener(
        "abort",
        this.onExternalAbort,
        { once: true },
      );
    }
  }

  public async stop(): Promise<void> {
    this.stopped = true;
    this.queue.length = 0;
    this.config.signal?.removeEventListener(
      "abort",
      this.onExternalAbort ?? (() => undefined),
    );
    if (!this.abortController.signal.aborted) {
      this.abortController.abort(new Error("bidirectional relay stopped"));
    }
    await this.processingPromise?.catch(() => undefined);
  }

  private assertActive(): void {
    if (this.stopped || this.abortController.signal.aborted) {
      throw this.abortController.signal.reason ??
        new Error("bidirectional relay stopped");
    }
  }

  private async runAbortable<T>(operation: Promise<T>): Promise<T> {
    operation.catch(() => undefined);
    const signal = this.abortController.signal;
    if (signal.aborted) {
      throw signal.reason;
    }
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      return await Promise.race([operation, aborted]);
    } finally {
      if (onAbort) signal.removeEventListener("abort", onAbort);
    }
  }

  public async handleOutputEvent(event: OutputEvent): Promise<void> {
    if (this.stopped) {
      return;
    }

    if (event.type === "question") {
      this.queue.push({ question: event.text, options: [] });
      if (!this.processingPromise) {
        let processing!: Promise<void>;
        processing = this.drainQueue().finally(() => {
          if (this.processingPromise === processing) {
            this.processingPromise = null;
          }
        });
        this.processingPromise = processing;
        void processing.catch(() => undefined);
      }
      return;
    }

    if (event.type === "options") {
      const current = this.queue[this.queue.length - 1];
      if (current && current.options.length === 0) {
        current.options = [...event.options];
      }
      return;
    }
  }

  private async drainQueue(): Promise<void> {
    if (this.processing) {
      return;
    }

    this.processing = true;

    try {
      while (!this.stopped && this.queue.length > 0) {
        const mergeWindowMs =
          this.config.optionsMergeWindowMs ?? DEFAULT_OPTIONS_MERGE_WINDOW_MS;
        if (mergeWindowMs > 0) {
          await this.runAbortable(this.sleep(mergeWindowMs));
        }

        this.assertActive();
        const item = this.queue.shift();
        if (!item) break;

        await this.processQuestion(item);
      }
    } finally {
      this.processing = false;
    }
  }

  private async processQuestion(question: PendingQuestion): Promise<void> {
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const interaction = await this.createWorkerInteraction(question, timeoutMs);
    this.assertActive();

    await this.runAbortable(
      this.config.channelAdapter.sendRichMessage(
        this.config.threadId,
        formatQuestionPrompt({
          question: question.question,
          options: question.options,
          jobId: this.config.jobId,
          interactionId: interaction?.id,
        }),
      ),
    );

    const reply = interaction
      ? await this.waitForInteractionReply(interaction, timeoutMs)
      : null;

    if (!reply) {
      this.assertActive();
      await this.runAbortable(
        this.config.channelAdapter.sendMessage(
          this.config.threadId,
          "No response received before timeout. The agent will continue.",
        ),
      );
      return;
    }

    const normalized = sanitizeResponse(reply.content, question.options);
    if (normalized.length === 0) {
      return;
    }

    this.assertActive();
    await this.runAbortable(
      this.config.runtime.sendPrompt(this.config.sessionId, {
        prompt: normalized,
        metadata: {
          source: "discord",
          threadId: this.config.threadId,
          messageId: reply.messageId,
          userId: reply.userId,
        },
      }),
    );

    this.assertActive();
    await this.runAbortable(
      this.config.channelAdapter.sendMessage(
        this.config.threadId,
        `Response relayed to agent: ${normalized}`,
      ),
    );
  }

  private async createWorkerInteraction(
    question: PendingQuestion,
    timeoutMs: number
  ): Promise<WorkerInteraction | null> {
    try {
      const expiresAt = new Date(this.now() + timeoutMs).toISOString();
      return await this.runAbortable(
        this.config.workerClient.createInteraction(
          this.config.jobId,
          {
            questionType: question.options.length > 0 ? "choice" : "clarification",
            questionText: question.question,
            options: question.options.length > 0 ? question.options : undefined,
            expiresAt,
            timeoutAction: "skip",
          },
          {
            signal: this.abortController.signal,
            timeoutMs,
          },
        ),
      );
    } catch {
      return null;
    }
  }

  private async waitForInteractionReply(
    interaction: WorkerInteraction,
    timeoutMs: number
  ): Promise<DiscordThreadReply | null> {
    const pollIntervalMs = this.config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const deadline = this.now() + timeoutMs;

    while (this.now() < deadline) {
      if (this.stopped || this.abortController.signal.aborted) return null;
      try {
        const current = await this.runAbortable(
          this.config.workerClient.pollInteraction(
            this.config.jobId,
            interaction.id,
            {
              signal: this.abortController.signal,
              timeoutMs: Math.min(timeoutMs, 30_000),
            },
          ),
        );

        if (
          current.status === "answered" &&
          typeof current.response === "string" &&
          current.response.trim().length > 0
        ) {
          return {
            threadId: this.config.threadId,
            messageId: `interaction-${interaction.id}`,
            userId: "worker-interaction",
            content: current.response,
            createdAt: new Date().toISOString(),
          };
        }

        if (current.status === "timeout" || current.status === "cancelled") {
          return null;
        }
      } catch {
        if (this.stopped || this.abortController.signal.aborted) return null;
        // Best-effort polling -- retry on transient errors.
      }

      await this.runAbortable(this.sleep(pollIntervalMs));
    }

    return null;
  }
}

export const createBidirectionalRelay = (
  config: BidirectionalRelayConfig
): BidirectionalRelay => {
  return new BidirectionalRelay(config);
};
