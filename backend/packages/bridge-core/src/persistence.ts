import type { CanonicalEvent } from "@almirant/canonical-events";

export type PersistenceLogger = (
  level: string,
  message: string,
  meta?: Record<string, unknown>,
) => void;

export type RetryOptions = {
  maxRetries: number;
  baseDelayMs: number;
  label: string;
};

export type BridgeApiClientConfig = {
  baseUrl: string;
  apiKey: string;
  log: PersistenceLogger;
};

export type JobStatusPayload = {
  status: "completed" | "incomplete" | "failed";
  result?: Record<string, unknown>;
  errorMessage?: string;
};

export type SessionEventPayload = {
  sequenceNum: number;
  kind: string;
  payload: Record<string, unknown>;
  provider?: string;
};

export type NativeEventPayload = {
  sequenceNum: number;
  nativeEventType: string;
  sourceFormat: string;
  payload: Record<string, unknown>;
  provider?: string;
  codingAgent?: string;
  runtimeSessionId?: string;
  emittedAt?: string;
};

export type BridgeApiClient = {
  updateJobStatus: (jobId: string, payload: JobStatusPayload) => Promise<void>;
  persistSessionEvents: (
    jobId: string,
    events: SessionEventPayload[],
  ) => Promise<void>;
  persistNativeEvents: (
    jobId: string,
    events: NativeEventPayload[],
  ) => Promise<void>;
};

export type NativeEventBatcher = {
  add: (jobId: string, event: NativeEventPayload) => void;
  flushJob: (jobId: string) => Promise<void>;
  flushAll: () => Promise<void>;
  destroy: () => void;
};

export type SessionEventBatcher = {
  add: (
    jobId: string,
    sequenceNum: number,
    event: CanonicalEvent,
    provider?: string,
  ) => void;
  flushJob: (jobId: string) => Promise<void>;
  flushAll: () => Promise<void>;
  destroy: () => void;
};

export type EventPersistenceContext = {
  jobId: string;
  sequenceNumber?: number;
  provider?: string;
};

export type EventPersistenceStrategy = {
  persistCanonicalEvent: (
    event: CanonicalEvent,
    context: EventPersistenceContext,
  ) => Promise<void>;
  persistNativeEvent: (
    event: NativeEventPayload,
    context: { jobId: string },
  ) => Promise<void>;
  flushJob: (jobId: string) => Promise<void>;
  flushAll: () => Promise<void>;
  destroy: () => void;
};

type ApiPersistenceStrategyConfig = {
  apiClient: BridgeApiClient;
  log: PersistenceLogger;
  persistSessionEvents?: boolean;
  persistNativeEvents?: boolean;
};

const EVENT_FLUSH_INTERVAL_MS = 500;
const EVENT_BATCH_SIZE = 20;

const wait = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const withPersistenceRetry = async <T>(
  fn: () => Promise<T>,
  opts: RetryOptions,
): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const isRateLimit = message.includes("429");
      const isTransient =
        message.includes("502") ||
        message.includes("503") ||
        message.includes("504");

      if (attempt < opts.maxRetries && (isRateLimit || isTransient)) {
        await wait(opts.baseDelayMs * Math.pow(2, attempt));
        continue;
      }

      break;
    }
  }

  throw lastError;
};

export const createBridgeApiClient = (
  config: BridgeApiClientConfig,
): BridgeApiClient => {
  const { baseUrl, apiKey, log } = config;

  const request = async <T = unknown>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> => {
    const url = `${baseUrl}${path}`;

    const response = await withPersistenceRetry(
      () =>
        fetch(url, {
          ...options,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            ...options.headers,
          },
        }),
      {
        maxRetries: 3,
        baseDelayMs: 200,
        label: path,
      },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      log("error", `API request failed: ${response.status} ${path}`, {
        status: response.status,
        body: body.slice(0, 500),
      });
      throw new Error(`API error ${response.status}: ${body.slice(0, 200)}`);
    }

    const json = await response.json().catch(() => null);
    return json as T;
  };

  return {
    updateJobStatus: async (jobId, payload) => {
      await request(`/workers/jobs/${jobId}/status`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },

    persistSessionEvents: async (jobId, events) => {
      if (events.length === 0) return;
      await request(`/workers/agent-jobs/${jobId}/session-events`, {
        method: "POST",
        body: JSON.stringify({ events }),
      });
    },

    persistNativeEvents: async (jobId, events) => {
      if (events.length === 0) return;
      await request(`/workers/agent-jobs/${jobId}/native-events`, {
        method: "POST",
        body: JSON.stringify({ events }),
      });
    },
  };
};

type SessionEventBuffer = {
  events: SessionEventPayload[];
  timer: ReturnType<typeof setTimeout> | null;
};

