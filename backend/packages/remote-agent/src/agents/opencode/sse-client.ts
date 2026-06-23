import type { OpenCodeSseClientConfig, OpenCodeSseEvent } from "./types";

type SseClientDeps = {
  fetchFn?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
};

const DEFAULT_MAX_RECONNECT_ATTEMPTS = 8;
const DEFAULT_RECONNECT_BASE_DELAY_MS = 400;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 10_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 30_000;

const parseEventBlock = (block: string): OpenCodeSseEvent | null => {
  const lines = block
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0 && !line.startsWith(":"));

  if (lines.length === 0) {
    return null;
  }

  let id: string | undefined;
  let event: string | undefined;
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("id:")) {
      id = line.slice(3).trim();
      continue;
    }
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
      continue;
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  return {
    id,
    event,
    data: dataLines.join("\n"),
    raw: block,
  };
};

export class OpenCodeSseClient {
  private readonly config: Required<
    Pick<
      OpenCodeSseClientConfig,
      | "baseUrl"
      | "maxReconnectAttempts"
      | "reconnectBaseDelayMs"
      | "reconnectMaxDelayMs"
      | "heartbeatTimeoutMs"
    >
  > &
    Pick<OpenCodeSseClientConfig, "auth">;

  private readonly fetchFn: typeof fetch;
  private readonly sleepFn: (ms: number) => Promise<void>;

  constructor(config: OpenCodeSseClientConfig, deps: SseClientDeps = {}) {
    this.config = {
      baseUrl: config.baseUrl.replace(/\/+$/, ""),
      auth: config.auth,
      maxReconnectAttempts:
        config.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS,
      reconnectBaseDelayMs:
        config.reconnectBaseDelayMs ?? DEFAULT_RECONNECT_BASE_DELAY_MS,
      reconnectMaxDelayMs:
        config.reconnectMaxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS,
      heartbeatTimeoutMs:
        config.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS,
    };

    this.fetchFn = deps.fetchFn ?? fetch;
    this.sleepFn = deps.sleepFn ?? (async (ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  public async *subscribe(
    path: string,
    signal?: AbortSignal
  ): AsyncGenerator<OpenCodeSseEvent> {
    let reconnectAttempt = 0;
    let lastEventId: string | undefined;

    while (!signal?.aborted) {
      try {
        const response = await this.fetchFn(`${this.config.baseUrl}${path}`, {
          method: "GET",
          headers: this.buildHeaders(lastEventId),
          signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`SSE request failed (${response.status})`);
        }

        reconnectAttempt = 0;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        try {
          while (!signal?.aborted) {
            const result = await new Promise<
              | { timeout: true }
              | { timeout: false; done: true; value: undefined }
              | { timeout: false; done: false; value: Uint8Array }
            >((resolve, reject) => {
              const timeoutId = setTimeout(() => {
                resolve({ timeout: true });
              }, this.config.heartbeatTimeoutMs);

              reader
                .read()
                .then((value) => {
                  clearTimeout(timeoutId);
                  if (value.done) {
                    resolve({ timeout: false, done: true, value: undefined });
                    return;
                  }

                  resolve({ timeout: false, done: false, value: value.value });
                })
                .catch((error) => {
                  clearTimeout(timeoutId);
                  reject(error);
                });
            });

            if (result.timeout) {
              throw new Error("SSE heartbeat timeout");
            }

            if (result.done) {
              throw new Error("SSE stream closed");
            }

            if (!result.value) {
              continue;
            }

            buffer += decoder.decode(result.value, { stream: true });

            const blocks = buffer.split(/\n\n/);
            buffer = blocks.pop() ?? "";

            for (const block of blocks) {
              const parsed = parseEventBlock(block);
              if (!parsed) continue;

              if (parsed.id) {
                lastEventId = parsed.id;
              }

              yield parsed;
            }
          }
        } finally {
          reader.releaseLock();
        }
      } catch (error) {
        if (signal?.aborted) {
          break;
        }

        reconnectAttempt += 1;
        if (reconnectAttempt > this.config.maxReconnectAttempts) {
          throw error instanceof Error
            ? error
            : new Error(String(error));
        }

        const delay = Math.min(
          this.config.reconnectMaxDelayMs,
          this.config.reconnectBaseDelayMs * 2 ** (reconnectAttempt - 1)
        );
        await this.sleepFn(delay);
      }
    }
  }

  private buildHeaders(lastEventId?: string): Headers {
    const headers = new Headers();
    headers.set("Accept", "text/event-stream");

    if (lastEventId) {
      headers.set("Last-Event-ID", lastEventId);
    }

    if (this.config.auth?.token) {
      headers.set("Authorization", `Bearer ${this.config.auth.token}`);
    } else if (this.config.auth?.password) {
      const encoded = Buffer.from(`:${this.config.auth.password}`).toString("base64");
      headers.set("Authorization", `Basic ${encoded}`);
    }

    return headers;
  }
}

export const createOpenCodeSseClient = (
  config: OpenCodeSseClientConfig,
  deps: SseClientDeps = {}
): OpenCodeSseClient => new OpenCodeSseClient(config, deps);
