import type { AlmirantWorkerClient, UpdateJobStatusPayload } from "../client/types";
import { SessionState, transitionSessionState } from "../core/state";
import type {
  ChannelAdapter,
  OutputStreamRouter,
  OutputStreamRouterOptions,
  OutputStreamRouterResult,
} from "../core/types";
import type { RawOutputEvent } from "../core/events";
import type { StreamPublisher, AgentOutputEvent } from "@almirant/stream-consumer";
import { createThrottleController } from "./throttle";

const DEFAULT_MAX_BUFFER_CHARS = 200_000;
const DEFAULT_STAGNANT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_EDIT_THROTTLE_MS = 1000;

const renderBuffer = (buffer: string): string => {
  const content = buffer.length > 0 ? buffer : "(waiting for output...)";
  return `\`\`\`text\n${content}\n\`\`\``;
};

async function* streamLines(
  stream: ReadableStream<Uint8Array | string>
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let carry = "";
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = typeof value === "string" ? value : decoder.decode(value, { stream: true });
      carry += text;
      let separatorIndex = carry.indexOf("\n");
      while (separatorIndex >= 0) {
        const line = carry.slice(0, separatorIndex);
        carry = carry.slice(separatorIndex + 1);
        yield line;
        separatorIndex = carry.indexOf("\n");
      }
    }
  } finally {
    reader.releaseLock();
  }

  const finalChunk = carry + decoder.decode();
  if (finalChunk.length > 0) {
    yield finalChunk;
  }
}

// ---------------------------------------------------------------------------
// Stream event mapping
// ---------------------------------------------------------------------------

const sessionSequences = new Map<string, number>();

const nextSequence = (sessionId: string): number => {
  const current = sessionSequences.get(sessionId) ?? 0;
  const next = current + 1;
  sessionSequences.set(sessionId, next);
  return next;
};

const toStreamEvent = (
  event: RawOutputEvent,
  jobId: string,
  threadId: string,
  sessionId: string,
  workspaceId: string,
): AgentOutputEvent => ({
  jobId,
  sessionId,
  workspaceId,
  threadId,
  timestamp: Date.now(),
  sequenceNumber: nextSequence(sessionId),
  type: "message",
  content: event.line,
});

// ---------------------------------------------------------------------------
// RouterConfig
// ---------------------------------------------------------------------------

type RouterConfig = {
  channelAdapter: Pick<ChannelAdapter, "sendMessage" | "editMessage">;
  workerClient?: Pick<AlmirantWorkerClient, "updateJobStatus">;
  streamPublisher?: StreamPublisher;
  onEvent?: (event: RawOutputEvent) => void | Promise<void>;
  now?: () => number;
};

class RemoteOutputStreamRouter implements OutputStreamRouter {
  private state: SessionState = SessionState.IDLE;
  private readonly channelAdapter: Pick<ChannelAdapter, "sendMessage" | "editMessage">;
  private readonly workerClient?: Pick<AlmirantWorkerClient, "updateJobStatus">;
  private readonly streamPublisher?: StreamPublisher;
  private readonly onEvent?: (event: RawOutputEvent) => void | Promise<void>;
  private readonly now: () => number;
  private stopped = false;

  constructor(config: RouterConfig) {
    this.channelAdapter = config.channelAdapter;
    this.workerClient = config.workerClient;
    this.streamPublisher = config.streamPublisher;
    this.onEvent = config.onEvent;
    this.now = config.now ?? (() => Date.now());
  }

  public getState(): SessionState {
    return this.state;
  }

  public async stop(): Promise<void> {
    this.stopped = true;
    await this.streamPublisher?.close();
  }