export const createSessionEventBatcher = (
  apiClient: BridgeApiClient,
  log: PersistenceLogger,
): SessionEventBatcher => {
  const buffers = new Map<string, SessionEventBuffer>();

  const doFlush = async (jobId: string): Promise<void> => {
    const buffer = buffers.get(jobId);
    if (!buffer || buffer.events.length === 0) {
      return;
    }

    const events = [...buffer.events];
    buffer.events = [];

    if (buffer.timer) {
      clearTimeout(buffer.timer);
      buffer.timer = null;
    }

    try {
      await apiClient.persistSessionEvents(jobId, events);
    } catch (error) {
      log("error", `Failed to persist session events for job ${jobId}`, {
        count: events.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return {
    add: (jobId, sequenceNum, event, provider) => {
      let buffer = buffers.get(jobId);
      if (!buffer) {
        buffer = { events: [], timer: null };
        buffers.set(jobId, buffer);
      }

      buffer.events.push({
        sequenceNum,
        kind: event.kind,
        payload: event as unknown as Record<string, unknown>,
        provider,
      });

      if (buffer.events.length >= EVENT_BATCH_SIZE) {
        void doFlush(jobId);
        return;
      }

      if (!buffer.timer) {
        buffer.timer = setTimeout(
          () => void doFlush(jobId),
          EVENT_FLUSH_INTERVAL_MS,
        );
      }
    },

    flushJob: async (jobId) => doFlush(jobId),

    flushAll: async () => {
      for (const jobId of buffers.keys()) {
        await doFlush(jobId);
      }
    },

    destroy: () => {
      for (const buffer of buffers.values()) {
        if (buffer.timer) {
          clearTimeout(buffer.timer);
        }
      }
      buffers.clear();
    },
  };
};



type NativeEventBuffer = {
  events: NativeEventPayload[];
  timer: ReturnType<typeof setTimeout> | null;
};

export const createNativeEventBatcher = (
  apiClient: BridgeApiClient,
  log: PersistenceLogger,
): NativeEventBatcher => {
  const buffers = new Map<string, NativeEventBuffer>();

  const doFlush = async (jobId: string): Promise<void> => {
    const buffer = buffers.get(jobId);
    if (!buffer || buffer.events.length === 0) {
      return;
    }

    const events = [...buffer.events];
    buffer.events = [];

    if (buffer.timer) {
      clearTimeout(buffer.timer);
      buffer.timer = null;
    }

    try {
      await apiClient.persistNativeEvents(jobId, events);
    } catch (error) {
      log("error", `Failed to persist native events for job ${jobId}`, {
        count: events.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return {
    add: (jobId, event) => {
      let buffer = buffers.get(jobId);
      if (!buffer) {
        buffer = { events: [], timer: null };
        buffers.set(jobId, buffer);
      }

      buffer.events.push(event);

      if (buffer.events.length >= EVENT_BATCH_SIZE) {
        void doFlush(jobId);
        return;
      }

      if (!buffer.timer) {
        buffer.timer = setTimeout(
          () => void doFlush(jobId),
          EVENT_FLUSH_INTERVAL_MS,
        );
      }
    },

    flushJob: async (jobId) => doFlush(jobId),

    flushAll: async () => {
      for (const jobId of buffers.keys()) {
        await doFlush(jobId);
      }
    },

    destroy: () => {
      for (const buffer of buffers.values()) {
        if (buffer.timer) {
          clearTimeout(buffer.timer);
        }
      }
      buffers.clear();
    },
  };
};

export const createApiPersistenceStrategy = (
  config: ApiPersistenceStrategyConfig,
): EventPersistenceStrategy => {
  const { apiClient, log, persistSessionEvents = false, persistNativeEvents = false } = config;
  const sessionEventBatcher = persistSessionEvents
    ? createSessionEventBatcher(apiClient, log)
    : null;
  const nativeEventBatcher = persistNativeEvents
    ? createNativeEventBatcher(apiClient, log)
    : null;

  return {
    persistCanonicalEvent: async (event, context) => {
      if (
        sessionEventBatcher &&
        typeof context.sequenceNumber === "number"
      ) {
        sessionEventBatcher.add(
          context.jobId,
          context.sequenceNumber,
          event,
          context.provider,
        );
      }

      switch (event.kind) {
        case "job.completed":
          await apiClient.updateJobStatus(context.jobId, {
            status: "completed",
            result: { summary: event.summary },
          });
          return;

        case "job.incomplete":
          await apiClient.updateJobStatus(context.jobId, {
            status: "incomplete",
            result: {
              summary: event.summary,
              completionState: "incomplete",
              missingWorkItemIds: event.missingWorkItemIds ?? [],
            },
          });
          return;

        case "job.failed":
          await apiClient.updateJobStatus(context.jobId, {
            status: "failed",
            errorMessage: event.errorMessage,
          });
          return;

        default:
          return;
      }
    },

    persistNativeEvent: async (event, context) => {
      nativeEventBatcher?.add(context.jobId, event);
    },

    flushJob: async (jobId) => {
      await Promise.all([
        sessionEventBatcher?.flushJob(jobId),
        nativeEventBatcher?.flushJob(jobId),
      ]);
    },

    flushAll: async () => {
      await Promise.all([
        sessionEventBatcher?.flushAll(),
        nativeEventBatcher?.flushAll(),
      ]);
    },

    destroy: () => {
      sessionEventBatcher?.destroy();
      nativeEventBatcher?.destroy();
    },
  };
};
