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
  accepting: boolean;
  activeAttempt: number | null;
  drainScheduled: boolean;
  generation: number;
  nextAttempt: number;
  queue: QueuedMessage[];
};

type Settlement = "ignored" | "drain" | "idle";

export type QueueBroadcast = (event: SSEEvent) => void;

export type QueuedAdapterOptions = {
  maxQueueDepth?: number;
};

/**
 * A conservative per-session bound: enough for a short burst of follow-ups
 * without allowing a disconnected caller to grow memory without limit.
 */
export const DEFAULT_MAX_QUEUE_DEPTH = 32;

export const createQueuedAdapter = (
  adapter: RuntimeAdapter,
  broadcast: QueueBroadcast,
  logger?: Pick<Console, "info" | "error">,
  options: QueuedAdapterOptions = {},
): RuntimeAdapter => {
  const maxQueueDepth = options.maxQueueDepth ?? DEFAULT_MAX_QUEUE_DEPTH;
  if (!Number.isSafeInteger(maxQueueDepth) || maxQueueDepth < 1) {
    throw new Error("maxQueueDepth must be a positive safe integer");
  }

  const sessions = new Map<string, SessionState>();
  const listeners = new Set<RuntimeEventListener>();
  let closed = false;
  let closePromise: Promise<void> | null = null;
  let stopAdapterEventListener: (() => void) | null = null;

  const getOrCreate = (sessionId: string): SessionState => {
    let state = sessions.get(sessionId);
    if (!state) {
      state = {
        accepting: true,
        activeAttempt: null,
        drainScheduled: false,
        generation: 0,
        nextAttempt: 0,
        queue: [],
      };
      sessions.set(sessionId, state);
    }
    return state;
  };

  const emit = (event: SSEEvent): void => {
    for (const listener of listeners) {
      listener(event);
    }
  };

  const clearQueued = (state: SessionState): void => {
    state.queue.length = 0;
    state.generation += 1;
    state.drainScheduled = false;
  };

  const executePrompt = async (
    sessionId: string,
    state: SessionState,
    request: PromptRequest,
    queuedMessageId?: string,
  ): Promise<void> => {
    if (closed) {
      throw new Error("Queued adapter is closed");
    }
    if (!state.accepting || sessions.get(sessionId) !== state) {
      throw new Error(`Session ${sessionId} is not accepting prompts`);
    }

    const attempt = ++state.nextAttempt;
    state.activeAttempt = attempt;

    try {
      await adapter.sendPrompt(sessionId, request);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (queuedMessageId) {
        logger?.error(
          `[queue] Failed to send dequeued message ${queuedMessageId}: ${message}`,
        );
      }

      const settlement = settleSession(sessionId, state, attempt);
      if (settlement !== "ignored") {
        broadcast({
          type: "session.status",
          properties: { sessionId, status: "error", message },
        });
        if (settlement === "idle") {
          broadcast({
            type: "session.idle",
            properties: { sessionId },
          });
        }
      }

      if (!queuedMessageId) {
        throw error;
      }
    }
  };

  const scheduleDrain = (sessionId: string, state: SessionState): void => {
    if (
      closed ||
      !state.accepting ||
      state.drainScheduled ||
      state.activeAttempt !== null ||
      state.queue.length === 0
    ) {
      return;
    }

    state.drainScheduled = true;
    const generation = state.generation;

    queueMicrotask(() => {
      if (
        closed ||
        sessions.get(sessionId) !== state ||
        state.generation !== generation ||
        !state.accepting
      ) {
        return;
      }

      state.drainScheduled = false;
      if (state.activeAttempt !== null) {
        return;
      }

      const next = state.queue.shift();
      if (!next) {
        return;
      }

      logger?.info(
        `[queue] Dequeuing message ${next.messageId} for session ${sessionId} (${state.queue.length} remaining)`,
      );
      broadcast({
        type: "message.dequeued",
        properties: {
          sessionId,
          messageId: next.messageId,
          remainingInQueue: state.queue.length,
        },
      });

      void executePrompt(
        sessionId,
        state,
        next.request,
        next.messageId,
      ).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        logger?.error(
          `[queue] Unexpected dequeued message failure ${next.messageId}: ${message}`,
        );
      });
    });
  };

  function settleSession(
    sessionId: string,
    state: SessionState,
    attempt: number,
  ): Settlement {
    if (
      sessions.get(sessionId) !== state ||
      state.activeAttempt !== attempt
    ) {
      return "ignored";
    }

    state.activeAttempt = null;
    if (
      !closed &&
      state.accepting &&
      state.queue.length > 0
    ) {
      scheduleDrain(sessionId, state);
      return "drain";
    }

    return "idle";
  }

  const handleAdapterEvent = (event: SSEEvent): void => {
    if (event.type !== "session.idle") {
      emit(event);
      return;
    }

    const sessionId = event.properties.sessionId;
    if (!sessionId) {
      emit(event);
      return;
    }

    const state = sessions.get(sessionId);
    if (!state) {
      emit(event);
      return;
    }

    if (state.activeAttempt === null) {
      if (state.drainScheduled || state.queue.length > 0) {
        scheduleDrain(sessionId, state);
        return;
      }
      emit(event);
      return;
    }

    const settlement = settleSession(
      sessionId,
      state,
      state.activeAttempt,
    );
    if (settlement === "idle") {
      emit(event);
    }
  };

  stopAdapterEventListener = adapter.onEvent(handleAdapterEvent);

  const onEvent = (listener: RuntimeEventListener): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const sendPrompt = async (
    sessionId: string,
    request: PromptRequest,
  ): Promise<void> => {
    if (closed) {
      throw new Error("Queued adapter is closed");
    }

    const state = getOrCreate(sessionId);
    if (!state.accepting) {
      throw new Error(`Session ${sessionId} is not accepting prompts`);
    }

    if (state.activeAttempt !== null || state.drainScheduled) {
      if (state.queue.length >= maxQueueDepth) {
        throw new Error(
          `Session queue limit of ${maxQueueDepth} reached for session ${sessionId}`,
        );
      }

      const messageId = randomUUID();
      state.queue.push({
        messageId,
        sessionId,
        request,
        enqueuedAt: Date.now(),
      });
      logger?.info(
        `[queue] Message ${messageId} queued for session ${sessionId} (depth: ${state.queue.length})`,
      );
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

    await executePrompt(sessionId, state, request);
  };

  const close = (): Promise<void> => {
    if (closePromise) {
      return closePromise;
    }

    closed = true;
    for (const state of sessions.values()) {
      state.accepting = false;
      clearQueued(state);
    }
    listeners.clear();
    stopAdapterEventListener?.();
    stopAdapterEventListener = null;

    closePromise = Promise.resolve().then(async () => {
      await adapter.close?.();
    });
    return closePromise;
  };

  const queuedAdapter: RuntimeAdapter = {
    async createSession(input) {
      if (closed) {
        throw new Error("Queued adapter is closed");
      }
      const session = await adapter.createSession(input);
      sessions.delete(session.id);
      return session;
    },
    sendPrompt,
    onEvent,
    ...(adapter.abortSession
      ? {
          abortSession: async (sessionId: string): Promise<boolean> => {
            const state = sessions.get(sessionId);
            if (state) {
              state.accepting = false;
              clearQueued(state);
            }
            try {
              return await adapter.abortSession!(sessionId);
            } finally {
              if (!closed && state && sessions.get(sessionId) === state) {
                state.accepting = true;
              }
            }
          },
        }
      : {}),
    ...(adapter.onCanonicalEvent
      ? {
          onCanonicalEvent: (listener) => adapter.onCanonicalEvent!(listener),
        }
      : {}),
    ...(adapter.onNativeEvent
      ? {
          onNativeEvent: (listener) => adapter.onNativeEvent!(listener),
        }
      : {}),
    ...(adapter.listSessions
      ? { listSessions: () => adapter.listSessions!() }
      : {}),
    ...(adapter.getSession
      ? { getSession: (sessionId: string) => adapter.getSession!(sessionId) }
      : {}),
    ...(adapter.deleteSession
      ? {
          deleteSession: async (sessionId: string): Promise<boolean> => {
            const state = sessions.get(sessionId);
            if (state) {
              state.accepting = false;
              clearQueued(state);
            }

            try {
              const deleted = await adapter.deleteSession!(sessionId);
              if (deleted && state && sessions.get(sessionId) === state) {
                sessions.delete(sessionId);
              }
              return deleted;
            } finally {
              if (!closed && state && sessions.get(sessionId) === state) {
                state.accepting = true;
              }
            }
          },
        }
      : {}),
    close,
  };

  return queuedAdapter;
};
