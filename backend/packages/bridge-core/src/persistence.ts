import {
  assertValidNativeEventMetadata,
  type CanonicalEvent,
  type NativeInfrastructureProvider,
} from "@almirant/canonical-events";

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
  occurredAt?: string;
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
  /** Infrastructure provider only. */
  provider?: NativeInfrastructureProvider;
  codingAgent?: string;
  aiProvider?: string;
  model?: string;
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
    occurredAt?: string,
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
  /** Producer wall-clock emission time, sourced from the canonical envelope's own timestamp. */
  occurredAt?: string;
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
  /** Overridable for tests; 0 flushes on the next macrotask. */
  durableNativeWindowMs?: number;
  durableNativeMaxEvents?: number;
  durableNativeMaxBytes?: number;
};

const EVENT_FLUSH_INTERVAL_MS = 500;
const EVENT_BATCH_SIZE = 20;

// Durable native batching. The window is two orders of magnitude below
// EVENT_FLUSH_INTERVAL_MS on purpose: the last partial batch of a job delays its
// finalization, and the real budget there is the slack the runner leaves before
// the control plane's finalizing watchdog fires — not the watchdog itself, which
// measures a column no event write refreshes. With page concurrency the window is
// rarely the trigger anyway, because a page's native events arrive within a
// millisecond or two of each other and the size cap fires first.
const DURABLE_NATIVE_WINDOW_MS = 10;
const DURABLE_NATIVE_MAX_EVENTS = 250;
// Measured on live jobs: the largest native payload seen is ~37 KB, p99.9 is
// ~2.3 KB. A 1 MiB cap is far above the largest event ever observed and far below
// the server's body limit, so a batch can never turn a slow write into a 413 —
// which is not retryable, and would mean the DLQ plus a receipt parity the runner
// can never reach.
const DURABLE_NATIVE_MAX_BYTES = 1_048_576;

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
      for (const event of events) {
        assertValidNativeEventMetadata(event);
      }
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
      occurredAt,
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
        occurredAt,
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

type DurableNativeWaiter = {
  event: NativeEventPayload;
  resolve: () => void;
  reject: (error: unknown) => void;
};

type DurableNativeBuffer = {
  waiters: DurableNativeWaiter[];
  bytes: number;
  timer: ReturnType<typeof setTimeout> | null;
};

const estimateNativeEventBytes = (event: NativeEventPayload): number => {
  try {
    return JSON.stringify(event.payload).length;
  } catch {
    return DURABLE_NATIVE_MAX_BYTES;
  }
};

/**
 * Batch-and-await collector for durable.v2 native events.
 *
 * An in-memory batch is still not durability: every caller stays parked until the
 * API confirms the insert for the batch carrying ITS event, so the
 * reader-owned ACK continues to follow the database write. The only thing that
 * changes is how many rows travel per request — and that is the entire cost.
 * Measured on a live job: ~49ms fixed per request against ~0.3-0.9ms per row, so
 * 34,935 one-row requests took 441s of draining after the agent had finished.
 *
 * Grouping is per (jobId, claimAttemptId) because the route rejects a batch that
 * mixes durable and legacy events and the repository rejects one that crosses
 * jobs. A badly grouped batch would not degrade gracefully — it would go to the
 * dead-letter queue whole, with no retry.
 */
