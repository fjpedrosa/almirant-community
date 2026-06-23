import { randomUUID } from "node:crypto";
import type {
  CanonicalEvent,
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
import {
  mapOpenCodeToCanonical,
  createCanonicalContext,
  type OpenCodeCanonicalContext,
} from "./canonical-mapper.js";

// ---------------------------------------------------------------------------
// OpenCode Adapter
//
// Connects to a running `opencode serve` instance via SSE and REST API.
// Converts OpenCode's native SSE events to the normalized SSEEvent format
// that the shim-server broadcasts to the runner.
// ---------------------------------------------------------------------------

type OpenCodeSessionState = {
  session: SessionCreateResponse;
  context: OpenCodeCanonicalContext;
  running: boolean;
  abortController: AbortController | null;
};

const OPENCODE_INTERNAL_PORT = Number(
  process.env.OPENCODE_INTERNAL_PORT ?? 4097,
);
const OPENCODE_INTERNAL_HOST = process.env.OPENCODE_INTERNAL_HOST ?? "127.0.0.1";
const OPENCODE_BASE_URL = `http://${OPENCODE_INTERNAL_HOST}:${OPENCODE_INTERNAL_PORT}`;
const OPENCODE_PASSWORD = process.env.OPENCODE_SERVER_PASSWORD;

const promptTextFromRequest = (request: PromptRequest): string =>
  request.parts.map((part) => part.text).join("\n").trim();

const asNativeTimestamp = (value: unknown): string | undefined => {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  return undefined;
};

export class OpenCodeAdapter implements RuntimeAdapter {
  private readonly sessions = new Map<string, OpenCodeSessionState>();
  private readonly listeners = new Set<RuntimeEventListener>();
  private readonly canonicalListeners = new Set<CanonicalEventListener>();
  private readonly nativeListeners = new Set<NativeEventListener>();

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
    input: SessionCreateInput,
  ): Promise<SessionCreateResponse> {
    // Create session via OpenCode REST API
    const body = {
      cwd: input.cwd,
      model: input.model,
      provider: input.provider,
      metadata: input.metadata,
    };

    const response = await fetch(`${OPENCODE_BASE_URL}/session`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Failed to create OpenCode session: ${response.status}`);
    }

    const json = (await response.json()) as Record<string, unknown>;
    const data =
      typeof json.data === "object" && json.data !== null
        ? (json.data as Record<string, unknown>)
        : json;

    const now = new Date().toISOString();
    const session: SessionCreateResponse = {
      id: (data.id as string) ?? randomUUID(),
      cwd: input.cwd,
      model: input.model,
      provider: input.provider,
      status: "idle",
      createdAt: now,
      updatedAt: now,
      metadata: input.metadata,
    };

    this.sessions.set(session.id, {
      session,
      context: createCanonicalContext(),
      running: false,
      abortController: null,
    });

    return session;
  }

  public async listSessions(): Promise<SessionCreateResponse[]> {
    return Array.from(this.sessions.values()).map((s) => s.session);
  }

  public async getSession(
    sessionId: string,
  ): Promise<SessionCreateResponse | null> {
    return this.sessions.get(sessionId)?.session ?? null;
  }

  public async sendPrompt(
    sessionId: string,
    request: PromptRequest,
  ): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state) {
      throw new Error(`Unknown session: ${sessionId}`);
    }

    const prompt = promptTextFromRequest(request);
    if (!prompt) return;

    // Reset context for new turn
    state.context.partSnapshots.clear();
    state.context.partContentTypes.clear();
    state.context.toolUseBuffers.clear();
    state.running = true;

    this.emit({
      type: "session.status",
      properties: { sessionId, status: "running" },
    });

    // Send prompt via async endpoint (returns 204, response via SSE)
    const body = { parts: [{ type: "text" as const, text: prompt }] };

    try {
      await fetch(
        `${OPENCODE_BASE_URL}/session/${encodeURIComponent(sessionId)}/prompt_async`,
        {
          method: "POST",
          headers: this.buildHeaders(),
          body: JSON.stringify(body),
        },
      );
    } catch (err) {
      state.running = false;
      this.emit({
        type: "session.status",
        properties: {
          sessionId,
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        },
      });
      this.emit({ type: "session.idle", properties: { sessionId } });
    }

    // Events arrive via the global SSE stream (subscribed in startEventStream)
  }

  /**
   * Subscribe to the global SSE event stream from OpenCode.
   * Called once at startup — events for all sessions arrive here.
   */
  public async startEventStream(signal?: AbortSignal): Promise<void> {
    const url = `${OPENCODE_BASE_URL}/event`;
    const headers: Record<string, string> = {
      Accept: "text/event-stream",
    };
    if (OPENCODE_PASSWORD) {
      const encoded = Buffer.from(`:${OPENCODE_PASSWORD}`).toString("base64");
      headers.Authorization = `Basic ${encoded}`;
    }

    while (!signal?.aborted) {
      try {
        const response = await fetch(url, { headers, signal });
        if (!response.ok || !response.body) {
          throw new Error(`SSE connection failed: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!signal?.aborted) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split(/\n\n/);
          buffer = blocks.pop() ?? "";

          for (const block of blocks) {
            this.processEventBlock(block);
          }
        }
      } catch (err) {
        if (signal?.aborted) break;
        // Reconnect after delay
        console.error(
          `[opencode-shim] SSE connection error: ${err instanceof Error ? err.message : String(err)}`,
        );
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }

  private processEventBlock(block: string): void {
    const lines = block
      .split(/\r?\n/)
      .map((l) => l.trimEnd())
      .filter((l) => l.length > 0 && !l.startsWith(":"));
    if (lines.length === 0) return;

    let eventType: string | undefined;
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    if (dataLines.length === 0) return;
    const dataStr = dataLines.join("\n");

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(dataStr);
    } catch {
      return;
    }

    // Resolve event type: explicit `event:` field, or `type` in data, or `event` in data
    const resolvedType =
      eventType ??
      (typeof data.type === "string" ? data.type : undefined) ??
      (typeof data.event === "string" ? data.event : undefined) ??
      "";
    if (!resolvedType) return;

    // Resolve session ID and find the session context
    const props =
      typeof data.properties === "object" && data.properties !== null
        ? (data.properties as Record<string, unknown>)
        : data;
    const sessionId =
      (typeof props.sessionId === "string" ? props.sessionId : undefined) ??
      (typeof props.sessionID === "string" ? props.sessionID : undefined);

    // Find session context — fall back to first session if no ID (global events)
    let context: OpenCodeCanonicalContext | undefined;
    let resolvedSessionId = sessionId ?? "";

    if (sessionId && this.sessions.has(sessionId)) {
      context = this.sessions.get(sessionId)!.context;
    } else {
      // Use first session's context for global events
      const first = this.sessions.values().next();
      if (!first.done) {
        context = first.value.context;
        resolvedSessionId = first.value.session.id;
      }
    }

    if (!context) {
      context = createCanonicalContext();
    }

    this.emitNative({
      nativeEventType: resolvedType,
      sourceFormat: "opencode-sse",
      runtimeSessionId: resolvedSessionId || sessionId,
      emittedAt:
        asNativeTimestamp(props.timestamp) ??
        asNativeTimestamp(props.createdAt) ??
        asNativeTimestamp(props.time),
      codingAgent: "opencode",
      payload: {
        event: eventType ?? null,
        data,
        properties: props,
      },
    });

    const result = mapOpenCodeToCanonical(
      resolvedSessionId,
      resolvedType,
      props,
      context,
    );

    for (const event of result.events) {
      // Track idle state
      if (event.kind === "session.idle" && sessionId) {
        const state = this.sessions.get(sessionId);
        if (state) {
          state.running = false;
          state.session.status = "idle";
          state.session.updatedAt = new Date().toISOString();
        }
        // Emit SSE session.idle for session-queue compatibility
        this.emit({ type: "session.idle", properties: { sessionId: resolvedSessionId } });
      }
      this.emitCanonical(event);
    }
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (OPENCODE_PASSWORD) {
      const encoded = Buffer.from(`:${OPENCODE_PASSWORD}`).toString("base64");
      headers.Authorization = `Basic ${encoded}`;
    }
    return headers;
  }

  private emit(event: SSEEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private emitCanonical(event: CanonicalEvent): void {
    for (const listener of this.canonicalListeners) {
      listener(event);
    }
  }

  private emitNative(event: NativeRuntimeEvent): void {
    for (const listener of this.nativeListeners) {
      listener(event);
    }
  }
}
