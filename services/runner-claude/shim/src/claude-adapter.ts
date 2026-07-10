import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import type {
  PromptRequest,
  RuntimeAdapter,
  RuntimeEventListener,
  SessionCreateInput,
  SessionCreateResponse,
  SSEEvent,
} from "@almirant/shim-server";
import { mapClaudeEventToSse } from "./event-mapper.js";

type ClaudeSessionState = {
  session: SessionCreateResponse;
  process: ChildProcess | null;
  fullText: string;
  hasFinalSnapshot: boolean;
  interactive: boolean;
  /**
   * When true, the agent called AskUserQuestion which was auto-resolved by
   * --dangerously-skip-permissions. A synthetic session.idle has been emitted
   * so the runner can wait for the user's answer. All subsequent output from
   * the current turn is suppressed until the natural turn end (result event).
   */
  waitingForInput: boolean;
};

const collectLines = (
  data: string,
  carry: string
): { lines: string[]; carry: string } => {
  const combined = `${carry}${data}`;
  const chunks = combined.split(/\r?\n/);
  const nextCarry = chunks.pop() ?? "";
  return {
    lines: chunks.map((line) => line.trim()).filter((line) => line.length > 0),
    carry: nextCarry,
  };
};

const promptTextFromRequest = (request: PromptRequest): string => {
  return request.parts.map((part) => part.text).join("\n").trim();
};

const normalizeClaudeEffortLevel = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["low", "medium", "high", "xhigh", "max"].includes(normalized)) {
    return normalized;
  }
  if (normalized === "min" || normalized === "minimal" || normalized === "none") {
    return "low";
  }
  return undefined;
};

// Some models reject the `--effort` flag at the API level. Claude Haiku 4.5
// does not support reasoning effort, so the flag must be dropped for it.
// Family match so dated/snapshot ids are covered too.
const MODELS_WITHOUT_EFFORT = /haiku/i;

/** CLI effort level for a model, or undefined when it must not be sent. */
export const resolveClaudeEffortLevel = (
  model: string | undefined,
  rawBudget: string | undefined,
): string | undefined => {
  const level = normalizeClaudeEffortLevel(rawBudget);
  if (!level) return undefined;
  if (model && MODELS_WITHOUT_EFFORT.test(model)) return undefined;
  return level;
};

export class ClaudeAdapter implements RuntimeAdapter {
  private readonly sessions = new Map<string, ClaudeSessionState>();
  private readonly listeners = new Set<RuntimeEventListener>();

  public onEvent(listener: RuntimeEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public async createSession(
    input: SessionCreateInput
  ): Promise<SessionCreateResponse> {
    const now = new Date().toISOString();
    const session: SessionCreateResponse = {
      id: randomUUID(),
      cwd: input.cwd,
      model: input.model,
      provider: input.provider ?? "anthropic",
      status: "idle",
      createdAt: now,
      updatedAt: now,
      metadata: input.metadata,
    };

    this.sessions.set(session.id, {
      session,
      process: null,
      fullText: "",
      hasFinalSnapshot: false,
      interactive: !!input.metadata?.interactive,
      waitingForInput: false,
    });

    return session;
  }

  public async listSessions(): Promise<SessionCreateResponse[]> {
    return Array.from(this.sessions.values()).map((entry) => entry.session);
  }

  public async getSession(
    sessionId: string
  ): Promise<SessionCreateResponse | null> {
    return this.sessions.get(sessionId)?.session ?? null;
  }

  public async deleteSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    if (session.process && !session.process.killed) {
      session.process.kill("SIGTERM");
    }

    this.sessions.delete(sessionId);
    return true;
  }

  public async sendPrompt(
    sessionId: string,
    request: PromptRequest
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }

    const prompt = promptTextFromRequest(request);
    if (!prompt) {
      return;
    }

