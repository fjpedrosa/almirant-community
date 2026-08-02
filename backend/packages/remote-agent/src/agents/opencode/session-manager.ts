import { createOpenCodeSseClient, OpenCodeSseClient } from "./sse-client";
import type {
  OpenCodeApiPaths,
  OpenCodeCreateSessionInput,
  OpenCodeMcpStatusMap,
  OpenCodeSession,
  OpenCodeSessionManagerConfig,
  OpenCodeSseEvent,
} from "./types";
import { DEFAULT_OPENCODE_PATHS } from "./types";

type SessionManagerDeps = {
  fetchFn?: typeof fetch;
  sseClient?: OpenCodeSseClient;
};

export type OpenCodeSessionRequestOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

type SuccessEnvelope<T> = {
  success: true;
  data: T;
};

type ErrorEnvelope = {
  success: false;
  error: string;
};

const throwIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) {
    throw signal.reason ?? new Error("Agent session API request aborted");
  }
};

const raceWithAbort = async <T>(
  operation: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> => {
  throwIfAborted(signal);
  const pending = operation();
  pending.catch(() => undefined);

  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      reject(signal.reason ?? new Error("Agent session API request aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([pending, aborted]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
};

const normalizeEnvelope = <T>(payload: unknown): T => {
  if (typeof payload === "object" && payload !== null && "success" in payload) {
    const envelope = payload as SuccessEnvelope<T> | ErrorEnvelope;
    if (envelope.success) {
      return envelope.data;
    }
    throw new Error(envelope.error || "OpenCode API request failed");
  }

  return payload as T;
};

export class OpenCodeSessionManager {
  private readonly baseUrl: string;
  private readonly auth: OpenCodeSessionManagerConfig["auth"];
  private readonly timeoutMs: number;
  private readonly paths: OpenCodeApiPaths;
  private readonly fetchFn: typeof fetch;
  private readonly sseClient: OpenCodeSseClient;

  constructor(config: OpenCodeSessionManagerConfig, deps: SessionManagerDeps = {}) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.auth = config.auth;
    this.timeoutMs = config.timeoutMs ?? 15_000;
    this.paths = {
      ...DEFAULT_OPENCODE_PATHS,
      ...(config.paths ?? {}),
    };
    this.fetchFn = deps.fetchFn ?? fetch;

    this.sseClient =
      deps.sseClient ??
      createOpenCodeSseClient(
        {
          baseUrl: this.baseUrl,
          auth: this.auth,
          ...(config.sse ?? {}),
        },
        {
          fetchFn: this.fetchFn,
        }
      );
  }

  public async healthCheck(): Promise<boolean> {
    try {
      const { response } = await this.request(
        this.paths.health,
        { method: "GET" },
        undefined,
        false,
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  public async listSessions(): Promise<OpenCodeSession[]> {
    const { body } = await this.request(this.paths.sessions, { method: "GET" });
    const json = JSON.parse(body);
    return normalizeEnvelope<OpenCodeSession[]>(json);
  }

  /**
   * OpenCode 1.18 initializes configured MCP clients before returning this
   * map. A "connected" status therefore represents transport setup and
   * tool-definition cache initialization (including tools/list when the
   * server advertises tools), not merely parsed configuration.
   */
  public async getMcpStatus(
    requestOptions?: OpenCodeSessionRequestOptions,
  ): Promise<OpenCodeMcpStatusMap> {
    const { body } = await this.request(
      this.paths.mcpStatus,
      { method: "GET" },
      requestOptions,
    );
    return normalizeEnvelope<OpenCodeMcpStatusMap>(JSON.parse(body));
  }

  public async createSession(
    _input: OpenCodeCreateSessionInput,
    requestOptions?: OpenCodeSessionRequestOptions,
  ): Promise<OpenCodeSession> {
    // opencode >=1.x rejects any extra fields on session create (cwd, model,
    // provider → {"_tag":"BadRequest"}). The working directory comes from the
    // serve process cwd and the model/provider from the injected opencode.json
    // (buildOpenCodeConfig), so the create body must stay empty.
    const { body } = await this.request(
      this.paths.sessions,
      {
        method: "POST",
        body: JSON.stringify({}),
        headers: {
          "Content-Type": "application/json",
        },
      },
      requestOptions,
    );

    const json = JSON.parse(body);
    return normalizeEnvelope<OpenCodeSession>(json);
  }

  public async getSession(sessionId: string): Promise<OpenCodeSession> {
    const { body } = await this.request(this.paths.sessionById(sessionId), {
      method: "GET",
    });

    const json = JSON.parse(body);
    return normalizeEnvelope<OpenCodeSession>(json);
  }

  public async resumeSession(sessionId: string): Promise<OpenCodeSession> {
    return this.getSession(sessionId);
  }

  /**
   * Delete a session on the OpenCode serve process so it releases
   * its KV cache / message history. Best-effort — callers should not
   * treat failures as fatal.
   */
  public async deleteSession(
    sessionId: string,
    requestOptions?: OpenCodeSessionRequestOptions,
  ): Promise<void> {
    await this.request(
      this.paths.sessionById(sessionId),
      { method: "DELETE" },
      requestOptions,
    );
  }

  public async sendPrompt(
    sessionId: string,
    input: { prompt: string; metadata?: Record<string, unknown> }
  ): Promise<unknown> {
    // OpenCode API expects { parts: [{ type: "text", text }] } format
    const body = {
      parts: [{ type: "text" as const, text: input.prompt }],
    };

    const { body: text } = await this.request(this.paths.sessionPrompt(sessionId), {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!text.trim()) {
      return { ok: true };
    }

    try {
      return normalizeEnvelope<unknown>(JSON.parse(text));
    } catch {
      return text;
    }
  }

  public async sendPromptAsync(
    sessionId: string,
    input: { prompt: string },
    requestOptions?: OpenCodeSessionRequestOptions,
  ): Promise<void> {
    // Fire-and-forget: returns 204, response comes via SSE events
    const body = {
      parts: [{ type: "text" as const, text: input.prompt }],
    };

    await this.request(
      this.paths.sessionPromptAsync(sessionId),
      {
        method: "POST",
        body: JSON.stringify(body),
        headers: {
          "Content-Type": "application/json",
        },
      },
      requestOptions,
      false,
    );
  }

  public streamSessionEvents(
    sessionId?: string,
    signal?: AbortSignal
  ): AsyncGenerator<OpenCodeSseEvent> {
    return this.sseClient.subscribe(this.paths.sessionEvents(sessionId), signal);
  }

  private async request(
    path: string,
    init: RequestInit,
    requestOptions?: OpenCodeSessionRequestOptions,
    readSuccessBody = true,
  ): Promise<{ response: Response; body: string }> {
    const controller = new AbortController();
    const timeoutMs = requestOptions?.timeoutMs ?? this.timeoutMs;
    const timeout = setTimeout(
      () =>
        controller.abort(
          new Error(`Agent session API timeout after ${timeoutMs}ms`),
        ),
      timeoutMs,
    );
    const externalSignals = [init.signal, requestOptions?.signal].filter(
      (signal): signal is AbortSignal => signal != null,
    );
    const listeners = externalSignals.map((signal) => {
      const listener = () => controller.abort(signal.reason);
      if (signal.aborted) {
        listener();
      } else {
        signal.addEventListener("abort", listener, { once: true });
      }
      return { signal, listener };
    });

    try {
      const headers = new Headers(init.headers);
      this.applyAuthHeaders(headers);

      const response = await raceWithAbort(
        () => this.fetchFn(`${this.baseUrl}${path}`, {
          ...init,
          headers,
          signal: controller.signal,
        }),
        controller.signal,
      );
      throwIfAborted(controller.signal);

      let body = "";
      if (!response.ok || readSuccessBody) {
        body = await raceWithAbort(
          () => response.text(),
          controller.signal,
        );
        throwIfAborted(controller.signal);
      }
      if (!response.ok) {
        throw new Error(
          `Agent session API error ${response.status}: ${body.slice(0, 300)}`
        );
      }

      return { response, body };
    } finally {
      clearTimeout(timeout);
      for (const { signal, listener } of listeners) {
        signal.removeEventListener("abort", listener);
      }
    }
  }

  private applyAuthHeaders(headers: Headers): void {
    if (this.auth?.token) {
      headers.set("Authorization", `Bearer ${this.auth.token}`);
      return;
    }

    if (this.auth?.password) {
      const encoded = Buffer.from(`:${this.auth.password}`).toString("base64");
      headers.set("Authorization", `Basic ${encoded}`);
    }
  }
}

export const createOpenCodeSessionManager = (
  config: OpenCodeSessionManagerConfig,
  deps: SessionManagerDeps = {}
): OpenCodeSessionManager => new OpenCodeSessionManager(config, deps);
