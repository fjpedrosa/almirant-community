import express, { type Request, type Response } from "express";
import type { RuntimeAdapter } from "./adapter.js";
import { createQueuedAdapter } from "./session-queue.js";
import type {
  PromptPart,
  PromptRequest,
  SSEEvent,
  SessionCreateInput,
  SessionCreateResponse,
} from "./types.js";

type ShimServerOptions = {
  adapter: RuntimeAdapter;
  host?: string;
  port?: number;
  heartbeatIntervalMs?: number;
  logger?: Pick<Console, "info" | "error">;
};

type ShimServer = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_PORT = 4096;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;

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

const writeSseEvent = (res: Response, event: SSEEvent): void => {
  res.write(`event: message\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
};

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
  const logger = options.logger ?? console;

  const sseClients = new Set<Response>();
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let server: ReturnType<typeof app.listen> | null = null;

  const broadcast = (event: SSEEvent): void => {
    for (const client of sseClients) {
      writeSseEvent(client, event);
    }
  };

  const queuedAdapter = createQueuedAdapter(adapter, broadcast, logger);

  const stopAdapterListener = queuedAdapter.onEvent((event) => {
    broadcast(event);
  });

  // Subscribe to canonical events and broadcast them as SSE events.
  // The runner's SSE canonical adapter expects {type, properties} shaped events.
  // We bypass the typed `broadcast` and write directly to SSE clients since
  // canonical event kinds don't match the legacy SSEEvent type union.
  const stopCanonicalListener = adapter.onCanonicalEvent
    ? adapter.onCanonicalEvent((event) => {
        const sseEvent = { type: event.kind, properties: event };
        for (const client of sseClients) {
          writeSseEvent(client, sseEvent as SSEEvent);
        }
      })
    : null;

  // Subscribe to raw/native runtime events. These diagnostic events are not
  // rendered by the runner; they are persisted so canonical mapper gaps can be
  // investigated after a job fails.
  const stopNativeListener = adapter.onNativeEvent
    ? adapter.onNativeEvent((event) => {
        const sseEvent = { type: "native.event", properties: event };
        for (const client of sseClients) {
          writeSseEvent(client, sseEvent as SSEEvent);
        }
      })
    : null;

  app.use(express.json({ limit: "1mb" }));

  app.get("/session", async (_req: Request, res: Response) => {
    try {
      const sessions = adapter.listSessions ? await adapter.listSessions() : [];
      res.status(200).json(sessions);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
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

      const session = await adapter.createSession(input);
      res.status(200).json(session);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: message });
    }
  });

  app.get("/session/:id", async (req: Request, res: Response) => {
    try {
      if (!adapter.getSession) {
        res.status(404).json({ error: "Session lookup not supported" });
        return;
      }

      const sessionId = getPathParam(req.params.id);
      const session = await adapter.getSession(sessionId);
      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      res.status(200).json(session);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: message });
    }
  });

  app.delete("/session/:id", async (req: Request, res: Response) => {
    try {
      if (!adapter.deleteSession) {
        res.status(204).send();
        return;
      }

      const sessionId = getPathParam(req.params.id);
      const deleted = await adapter.deleteSession(sessionId);
      if (!deleted) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      res.status(204).send();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
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
      const message = error instanceof Error ? error.message : 'Unknown error';
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
      broadcast({
        type: "session.status",
        properties: {
          sessionId,
          status: "error",
          message,
        },
      });
      broadcast({
        type: "session.idle",
        properties: { sessionId },
      });
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
    writeSseEvent(res, createConnectedEvent());

    res.on("close", () => {
      sseClients.delete(res);
      res.end();
    });
  });

  app.get("/session/:id/event", (_req: Request, res: Response) => {
    res.redirect(307, "/event");
  });

  return {
    start: async () => {
      if (server) {
        return;
      }

      await new Promise<void>((resolve) => {
        server = app.listen(port, host, () => {
          logger.info(`[shim-server] listening on http://${host}:${port}`);
          resolve();
        });
      });

      heartbeatTimer = setInterval(() => {
        broadcast(createHeartbeatEvent());
      }, heartbeatIntervalMs);
    },
    stop: async () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }

      stopAdapterListener();
      stopCanonicalListener?.();
      stopNativeListener?.();

      for (const client of sseClients) {
        client.end();
      }
      sseClients.clear();

      if (!server) {
        return;
      }

      await new Promise<void>((resolve) => {
        server?.close(() => resolve());
      });
      server = null;
    },
  };
};
