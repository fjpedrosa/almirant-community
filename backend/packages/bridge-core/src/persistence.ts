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
  /** Test/runtime injection point. Defaults to globalThis.fetch. */
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  requestRetry?: Pick<RetryOptions, "maxRetries" | "baseDelayMs">;
};

export class PersistenceRequestError extends Error {
  readonly retryable: boolean;
  readonly status?: number;

  constructor(
    message: string,
    options: { retryable: boolean; status?: number; cause?: unknown },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "PersistenceRequestError";
    this.retryable = options.retryable;
    this.status = options.status;
  }
}

export type JobStatusPayload = {
  status: "completed" | "incomplete" | "failed";
  result?: Record<string, unknown>;
  errorMessage?: string;
};

export type SessionEventPayload = {
  sequenceNum: number;
  sequenceProtocolVersion?: "durable.v2";
  claimAttemptId?: string;
  kind: string;
  payload: Record<string, unknown>;
  provider?: string;
};

export type SessionEventPersistenceResult = {
  inserted: number;
};

export type NativeEventPayload = {
  sequenceNum: number;
  sequenceProtocolVersion?: "durable.v2";
  claimAttemptId?: string;
  nativeEventType: string;
  sourceFormat: string;
  payload: Record<string, unknown>;
  provider?: string;
  codingAgent?: string;
  runtimeSessionId?: string;
  emittedAt?: string;
};

export type BridgeApiClient = {
  checkCredential: () => Promise<void>;
  updateJobStatus: (jobId: string, payload: JobStatusPayload) => Promise<void>;
  persistSessionEvents: (
    jobId: string,
    events: SessionEventPayload[],
  ) => Promise<SessionEventPersistenceResult>;
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
    sequenceProtocolVersion?: "durable.v2",
    claimAttemptId?: string,
  ) => void;
  flushJob: (jobId: string) => Promise<void>;
  flushAll: () => Promise<void>;
  destroy: () => void;
};

export type EventPersistenceContext = {
  jobId: string;
  sequenceNumber?: number;
  provider?: string;
  sequenceProtocolVersion?: "durable.v2";
  claimAttemptId?: string;
};

