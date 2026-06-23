import { createOpenCodeSseClient, OpenCodeSseClient } from "./sse-client";
import type {
  OpenCodeApiPaths,
  OpenCodeCreateSessionInput,
  OpenCodeSession,
  OpenCodeSessionManagerConfig,
  OpenCodeSseEvent,
} from "./types";
import { DEFAULT_OPENCODE_PATHS } from "./types";

type SessionManagerDeps = {
  fetchFn?: typeof fetch;
  sseClient?: OpenCodeSseClient;
};

type SuccessEnvelope<T> = {
  success: true;
  data: T;
};

type ErrorEnvelope = {
  success: false;
  error: string;
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
      const response = await this.request(this.paths.health, { method: "GET" });
      return response.ok;
    } catch {
      return false;
    }
  }

  public async listSessions(): Promise<OpenCodeSession[]> {
    const response = await this.request(this.paths.sessions, { method: "GET" });
    const json = await response.json();
    return normalizeEnvelope<OpenCodeSession[]>(json);
  }

  public async createSession(
    input: OpenCodeCreateSessionInput
  ): Promise<OpenCodeSession> {
    const response = await this.request(this.paths.sessions, {
      method: "POST",
      body: JSON.stringify(input),
      headers: {
        "Content-Type": "application/json",
      },
    });

    const json = await response.json();
    return normalizeEnvelope<OpenCodeSession>(json);
  }

  public async getSession(sessionId: string): Promise<OpenCodeSession> {
    const response = await this.request(this.paths.sessionById(sessionId), {
      method: "GET",
    });

    const json = await response.json();
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
  public async deleteSession(sessionId: string): Promise<void> {
    const response = await this.request(this.paths.sessionById(sessionId), {
      method: "DELETE",
    });

    // Drain body to free the connection; ignore parse errors.
    await response.text().catch(() => "");
  }

  public async sendPrompt(
    sessionId: string,
    input: { prompt: string; metadata?: Record<string, unknown> }
  ): Promise<unknown> {
    // OpenCode API expects { parts: [{ type: "text", text }] } format
    const body = {
      parts: [{ type: "text" as const, text: input.prompt }],
    };

    const response = await this.request(this.paths.sessionPrompt(sessionId), {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
      },
    });

    const text = await response.text();
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
    input: { prompt: string }
  ): Promise<void> {
    // Fire-and-forget: returns 204, response comes via SSE events
    const body = {
      parts: [{ type: "text" as const, text: input.prompt }],
    };

    await this.request(this.paths.sessionPromptAsync(sessionId), {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  public streamSessionEvents(
    sessionId?: string,
    signal?: AbortSignal
  ): AsyncGenerator<OpenCodeSseEvent> {
    return this.sseClient.subscribe(this.paths.sessionEvents(sessionId), signal);
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers = new Headers(init.headers);
      this.applyAuthHeaders(headers);

      const response = await this.fetchFn(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `Agent session API error ${response.status}: ${body.slice(0, 300)}`
        );
      }

      return response;
    } finally {
      clearTimeout(timeout);
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
