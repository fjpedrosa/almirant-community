import express from "express";
import type { NextFunction, Request, Response } from "express";
import type { Server as HttpServer } from "node:http";
import type { RuntimeAdapter } from "./adapter.js";
import { createQueuedAdapter } from "./session-queue.js";
import type {
  PromptPart,
  PromptRequest,
  SSEEvent,
  SessionCreateInput,
} from "./types.js";

type ShimServerOptions = {
  adapter: RuntimeAdapter;
  host?: string;
  port?: number;
  heartbeatIntervalMs?: number;
  maxQueueDepth?: number;
  adapterCloseTimeoutMs?: number;
  httpCloseTimeoutMs?: number;
  logger?: Pick<Console, "info" | "error">;
};

type ShimServer = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

export type ShimServerErrorCode =
  | "SHIM_SHUTDOWN_CONFIG_ERROR"
  | "SHIM_START_DRAIN_TIMEOUT"
  | "SHIM_ADAPTER_CLOSE_TIMEOUT"
  | "SHIM_ADAPTER_CLOSE_FAILED"
  | "SHIM_HTTP_CLOSE_TIMEOUT"
  | "SHIM_HTTP_CLOSE_FAILED";

export class ShimServerError extends Error {
  public readonly code: ShimServerErrorCode;

  constructor(code: ShimServerErrorCode, safeDetail: string) {
    super(`${code}: ${safeDetail}`);
    this.name = "ShimServerError";
    this.code = code;
  }
}

const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_PORT = 4096;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;
const DEFAULT_ADAPTER_CLOSE_TIMEOUT_MS = 5_000;
const DEFAULT_HTTP_CLOSE_TIMEOUT_MS = 5_000;

const shutdownTimeout = (
  value: number | undefined,
  fallback: number,
  name: string,
): number => {
  const timeout = value ?? fallback;
  if (!Number.isSafeInteger(timeout) || timeout <= 0) {
    throw new ShimServerError(
      "SHIM_SHUTDOWN_CONFIG_ERROR",
      `${name} must be a positive safe integer`,
    );
  }
  return timeout;
};