const createDurableNativeCollector = (config: {
  apiClient: BridgeApiClient;
  log: PersistenceLogger;
  windowMs: number;
  maxEvents: number;
  maxBytes: number;
}) => {
  const { apiClient, log, windowMs, maxEvents, maxBytes } = config;
  const buffers = new Map<string, DurableNativeBuffer>();

  const flush = async (key: string, jobId: string): Promise<void> => {
    const buffer = buffers.get(key);
    if (!buffer) return;
    // Detach before the first await. A concurrent add() then starts a fresh
    // buffer with its own timer, so no event can be appended to a batch already
    // in flight and none can be dropped between the two.
    buffers.delete(key);
    if (buffer.timer) clearTimeout(buffer.timer);
    const waiters = buffer.waiters;
    if (waiters.length === 0) return;

    const pending = new Set(waiters);
    const settle = (
      group: Iterable<DurableNativeWaiter>,
      error?: unknown,
    ): void => {
      for (const waiter of [...group]) {
        if (!pending.delete(waiter)) continue;
        if (error === undefined) waiter.resolve();
        else waiter.reject(error);
      }
    };

    try {
      // Two entries can carry the same sequence: recovery feeds the same
      // processing path and a reclaimed redelivery can land beside its original.
      // Send one row per sequence — mirroring what the session path already does
      // in the repository and the native path does not — and settle every waiter
      // for that sequence with the outcome of that single row. The receipt
      // counter stays exact because it comes from the INSERT's RETURNING, never
      // from the length of the batch we sent.
      const bySequence = new Map<number, DurableNativeWaiter[]>();
      for (const waiter of waiters) {
        const group = bySequence.get(waiter.event.sequenceNum);
        if (group) group.push(waiter);
        else bySequence.set(waiter.event.sequenceNum, [waiter]);
      }
      const events = [...bySequence.values()].map((group) => group[0]!.event);

      try {
        await apiClient.persistNativeEvents(jobId, events);
        settle(waiters);
        return;
      } catch (error) {
        if (events.length === 1 || isRetryablePersistenceError(error)) {
          // Retryable: reject everyone. The entries stay pending in Redis and
          // recovery redelivers them. A batch that committed but whose response
          // was lost re-inserts zero rows and adds zero to the counter, so the
          // retry is idempotent in the direction that matters.
          settle(waiters, error);
          return;
        }
        // The fence is all-or-nothing, so a non-retryable batch rejection says
        // nothing about WHICH event was refused. Re-send one row at a time so
        // only the offending event is quarantined: the dead-letter blast radius
        // stays exactly what it is today, one event, instead of taking N-1
        // healthy siblings down with it.
        log("warn", "durable native batch rejected; isolating per event", {
          jobId,
          count: events.length,
          error: error instanceof Error ? error.message : String(error),
        });
        for (const group of bySequence.values()) {
          try {
            await apiClient.persistNativeEvents(jobId, [group[0]!.event]);
            settle(group);
          } catch (individualError) {
            settle(group, individualError);
          }
        }
      }
    } finally {
      // No waiter may be left parked. The reader would never ACK its entry and
      // drain() would never return, hanging shutdown until it is killed.
      settle(pending, new Error("durable native batch flush did not settle"));
    }
  };

  return {
    add: (
      jobId: string,
      claimAttemptId: string,
      event: NativeEventPayload,
    ): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        const key = `${jobId} ${claimAttemptId}`;
        let buffer = buffers.get(key);
        if (!buffer) {
          buffer = { waiters: [], bytes: 0, timer: null };
          buffers.set(key, buffer);
        }
        buffer.waiters.push({ event, resolve, reject });
        buffer.bytes += estimateNativeEventBytes(event);

        if (buffer.waiters.length >= maxEvents || buffer.bytes >= maxBytes) {
          void flush(key, jobId);
          return;
        }
        if (!buffer.timer) {
          buffer.timer = setTimeout(() => void flush(key, jobId), windowMs);
        }
      }),
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
  const durableNativeCollector = persistNativeEvents
    ? createDurableNativeCollector({
        apiClient,
        log,
        windowMs: config.durableNativeWindowMs ?? DURABLE_NATIVE_WINDOW_MS,
        maxEvents: config.durableNativeMaxEvents ?? DURABLE_NATIVE_MAX_EVENTS,
        maxBytes: config.durableNativeMaxBytes ?? DURABLE_NATIVE_MAX_BYTES,
      })
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
          occurredAt: context.occurredAt,
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
            context.occurredAt,
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
        const claimAttemptId = event.claimAttemptId?.trim();
        if (!claimAttemptId || !durableNativeCollector) {
          // The route refuses a durable event without a claim attempt id. Keep
          // it on the single-event path so a malformed envelope behaves exactly
          // as it does today and can never poison a healthy batch.
          await apiClient.persistNativeEvents(context.jobId, [event]);
          return;
        }
        // Still one awaited round trip from the handler's point of view: this
        // resolves only once the API has confirmed the batch carrying THIS
        // event, so the reader-owned ACK still follows the database write.
        await durableNativeCollector.add(context.jobId, claimAttemptId, event);
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
