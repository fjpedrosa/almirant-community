import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import type {
  CanonicalEvent as ShimCanonicalEvent,
  CanonicalEventListener,
  NativeEventListener,
  NativeRuntimeEvent,
  PromptRequest,
  RuntimeAdapter,
  RuntimeEventListener,
  SessionCreateInput,
  SessionCreateResponse,
  SSEEvent,
} from "@almirant/shim-server";
import { Codex, type ModelReasoningEffort, type Thread, type ThreadOptions } from "@openai/codex-sdk";
import {
  mapCodexEventToSse,
  type CodexMappingContext,
} from "./event-mapper.js";
import {
  mapCodexToCanonical,
  type CodexCanonicalEvent,
  type CodexCanonicalMappingContext,
} from "./canonical-mapper.js";

type CodexSessionState = {
  session: SessionCreateResponse;
  thread: Thread | null;
  mappingContext: CodexMappingContext;
  canonicalContext: CodexCanonicalMappingContext;
  running: boolean;
};

/**
 * Canonical event kinds that represent tool activity — emitted via onCanonicalEvent.
 *
 * `agent.subagent.spawn`/`complete` are listed defensively: the current
 * @openai/codex-sdk does not surface a subagent primitive, but if a future
 * version (or a custom Codex deployment with a Task-equivalent MCP tool) starts
 * emitting them, the adapter must NOT silently drop them.
 */
export const TOOL_CANONICAL_KINDS = new Set([
  "agent.tool_call.start",
  "agent.tool_call.result",
  "agent.bash.execute",
  "agent.bash.output",
  "agent.file.read",
  "agent.file.write",
  "agent.file.edit",
  "agent.subagent.spawn",
  "agent.subagent.complete",
]);

const promptTextFromRequest = (request: PromptRequest): string => {
  return request.parts.map((part) => part.text).join("\n").trim();
};

const normalizeDecision = (rawPrompt: string): "allow" | "deny" => {
  const prompt = rawPrompt.trim().toLowerCase();
  if (prompt === "deny" || prompt === "no" || prompt === "reject") {
    return "deny";
  }
  return "allow";
};

const normalizeCodexReasoningEffort = (value: string | undefined): ModelReasoningEffort | undefined => {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["minimal", "low", "medium", "high", "xhigh"].includes(normalized)) {
    return normalized as ModelReasoningEffort;
  }
  if (normalized === "none" || normalized === "min") return "minimal";
  if (normalized === "max") return "xhigh";
  return undefined;
};

export class CodexAdapter implements RuntimeAdapter {
  private readonly sessions = new Map<string, CodexSessionState>();
  private readonly listeners = new Set<RuntimeEventListener>();
  private readonly canonicalListeners = new Set<CanonicalEventListener>();
  private readonly nativeListeners = new Set<NativeEventListener>();
  private readonly codexClientPromise: Promise<Codex>;

  constructor() {
    this.codexClientPromise = this.createClient();
  }