const runBoundedShutdownPhase = async (
  operation: () => Promise<void>,
  timeoutMs: number,
  timeoutCode: ShimServerErrorCode,
  failureCode: ShimServerErrorCode,
  safePhaseName: string,
): Promise<void> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new ShimServerError(timeoutCode, `${safePhaseName} timed out`));
    }, timeoutMs);
  });

  try {
    await Promise.race([Promise.resolve().then(operation), timeout]);
  } catch (error) {
    if (error instanceof ShimServerError) throw error;
    throw new ShimServerError(failureCode, `${safePhaseName} failed`);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const getPathParam = (value: string | string[] | undefined): string => {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
};

const toPromptParts = (payload: unknown): PromptPart[] => {
  if (typeof payload === "object" && payload !== null) {
    const input = payload as {
      prompt?: unknown;
      parts?: unknown;
    };

    if (typeof input.prompt === "string" && input.prompt.length > 0) {
      return [{ type: "text", text: input.prompt }];
    }

    if (Array.isArray(input.parts)) {
      return input.parts
        .map((part) => {
          if (
            typeof part === "object" &&
            part !== null &&
            "type" in part &&
            "text" in part
          ) {
            const casted = part as { type?: unknown; text?: unknown };
            if (casted.type === "text" && typeof casted.text === "string") {
              return { type: "text", text: casted.text } satisfies PromptPart;
            }
          }

          return null;
        })
        .filter((part): part is PromptPart => part !== null);
    }
  }

  return [];
};

const writeSseEvent = (res: Response, event: SSEEvent): boolean =>
  res.write(`event: message\ndata: ${JSON.stringify(event)}\n\n`);

const createConnectedEvent = (): SSEEvent => ({
  type: "server.connected",
  properties: { timestamp: new Date().toISOString() },
});

const createHeartbeatEvent = (): SSEEvent => ({
  type: "server.heartbeat",
  properties: { timestamp: new Date().toISOString() },
});

export const createShimServer = (options: ShimServerOptions): ShimServer => {
  const app = express();
  const adapter = options.adapter;
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;
  const heartbeatIntervalMs =
    options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  const adapterCloseTimeoutMs = shutdownTimeout(
    options.adapterCloseTimeoutMs,
    DEFAULT_ADAPTER_CLOSE_TIMEOUT_MS,
    "adapterCloseTimeoutMs",
  );
  const httpCloseTimeoutMs = shutdownTimeout(
    options.httpCloseTimeoutMs,
    DEFAULT_HTTP_CLOSE_TIMEOUT_MS,
    "httpCloseTimeoutMs",
  );
  const logger = options.logger ?? console;

  const sseClients = new Set<Response>();
  let acceptingRequests = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let listenersStopped = false;
  let listenerStopFailed = false;
  let ready = false;
  let server: HttpServer | null = null;
  let startPromise: Promise<void> | null = null;
  let stopPromise: Promise<void> | null = null;
  let stopped = false;

  const endSseClient = (client: Response): void => {
    sseClients.delete(client);
    if (!client.writableEnded) {
      client.end();
    }
  };

  const writeToSseClient = (client: Response, event: SSEEvent): void => {
    if (client.destroyed || client.writableEnded) {
      endSseClient(client);
      return;
    }

    try {
      if (!writeSseEvent(client, event)) {
        endSseClient(client);
      }
    } catch (error) {
      endSseClient(client);
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[shim-server] SSE client write failed: ${message}`);
    }
  };

  const broadcast = (event: SSEEvent): void => {
    for (const client of [...sseClients]) {
      writeToSseClient(client, event);
    }
  };

  const queuedAdapter = createQueuedAdapter(adapter, broadcast, logger, {
    maxQueueDepth: options.maxQueueDepth,
  });

  const stopAdapterListener = queuedAdapter.onEvent((event) => {
    broadcast(event);
  });

  const stopCanonicalListener = queuedAdapter.onCanonicalEvent
    ? queuedAdapter.onCanonicalEvent((event) => {
        const sseEvent = { type: event.kind, properties: event };
        broadcast(sseEvent as SSEEvent);
      })
    : null;

  const stopNativeListener = queuedAdapter.onNativeEvent
    ? queuedAdapter.onNativeEvent((event) => {
        const sseEvent = { type: "native.event", properties: event };
        broadcast(sseEvent as SSEEvent);
      })
    : null;

  const stopListeners = (): void => {
    if (listenersStopped) return;
    listenersStopped = true;
    for (const stopListener of [
      stopAdapterListener,
      stopCanonicalListener,
      stopNativeListener,
    ]) {
      try {
        stopListener?.();
      } catch {
        listenerStopFailed = true;
      }
    }
  };

  app.get("/health/live", (_req: Request, res: Response) => {
    res.status(200).json({ ok: true });
  });

  app.get("/health/ready", (_req: Request, res: Response) => {
    res.status(ready ? 200 : 503).json({ ready });
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!acceptingRequests) {
      res.status(503).json({ error: "Server is draining" });
      return;
    }
    next();
  });

  app.use(express.json({ limit: "1mb" }));

  app.get("/session", async (_req: Request, res: Response) => {
    try {
      const sessions = queuedAdapter.listSessions
        ? await queuedAdapter.listSessions()
        : [];
      res.status(200).json(sessions);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ error: message });
    }
  });

  app.post("/session", async (req: Request, res: Response) => {
    try {
      const payload = (req.body ?? {}) as Partial<SessionCreateInput>;
      const input: SessionCreateInput = {
        cwd: typeof payload.cwd === "string" ? payload.cwd : "/workspace",
        model: typeof payload.model === "string" ? payload.model : undefined,
        provider:
          typeof payload.provider === "string" ? payload.provider : undefined,
        metadata:
          typeof payload.metadata === "object" && payload.metadata !== null
            ? payload.metadata
            : undefined,
      };

      const session = await queuedAdapter.createSession(input);
      res.status(200).json(session);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ error: message });
    }
  });

  app.get("/session/:id", async (req: Request, res: Response) => {
    try {
      if (!queuedAdapter.getSession) {
        res.status(404).json({ error: "Session lookup not supported" });
        return;
      }

      const sessionId = getPathParam(req.params.id);
      const session = await queuedAdapter.getSession(sessionId);
      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      res.status(200).json(session);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ error: message });
    }
  });

  app.delete("/session/:id", async (req: Request, res: Response) => {
    try {
      if (!queuedAdapter.deleteSession) {
        res.status(204).send();
        return;
      }

      const sessionId = getPathParam(req.params.id);
      const deleted = await queuedAdapter.deleteSession(sessionId);
      if (!deleted) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      res.status(204).send();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ error: message });
    }
  });

  app.post("/session/:id/abort", async (req: Request, res: Response) => {
    try {
      if (!queuedAdapter.abortSession) {
        res.status(404).json({ error: "Session abort not supported" });
        return;
      }

      const sessionId = getPathParam(req.params.id);
      const aborted = await queuedAdapter.abortSession(sessionId);
      if (!aborted) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      res.status(200).json(aborted);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ error: message });
    }
  });

  app.post("/session/:id/message", async (req: Request, res: Response) => {
    try {
      const sessionId = getPathParam(req.params.id);
      const promptRequest: PromptRequest = {
        parts: toPromptParts(req.body),
      };

      await queuedAdapter.sendPrompt(sessionId, promptRequest);
      res.status(200).json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ error: message });
    }
  });

  app.post("/session/:id/prompt_async", async (req: Request, res: Response) => {
    const sessionId = getPathParam(req.params.id);
    const promptRequest: PromptRequest = {
      parts: toPromptParts(req.body),
    };

    void queuedAdapter.sendPrompt(sessionId, promptRequest).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[shim-server] async prompt failed: ${message}`);
    });

    res.status(204).send();
  });

  app.get("/event", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    sseClients.add(res);
    res.on("close", () => {
      sseClients.delete(res);
    });
    writeToSseClient(res, createConnectedEvent());
  });

  app.get("/session/:id/event", (_req: Request, res: Response) => {
    res.redirect(307, "/event");
  });

  const start = (): Promise<void> => {
    if (stopped || stopPromise) {
      return Promise.reject(new Error("Shim server has been stopped"));
    }
    if (startPromise) {
      return startPromise;
    }
    if (server?.listening && ready) {
      return Promise.resolve();
    }

    startPromise = (async () => {
      try {
        await new Promise<void>((resolve, reject) => {
          const candidate = app.listen(port, host);
          server = candidate;

          const onError = (error: Error): void => {
            candidate.off("listening", onListening);
            if (server === candidate) {
              server = null;
            }
            acceptingRequests = false;
            ready = false;
            reject(error);
          };

          const onListening = (): void => {
            candidate.off("error", onError);
            if (!stopped) {
              acceptingRequests = true;
              ready = true;
              heartbeatTimer = setInterval(() => {
                broadcast(createHeartbeatEvent());
              }, heartbeatIntervalMs);
              logger.info(`[shim-server] listening on http://${host}:${port}`);
            }
            resolve();
          };

          candidate.once("error", onError);
          candidate.once("listening", onListening);
        });
      } finally {
        startPromise = null;
      }
    })();

    return startPromise;
  };

  const stop = (): Promise<void> => {
    if (stopPromise) {
      return stopPromise;
    }

    stopped = true;
    ready = false;
    acceptingRequests = false;

    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }

    stopListeners();
    for (const client of [...sseClients]) {
      endSseClient(client);
    }
    sseClients.clear();

    const pendingStart = startPromise;
    stopPromise = (async () => {
      const phaseErrors: ShimServerError[] = listenerStopFailed
        ? [
            new ShimServerError(
              "SHIM_ADAPTER_CLOSE_FAILED",
              "Runtime adapter listener close failed",
            ),
          ]
        : [];

      if (pendingStart) {
        try {
          await runBoundedShutdownPhase(
            () => pendingStart.then(() => undefined, () => undefined),
            httpCloseTimeoutMs,
            "SHIM_START_DRAIN_TIMEOUT",
            "SHIM_HTTP_CLOSE_FAILED",
            "Pending server start drain",
          );
        } catch (error) {
          phaseErrors.push(
            error instanceof ShimServerError
              ? error
              : new ShimServerError(
                  "SHIM_HTTP_CLOSE_FAILED",
                  "Pending server start drain failed",
                ),
          );
        }
      }

      try {
        await runBoundedShutdownPhase(
          async () => {
            await queuedAdapter.close?.();
          },
          adapterCloseTimeoutMs,
          "SHIM_ADAPTER_CLOSE_TIMEOUT",
          "SHIM_ADAPTER_CLOSE_FAILED",
          "Runtime adapter close",
        );
      } catch (error) {
        phaseErrors.push(
          error instanceof ShimServerError
            ? error
            : new ShimServerError(
                "SHIM_ADAPTER_CLOSE_FAILED",
                "Runtime adapter close failed",
              ),
        );
      }

      const activeServer = server;
      if (activeServer) {
        try {
          if (activeServer.listening) {
            await runBoundedShutdownPhase(
              () =>
                new Promise<void>((resolve, reject) => {
                  activeServer.close((error) =>
                    error ? reject(error) : resolve(),
                  );
                }),
              httpCloseTimeoutMs,
              "SHIM_HTTP_CLOSE_TIMEOUT",
              "SHIM_HTTP_CLOSE_FAILED",
              "HTTP server close",
            );
          }
        } catch (error) {
          const safeError =
            error instanceof ShimServerError
              ? error
              : new ShimServerError(
                  "SHIM_HTTP_CLOSE_FAILED",
                  "HTTP server close failed",
                );
          phaseErrors.push(safeError);
          if (safeError.code === "SHIM_HTTP_CLOSE_TIMEOUT") {
            try {
              activeServer.closeAllConnections?.();
            } catch {
              // Preserve the typed timeout as the authoritative stop failure.
            }
          }
        } finally {
          if (server === activeServer) {
            server = null;
          }
        }
      }

      if (phaseErrors.length > 0) {
        throw phaseErrors[0];
      }
    })();

    return stopPromise;
  };

  return { start, stop };
};