  public async consume(
    stream: ReadableStream<Uint8Array | string>,
    options: OutputStreamRouterOptions
  ): Promise<OutputStreamRouterResult> {
    const maxBufferChars = options.maxBufferChars ?? DEFAULT_MAX_BUFFER_CHARS;
    const stagnantTimeoutMs = options.stagnantTimeoutMs ?? DEFAULT_STAGNANT_TIMEOUT_MS;
    const editThrottleMs = options.messageEditThrottleMs ?? DEFAULT_EDIT_THROTTLE_MS;

    let bytesProcessed = 0;
    let linesProcessed = 0;
    let buffer = "";
    let lastMessageId: string | undefined;
    let lastOutputAt = this.now();
    let stagnationInterval: ReturnType<typeof setInterval> | null = null;

    const updateJobStatus = async (payload: UpdateJobStatusPayload): Promise<void> => {
      if (!this.workerClient || !options.jobId) return;
      await this.workerClient.updateJobStatus(options.jobId, payload);
    };

    const setState = (next: SessionState): void => {
      if (this.state === next) return;
      this.state = transitionSessionState(this.state, next);
    };

    const ensureMessage = async (): Promise<string> => {
      if (lastMessageId) return lastMessageId;
      const message = await this.channelAdapter.sendMessage(
        options.threadId,
        renderBuffer(buffer)
      );
      lastMessageId = message.id;
      return message.id;
    };

    const editor = createThrottleController(async (content) => {
      const messageId = await ensureMessage();
      await this.channelAdapter.editMessage(options.threadId, messageId, renderBuffer(content));
    }, editThrottleMs);

    const appendToBuffer = (line: string): void => {
      const next = `${buffer}${line}${line.endsWith("\n") ? "" : "\n"}`;
      if (next.length <= maxBufferChars) {
        buffer = next;
        return;
      }
      buffer = next.slice(next.length - maxBufferChars);
    };

    const publishToStream = async (event: RawOutputEvent): Promise<void> => {
      if (!this.streamPublisher || !options.jobId) return;
      const streamEvent = toStreamEvent(
        event,
        options.jobId,
        options.threadId,
        options.sessionId ?? "",
        options.workspaceId ?? "",
      );
      await this.streamPublisher.publish(streamEvent);
    };

    const handleEvent = async (event: RawOutputEvent): Promise<void> => {
      if (this.onEvent) {
        await this.onEvent(event);
      }

      appendToBuffer(event.line);
      editor.schedule(buffer);

      // Publish to Redis Stream as a secondary sink (fire-and-forget with error swallowing).
      await publishToStream(event).catch(() => undefined);
    };

    try {
      setState(SessionState.ACTIVE);
      await updateJobStatus({ status: "running" });

      stagnationInterval = setInterval(() => {
        if (this.state !== SessionState.ACTIVE) return;
        if (this.now() - lastOutputAt <= stagnantTimeoutMs) return;

        try {
          setState(SessionState.STAGNANT);
        } catch {
          // Ignore invalid transitions from terminal states.
        }
      }, 1000);

      for await (const line of streamLines(stream)) {
        if (this.stopped) break;

        bytesProcessed += line.length;
        linesProcessed += 1;
        lastOutputAt = this.now();

        if (this.state === SessionState.STAGNANT) {
          setState(SessionState.ACTIVE);
        }

        await handleEvent({ type: "raw", line });
      }

      await editor.flush();

      if (this.state !== SessionState.COMPLETED && this.state !== SessionState.FAILED) {
        setState(SessionState.COMPLETED);
        await updateJobStatus({ status: "completed" });
      }
    } catch (error) {
      if (this.state !== SessionState.FAILED) {
        setState(SessionState.FAILED);
      }
      await updateJobStatus({
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      if (stagnationInterval) {
        clearInterval(stagnationInterval);
      }
      await editor.stop();
    }

    return {
      state: this.state,
      bytesProcessed,
      linesProcessed,
      lastMessageId,
    };
  }
}

export const createOutputStreamRouter = (
  config: RouterConfig
): OutputStreamRouter => {
  return new RemoteOutputStreamRouter(config);
};