    if (session.interactive) {
      this.sendInteractivePrompt(sessionId, session, prompt);
    } else {
      this.sendPrintPrompt(sessionId, session, prompt);
    }
  }

  /**
   * Print mode (-p): spawns a fresh process per prompt, stdin ignored.
   * Used for implement/validate/document jobs.
   */
  private sendPrintPrompt(
    sessionId: string,
    session: ClaudeSessionState,
    prompt: string
  ): void {
    if (session.process && !session.process.killed) {
      session.process.kill("SIGTERM");
      session.process = null;
    }

    session.fullText = "";
    session.hasFinalSnapshot = false;

    this.emit({
      type: "session.status",
      properties: {
        sessionId,
        status: "running",
      },
    });

    const model = session.session.model;
    const effortLevel = resolveClaudeEffortLevel(model, process.env.REASONING_BUDGET);
    const args = [
      "-p",
      prompt,
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--verbose",
      "--dangerously-skip-permissions",
      ...(model ? ["--model", model] : []),
      ...(effortLevel ? ["--effort", effortLevel] : []),
    ];

    const proc = spawn("claude", args, {
      cwd: session.session.cwd ?? "/workspace",
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    session.process = proc;

    let stdoutCarry = "";
    proc.stdout?.setEncoding("utf-8");
    proc.stdout?.on("data", (chunk: string) => {
      const { lines, carry } = collectLines(chunk, stdoutCarry);
      stdoutCarry = carry;

      for (const line of lines) {
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(line) as Record<string, unknown>;
        } catch {
          session.fullText += `${line}\n`;
          this.emit({
            type: "message.part.delta",
            properties: {
              sessionId,
              delta: `${line}\n`,
            },
          });
          continue;
        }

        const mapped = mapClaudeEventToSse(sessionId, parsed);

        if (mapped.deltaText) {
          session.fullText += mapped.deltaText;
        }
        if (mapped.snapshotText) {
          session.fullText = mapped.snapshotText;
          session.hasFinalSnapshot = true;
        }
        mapped.events.forEach((event) => {
          // Log emitted SSE events for debugging
          const ct = (event.properties as Record<string, unknown>)?.contentType;
          const evtDetail = ct === "tool_use"
            ? `contentType=tool_use delta=${String((event.properties as Record<string, unknown>)?.delta ?? "").slice(0, 120)}`
            : ct ? `contentType=${ct}` : "";
          console.log(`[shim-events] ${new Date().toISOString().slice(11, 23)} OUT ${event.type} | ${evtDetail}`);
          this.emit(event);
        });
      }
    });

    proc.stderr?.setEncoding("utf-8");
    proc.stderr?.on("data", (chunk: string) => {
      const message = chunk.trim();
      if (!message) {
        return;
      }

      this.emit({
        type: "session.status",
        properties: {
          sessionId,
          status: "stderr",
          message,
        },
      });
    });

    proc.on("error", (error) => {
      this.emit({
        type: "session.status",
        properties: {
          sessionId,
          status: "error",
          message: error.message,
        },
      });
      this.emit({
        type: "session.idle",
        properties: { sessionId },
      });
    });

    proc.on("close", () => {
      if (stdoutCarry.trim().length > 0) {
        session.fullText += stdoutCarry;
      }

      if (session.fullText.length > 0 && !session.hasFinalSnapshot) {
        this.emit({
          type: "message.part.updated",
          properties: {
            sessionId,
            part: {
              text: session.fullText,
            },
          },
        });
      }

      session.process = null;
      session.session.updatedAt = new Date().toISOString();
      session.session.status = "idle";

      this.emit({
        type: "session.idle",
        properties: { sessionId },
      });
    });
  }

  /**
   * Interactive mode (--input-format stream-json): keeps a persistent process
   * alive across multiple turns. Used for planning/ideation jobs.
   */
  private sendInteractivePrompt(
    sessionId: string,
    session: ClaudeSessionState,
    prompt: string
  ): void {
    const ndjsonMessage = JSON.stringify({
      type: "user",
      message: { role: "user", content: prompt },
    });

    // Subsequent turn: process is already alive — write to stdin
    if (session.process && !session.process.killed) {
      // If we were suppressing output while waiting for user input
      // (AskUserQuestion auto-resolve), the process may still be mid-turn.
      // We need to wait for the current turn to finish before sending the
      // user's answer. If waitingForInput is true, the natural turn end
      // hasn't arrived yet — defer the prompt until the turn completes.
      if (session.waitingForInput) {
        console.log(`[shim] Session ${sessionId} still waiting for current turn to finish — deferring prompt`);
        const waitForTurnEnd = (): Promise<void> => {
          return new Promise((resolve) => {
            const check = (): void => {
              if (!session.waitingForInput) {
                resolve();
              } else {
                setTimeout(check, 100);
              }
            };
            check();
          });
        };
        waitForTurnEnd().then(() => {
          session.fullText = "";
          session.hasFinalSnapshot = false;
          session.waitingForInput = false;

          this.emit({
            type: "session.status",
            properties: { sessionId, status: "running" },
          });

          session.process?.stdin?.write(`${ndjsonMessage}\n`);
        });
        return;
      }

      session.fullText = "";
      session.hasFinalSnapshot = false;

      this.emit({
        type: "session.status",
        properties: { sessionId, status: "running" },
      });

      session.process.stdin?.write(`${ndjsonMessage}\n`);
      return;
    }

    // First turn: spawn the persistent process
    session.fullText = "";
    session.hasFinalSnapshot = false;

    this.emit({
      type: "session.status",
      properties: { sessionId, status: "running" },
    });

    const model = session.session.model;
    const effortLevel = resolveClaudeEffortLevel(model, process.env.REASONING_BUDGET);
    const args = [
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--verbose",
      "--dangerously-skip-permissions",
      ...(model ? ["--model", model] : []),
      ...(effortLevel ? ["--effort", effortLevel] : []),
    ];

    const proc = spawn("claude", args, {
      cwd: session.session.cwd ?? "/workspace",
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    session.process = proc;

    // Send the first user message
    proc.stdin?.write(`${ndjsonMessage}\n`);

    let stdoutCarry = "";
    proc.stdout?.setEncoding("utf-8");
    proc.stdout?.on("data", (chunk: string) => {
      const { lines, carry } = collectLines(chunk, stdoutCarry);
      stdoutCarry = carry;

      for (const line of lines) {
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(line) as Record<string, unknown>;
        } catch {
          // Non-JSON output: only emit if not suppressed
          if (!session.waitingForInput) {
            session.fullText += `${line}\n`;
            this.emit({
              type: "message.part.delta",
              properties: { sessionId, delta: `${line}\n` },
            });
          }
          continue;
        }

        const mapped = mapClaudeEventToSse(sessionId, parsed);

        if (mapped.deltaText) {
          session.fullText += mapped.deltaText;
        }

        // --- AskUserQuestion pause: when the agent calls AskUserQuestion and
        // --dangerously-skip-permissions auto-resolves it, we need to pause the
        // event stream so the runner can wait for the user's real answer. ---
        if (mapped.requiresInput && session.interactive) {
          // Emit the question.asked event(s) so the runner knows to wait
          mapped.events.forEach((event) => {
            const ct = (event.properties as Record<string, unknown>)?.contentType;
            const evtDetail = ct ? `contentType=${ct}` : "";
            console.log(`[shim-events] ${new Date().toISOString().slice(11, 23)} OUT ${event.type} | ${evtDetail}`);
            this.emit(event);
          });

          // Set the suppression flag — all subsequent output until the natural
          // turn end will be silently consumed
          session.waitingForInput = true;
          console.log(`[shim] Session ${sessionId} AskUserQuestion detected — suppressing output until turn end, emitting synthetic session.idle`);

          // Emit synthetic session.idle so the runner starts waiting for user input
          session.session.updatedAt = new Date().toISOString();
          session.session.status = "idle";
          console.log(`[shim-events] ${new Date().toISOString().slice(11, 23)} OUT session.idle (synthetic, waiting for user input)`);
          this.emit({
            type: "session.idle",
            properties: { sessionId },
          });
          continue;
        }

        // --- While suppressed (waitingForInput), silently consume events ---
        if (session.waitingForInput) {
          if (mapped.snapshotText !== undefined) {
            // Natural turn end arrived — clear the suppression flag.
            // The process is now idle and ready for the next user message.
            session.hasFinalSnapshot = true;
            if (mapped.snapshotText) {
              session.fullText = mapped.snapshotText;
            }
            session.waitingForInput = false;
            session.session.updatedAt = new Date().toISOString();
            session.session.status = "idle";
            console.log(`[shim] Session ${sessionId} natural turn end during input wait — suppression cleared, process ready for next prompt`);
          } else {
            // Suppress — log for debugging but don't emit
            const suppressedTypes = mapped.events.map((e) => e.type).join(", ");
            if (suppressedTypes) {
              console.log(`[shim-events] ${new Date().toISOString().slice(11, 23)} SUPPRESSED ${suppressedTypes} (waiting for user input)`);
            }
          }
          continue;
        }

        if (mapped.snapshotText !== undefined) {
          if (mapped.snapshotText) {
            session.fullText = mapped.snapshotText;
          }
          session.hasFinalSnapshot = true;

          // Turn complete — emit idle but keep process alive
          mapped.events.forEach((event) => {
            const ct = (event.properties as Record<string, unknown>)?.contentType;
            const evtDetail = ct === "tool_use"
              ? `contentType=tool_use delta=${String((event.properties as Record<string, unknown>)?.delta ?? "").slice(0, 120)}`
              : ct ? `contentType=${ct}` : "";
            console.log(`[shim-events] ${new Date().toISOString().slice(11, 23)} OUT ${event.type} | ${evtDetail}`);
            this.emit(event);
          });
          session.session.updatedAt = new Date().toISOString();
          session.session.status = "idle";
          console.log(`[shim-events] ${new Date().toISOString().slice(11, 23)} OUT session.idle`);
          this.emit({
            type: "session.idle",
            properties: { sessionId },
          });
          continue;
        }

        mapped.events.forEach((event) => {
          const ct = (event.properties as Record<string, unknown>)?.contentType;
          const evtDetail = ct === "tool_use"
            ? `contentType=tool_use delta=${String((event.properties as Record<string, unknown>)?.delta ?? "").slice(0, 120)}`
            : ct ? `contentType=${ct}` : "";
          console.log(`[shim-events] ${new Date().toISOString().slice(11, 23)} OUT ${event.type} | ${evtDetail}`);
          this.emit(event);
        });
      }
    });

    proc.stderr?.setEncoding("utf-8");
    proc.stderr?.on("data", (chunk: string) => {
      const message = chunk.trim();
      if (!message) return;

      this.emit({
        type: "session.status",
        properties: { sessionId, status: "stderr", message },
      });
    });

    proc.on("close", () => {
      if (stdoutCarry.trim().length > 0) {
        session.fullText += stdoutCarry;
      }

      // Clear waitingForInput so any deferred prompt resolves
      // (prevents hanging if the process exits unexpectedly)
      if (session.waitingForInput) {
        console.log(`[shim] Session ${sessionId} process closed while waiting for input — clearing suppression`);
        session.waitingForInput = false;
      }

      if (session.fullText.length > 0 && !session.hasFinalSnapshot) {
        this.emit({
          type: "message.part.updated",
          properties: {
            sessionId,
            part: { text: session.fullText },
          },
        });
      }

      session.process = null;
      session.session.updatedAt = new Date().toISOString();
      session.session.status = "idle";

      this.emit({
        type: "session.idle",
        properties: { sessionId },
      });
    });

    proc.on("error", (error) => {
      this.emit({
        type: "session.status",
        properties: { sessionId, status: "error", message: error.message },
      });
      this.emit({
        type: "session.idle",
        properties: { sessionId },
      });
    });
  }

  private emit(event: SSEEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
