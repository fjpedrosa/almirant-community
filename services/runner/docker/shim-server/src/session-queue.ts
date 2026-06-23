import { randomUUID } from "crypto";
import type { RuntimeAdapter, RuntimeEventListener } from "./adapter.js";
import type { PromptRequest, SSEEvent } from "./types.js";

type QueuedMessage = {
  messageId: string;
  sessionId: string;
  request: PromptRequest;
  enqueuedAt: number;
};

type SessionState = {
  busy: boolean;
  queue: QueuedMessage[];
};

export type QueueBroadcast = (event: SSEEvent) => void;

export const createQueuedAdapter = (
  adapter: RuntimeAdapter,
  broadcast: QueueBroadcast,
  logger?: Pick<Console, "info" | "error">,
): RuntimeAdapter => {
  const sessions = new Map<string, SessionState>();

  const getOrCreate = (sessionId: string): SessionState => {
    let s = sessions.get(sessionId);
    if (!s) {
      s = { busy: false, queue: [] };
      sessions.set(sessionId, s);
    }
    return s;
  };

  const drainNext = (sessionId: string): void => {
    const state = getOrCreate(sessionId);
    if (state.queue.length === 0) {
      state.busy = false;
      return;
    }

    const next = state.queue.shift()!;
    logger?.info(`[queue] Dequeuing message ${next.messageId} for session ${sessionId} (${state.queue.length} remaining)`);

    broadcast({
      type: "message.dequeued",
      properties: {
        sessionId,
        messageId: next.messageId,
        remainingInQueue: state.queue.length,
      },
    });

    adapter.sendPrompt(sessionId, next.request).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      logger?.error(`[queue] Failed to send dequeued message ${next.messageId}: ${message}`);
      broadcast({
        type: "session.status",
        properties: { sessionId, status: "error", message },
      });
      // Try next message or go idle
      drainNext(sessionId);
    });
  };

  const onEvent = (listener: RuntimeEventListener): (() => void) => {
    return adapter.onEvent((event) => {
      if (event.type === "session.idle") {
        const sessionId = (event.properties as { sessionId?: string })?.sessionId;
        if (sessionId) {
          const state = getOrCreate(sessionId);
          if (state.queue.length > 0) {
            // Suppress idle — drain next message instead
            drainNext(sessionId);
            return;
          }
          state.busy = false;
        }
      }
      // Forward all other events (and idle when queue is empty)
      listener(event);
    });
  };

  const sendPrompt = async (sessionId: string, request: PromptRequest): Promise<void> => {
    const state = getOrCreate(sessionId);
    if (state.busy) {
      const messageId = randomUUID();
      state.queue.push({ messageId, sessionId, request, enqueuedAt: Date.now() });
      logger?.info(`[queue] Message ${messageId} queued for session ${sessionId} (depth: ${state.queue.length})`);
      broadcast({
        type: "message.queued",
        properties: {
          sessionId,
          messageId,
          position: state.queue.length - 1,
          queueDepth: state.queue.length,
        },
      });
      return;
    }

    state.busy = true;
    await adapter.sendPrompt(sessionId, request);
  };

  return {
    createSession: (input) => adapter.createSession(input),
    sendPrompt,
    onEvent,
    listSessions: adapter.listSessions?.bind(adapter),
    getSession: adapter.getSession?.bind(adapter),
  };
};