  public onEvent(listener: RuntimeEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public onCanonicalEvent(listener: CanonicalEventListener): () => void {
    this.canonicalListeners.add(listener);
    return () => {
      this.canonicalListeners.delete(listener);
    };
  }

  public onNativeEvent(listener: NativeEventListener): () => void {
    this.nativeListeners.add(listener);
    return () => {
      this.nativeListeners.delete(listener);
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
      provider: input.provider ?? "openai",
      status: "idle",
      createdAt: now,
      updatedAt: now,
      metadata: input.metadata,
    };

    this.sessions.set(session.id, {
      session,
      thread: null,
      mappingContext: {
        messageSnapshots: new Map<string, string>(),
      },
      canonicalContext: {
        messageSnapshots: new Map<string, string>(),
        emittedToolCallIds: new Set<string>(),
      },
      running: false,
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
    return this.sessions.delete(sessionId);
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

    if (session.running) {
      throw new Error(`Session ${sessionId} is already running`);
    }

    const thread = await this.ensureThread(session);

    session.running = true;
    session.mappingContext.messageSnapshots.clear();
    session.canonicalContext.messageSnapshots.clear();
    session.canonicalContext.emittedToolCallIds.clear();

    this.emit({
      type: "session.status",
      properties: {
        sessionId,
        status: "running",
      },
    });

    let emittedTerminalIdle = false;

    try {
      console.log(`[codex-adapter] runStreamed: prompt=${prompt.length}chars, model=${session.session.model}`);
      const { events } = await thread.runStreamed(prompt);
      let eventCount = 0;
      for await (const rawEvent of events) {
        eventCount++;
        const ep = rawEvent as Record<string, unknown>;
        const etype = ep.type ?? ep.event ?? "?";
        console.log(`[codex-adapter] event#${eventCount}: ${etype}`);
        if (etype === "error" || etype === "turn.failed") {
          console.error(`[codex-adapter] ERROR_EVENT: ${JSON.stringify(ep).slice(0, 500)}`);
        }

        // Emit raw native event for source-of-truth diagnostics. This runs
        // before any mapping so parser bugs can be debugged after the fact
        // (parity with opencode-adapter).
        this.emitNative({
          nativeEventType: typeof etype === "string" ? etype : String(etype),
          sourceFormat: "codex-sdk",
          runtimeSessionId: sessionId,
          codingAgent: "codex",
          payload: ep,
        });

        const mapped = mapCodexEventToSse(
          sessionId,
          ep,
          session.mappingContext
        );

        for (const sseEvent of mapped.events) {
          if (sseEvent.type === "question.asked") {
            await this.respondToApproval(session, normalizeDecision("allow"));
          }
          if (sseEvent.type === "session.idle") {
            emittedTerminalIdle = true;
          }
          this.emit(sseEvent);
        }

        // Emit tool-related canonical events in parallel with SSE events.
        // The SSE path handles text/thinking/session lifecycle, while this
        // provides structured tool_call visibility for the frontend.
        const canonical = mapCodexToCanonical(
          sessionId,
          ep,
          session.canonicalContext,
        );
        for (const ce of canonical.events) {
          if (TOOL_CANONICAL_KINDS.has(ce.kind)) {
            this.emitCanonical(ce);
          }
        }

        if (mapped.terminal) {
          console.log(`[codex-adapter] terminal after ${eventCount} events`);
          break;
        }
      }
      console.log(`[codex-adapter] stream done, total=${eventCount} events`);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack : undefined;
      console.error(`[codex-adapter] CATCH ERROR: ${errMsg}`);
      if (errStack) console.error(`[codex-adapter] STACK: ${errStack}`);
      this.emit({
        type: "session.status",
        properties: {
          sessionId,
          status: "error",
          message: errMsg,
        },
      });
    } finally {
      session.running = false;
      session.session.status = "idle";
      session.session.updatedAt = new Date().toISOString();
      if (!emittedTerminalIdle) {
        this.emit({
          type: "session.idle",
          properties: { sessionId },
        });
      }
    }
  }

  private async createClient(): Promise<Codex> {
    const baseUrlOpts = process.env.OPENAI_BASE_URL
      ? { baseUrl: process.env.OPENAI_BASE_URL }
      : {};

    // Prefer auth.json when present — it contains native Codex credentials
    // (subscription tokens) with the correct scopes (api.responses.write).
    // OPENAI_API_KEY may be a subscription JWT that lacks this scope.
    const authJsonPath = join(os.homedir(), ".codex", "auth.json");
    if (existsSync(authJsonPath)) {
      console.log(`[codex-adapter] Creating Codex client from ~/.codex/auth.json`);
      return new Codex({ ...baseUrlOpts });
    }

    // Fallback: use OPENAI_API_KEY (direct API key, not subscription).
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      const prefix = apiKey.slice(0, 10);
      console.log(`[codex-adapter] Creating Codex client with key: ${prefix}...`);
      return new Codex({ apiKey, ...baseUrlOpts });
    }

    throw new Error("No ~/.codex/auth.json or OPENAI_API_KEY found for CodexAdapter");
  }

  private getThreadOptions(session: CodexSessionState): ThreadOptions {
    return {
      model: session.session.model,
      modelReasoningEffort: normalizeCodexReasoningEffort(process.env.REASONING_BUDGET),
      approvalPolicy: "never",
      sandboxMode: "danger-full-access",
      workingDirectory: session.session.cwd ?? "/workspace",
      skipGitRepoCheck: true,
    };
  }

  private async ensureThread(session: CodexSessionState): Promise<Thread> {
    if (session.thread) {
      return session.thread;
    }

    const client = await this.codexClientPromise;
    session.thread = client.startThread(this.getThreadOptions(session));
    return session.thread;
  }

  private async respondToApproval(
    session: CodexSessionState,
    decision: "allow" | "deny"
  ): Promise<void> {
    const thread = session.thread as (Thread & { respond?: (...args: unknown[]) => Promise<unknown> }) | null;
    if (!thread || typeof thread.respond !== "function") {
      return;
    }
    await thread.respond({ decision }).catch(() => undefined);
  }

  private emit(event: SSEEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private emitCanonical(event: CodexCanonicalEvent): void {
    for (const listener of this.canonicalListeners) {
      listener(event as unknown as ShimCanonicalEvent);
    }
  }

  private emitNative(event: NativeRuntimeEvent): void {
    for (const listener of this.nativeListeners) {
      listener(event);
    }
  }
}