export type EventPersistenceStrategy = {
  persistCanonicalEvent: (
    event: CanonicalEvent,
    context: EventPersistenceContext,
  ) => Promise<boolean>;
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

const isRetryableHttpStatus = (status: number): boolean =>
  status === 408 || status === 425 || status === 429 || status >= 500;

const isRetryablePersistenceError = (error: unknown): boolean => {
  if (
    typeof error === "object" &&
    error !== null &&
    "retryable" in error &&
    typeof error.retryable === "boolean"
  ) {
    return error.retryable;
  }

  // Backward compatibility for callers that use withPersistenceRetry directly.
  const message = error instanceof Error ? error.message : String(error);
  return /\b(408|425|429|5\d\d)\b/.test(message);
};

const parseSessionEventPersistenceResult = (
  response: unknown,
  eventCount: number,
): SessionEventPersistenceResult => {
  const inserted =
    typeof response === "object" &&
    response !== null &&
    "success" in response &&
    response.success === true &&
    "data" in response &&
    typeof response.data === "object" &&
    response.data !== null &&
    "inserted" in response.data
      ? response.data.inserted
      : undefined;

  if (
    !Number.isSafeInteger(inserted) ||
    (inserted as number) < 0 ||
    (inserted as number) > eventCount
  ) {
    throw new PersistenceRequestError(
      "invalid session-events persistence response",
      { retryable: false },
    );
  }

  return { inserted: inserted as number };
};

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
      if (attempt < opts.maxRetries && isRetryablePersistenceError(error)) {
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
  const {
    baseUrl,
    apiKey,
    log,
    fetch: fetchFn = globalThis.fetch,
    requestRetry = { maxRetries: 3, baseDelayMs: 200 },
  } = config;

  const request = async <T = unknown>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> => {
    const url = `${baseUrl}${path}`;

    const response = await withPersistenceRetry(
      async () => {
        let response: Response;
        try {
          response = await fetchFn(url, {
            ...options,
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
              ...options.headers,
            },
          });
        } catch (error) {
          throw new PersistenceRequestError(
            `Persistence transport failed for ${path}`,
            { retryable: true, cause: error },
          );
        }

        if (!response.ok) {
          const body = await response.text().catch(() => "");
          throw new PersistenceRequestError(
            `API error ${response.status}: ${body.slice(0, 200)}`,
            {
              retryable: isRetryableHttpStatus(response.status),
              status: response.status,
            },
          );
        }

        return response;
      },
      {
        maxRetries: requestRetry.maxRetries,
        baseDelayMs: requestRetry.baseDelayMs,
        label: path,
      },
    );

    const json = await response.json().catch(() => null);
    return json as T;
  };

  const logAndRethrow = (path: string, error: unknown): never => {
    log("error", `API request failed: ${path}`, {
      status:
        error instanceof PersistenceRequestError ? error.status : undefined,
      retryable:
        error instanceof PersistenceRequestError ? error.retryable : undefined,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  };

  return {
    checkCredential: async () => {
      const path = "/workers/credential-check";
      try {
        await request(path);
      } catch (error) {
        return logAndRethrow(path, error);
      }
    },

    updateJobStatus: async (jobId, payload) => {
      const path = `/workers/jobs/${jobId}/status`;
      try {
        await request(path, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      } catch (error) {
        return logAndRethrow(path, error);
      }
    },

    persistSessionEvents: async (jobId, events) => {
      if (events.length === 0) return { inserted: 0 };
      const path = `/workers/agent-jobs/${jobId}/session-events`;
      try {
        const response = await request<unknown>(path, {
          method: "POST",
          body: JSON.stringify({ events }),
        });
        return parseSessionEventPersistenceResult(response, events.length);
      } catch (error) {
        return logAndRethrow(path, error);
      }
    },

    persistNativeEvents: async (jobId, events) => {
      if (events.length === 0) return;
      const path = `/workers/agent-jobs/${jobId}/native-events`;
      try {
        await request(path, {
          method: "POST",
          body: JSON.stringify({ events }),
        });
      } catch (error) {
        logAndRethrow(path, error);
      }
    },
  };
};

type SessionEventBuffer = {
  events: SessionEventPayload[];
  timer: ReturnType<typeof setTimeout> | null;
  flushing: Promise<void> | null;
};

export const createSessionEventBatcher = (
  apiClient: BridgeApiClient,
  log: PersistenceLogger,
): SessionEventBatcher => {
  const buffers = new Map<string, SessionEventBuffer>();

  const doFlush = async (jobId: string): Promise<void> => {
    const buffer = buffers.get(jobId);
    if (!buffer) return;

    if (buffer.timer) {
      clearTimeout(buffer.timer);
      buffer.timer = null;
    }
    if (buffer.events.length === 0) return;

    if (buffer.flushing) return buffer.flushing;

    const flush = async (): Promise<void> => {
      while (buffer.events.length > 0) {
        const events = [...buffer.events];
        try {
          await apiClient.persistSessionEvents(jobId, events);
        } catch (error) {
          log("error", `Failed to persist session events for job ${jobId}`, {
            count: events.length,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
        // Remove only the exact prefix acknowledged by the API. Events added
        // concurrently remain buffered for the next loop iteration.
        buffer.events.splice(0, events.length);
      }
    };

    buffer.flushing = flush().finally(() => {
      buffer.flushing = null;
    });
    return buffer.flushing;
  };

  return {
    add: (
      jobId,
      sequenceNum,
      event,
      provider,
      sequenceProtocolVersion,
      claimAttemptId,
    ) => {
      let buffer = buffers.get(jobId);
      if (!buffer) {
        buffer = { events: [], timer: null, flushing: null };
        buffers.set(jobId, buffer);
      }

      buffer.events.push({
        sequenceNum,
        kind: event.kind,
        payload: event as unknown as Record<string, unknown>,
        provider,
        sequenceProtocolVersion,
        claimAttemptId,
      });

      if (buffer.events.length >= EVENT_BATCH_SIZE) {
        void doFlush(jobId).catch(() => undefined);
        return;
      }

      if (!buffer.timer) {
        buffer.timer = setTimeout(
          () => void doFlush(jobId).catch(() => undefined),
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
      let pendingCount = 0;
      for (const buffer of buffers.values()) {
        if (buffer.timer) {
          clearTimeout(buffer.timer);
        }
        pendingCount += buffer.events.length;
        if (buffer.flushing) pendingCount += 1;
      }
      if (pendingCount > 0) {
        throw new Error(
          `Cannot destroy session event batcher with ${pendingCount} pending operation(s)`,
        );
      }
      buffers.clear();
    },
  };
};



type NativeEventBuffer = {
  events: NativeEventPayload[];
  timer: ReturnType<typeof setTimeout> | null;
  flushing: Promise<void> | null;
};

export const createNativeEventBatcher = (
  apiClient: BridgeApiClient,
  log: PersistenceLogger,
): NativeEventBatcher => {
  const buffers = new Map<string, NativeEventBuffer>();

  const doFlush = async (jobId: string): Promise<void> => {
    const buffer = buffers.get(jobId);
    if (!buffer) return;

    if (buffer.timer) {
      clearTimeout(buffer.timer);
      buffer.timer = null;
    }
    if (buffer.events.length === 0) return;

    if (buffer.flushing) return buffer.flushing;

    const flush = async (): Promise<void> => {
      while (buffer.events.length > 0) {
        const events = [...buffer.events];
        try {
          await apiClient.persistNativeEvents(jobId, events);
        } catch (error) {
          log("error", `Failed to persist native events for job ${jobId}`, {
            count: events.length,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
        buffer.events.splice(0, events.length);
      }
    };

    buffer.flushing = flush().finally(() => {
      buffer.flushing = null;
    });
    return buffer.flushing;
  };

  return {
    add: (jobId, event) => {
      let buffer = buffers.get(jobId);
      if (!buffer) {
        buffer = { events: [], timer: null, flushing: null };
        buffers.set(jobId, buffer);
      }

      buffer.events.push(event);

      if (buffer.events.length >= EVENT_BATCH_SIZE) {
        void doFlush(jobId).catch(() => undefined);
        return;
      }

      if (!buffer.timer) {
        buffer.timer = setTimeout(
          () => void doFlush(jobId).catch(() => undefined),
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
      let pendingCount = 0;
      for (const buffer of buffers.values()) {
        if (buffer.timer) {
          clearTimeout(buffer.timer);
        }
        pendingCount += buffer.events.length;
        if (buffer.flushing) pendingCount += 1;
      }
      if (pendingCount > 0) {
        throw new Error(
          `Cannot destroy native event batcher with ${pendingCount} pending operation(s)`,
        );
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
      let shouldRender = true;
      if (
        sessionEventBatcher &&
        typeof context.sequenceNumber === "number"
      ) {
        const payload: SessionEventPayload = {
          sequenceNum: context.sequenceNumber,
          kind: event.kind,
          payload: event as unknown as Record<string, unknown>,
          provider: context.provider,
          sequenceProtocolVersion: context.sequenceProtocolVersion,
          claimAttemptId: context.claimAttemptId,
        };
        if (context.sequenceProtocolVersion === "durable.v2") {
          // An in-memory batch is not durability. The Redis message remains
          // pending until the API confirms the database insert.
          const result = await apiClient.persistSessionEvents(
            context.jobId,
            [payload],
          );
          shouldRender = result.inserted > 0;
        } else {
          sessionEventBatcher.add(
            context.jobId,
            context.sequenceNumber,
            event,
            context.provider,
            context.sequenceProtocolVersion,
            context.claimAttemptId,
          );
        }
      }

      // Durable jobs are status-owned by the exact runner claim. The bridge
      // persists/renders events but must not issue an unfenced terminal write.
      if (context.sequenceProtocolVersion === "durable.v2") {
        return shouldRender;
      }

      switch (event.kind) {
        case "job.completed":
          await apiClient.updateJobStatus(context.jobId, {
            status: "completed",
            result: { summary: event.summary },
          });
          return true;

        case "job.incomplete":
          await apiClient.updateJobStatus(context.jobId, {
            status: "incomplete",
            result: {
              summary: event.summary,
              completionState: "incomplete",
              missingWorkItemIds: event.missingWorkItemIds ?? [],
            },
          });
          return true;

        case "job.failed":
          await apiClient.updateJobStatus(context.jobId, {
            status: "failed",
            errorMessage: event.errorMessage,
          });
          return true;

        default:
          return true;
      }
    },

    persistNativeEvent: async (event, context) => {
      if (!nativeEventBatcher) return;
      if (event.sequenceProtocolVersion === "durable.v2") {
        await apiClient.persistNativeEvents(context.jobId, [event]);
        return;
      }
      nativeEventBatcher.add(context.jobId, event);
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
