// ---------------------------------------------------------------------------
// Native `message.part.delta` coalescer
//
// Consecutive deltas for one session/content key are concatenated, with durable
// sequence allocation left to the flush callback. Every retained dimension is
// bounded so high-rate runtimes and slow publishers cannot grow memory without
// limit. Limit failures expose numeric metadata only, never source content.
// ---------------------------------------------------------------------------

export type NativeDeltaEnvelopeInput = {
  nativeEventType: string;
  payload?: unknown;
  [key: string]: unknown;
};

const DEFAULT_IDLE_MS = 250;
const DEFAULT_MAX_FLUSH_INTERVAL_MS = 2_000;
const DEFAULT_MAX_BUFFER_BYTES = 64 * 1024;
const DEFAULT_MAX_ITEMS_PER_BUFFER = 4_096;
const DEFAULT_MAX_KEY_BYTES = 1_024;
const DEFAULT_MAX_PENDING_FLUSHES = 64;
const DEFAULT_MAX_PENDING_FLUSH_BYTES = 4 * 1024 * 1024;
const COALESCEABLE_EVENT_TYPE = "message.part.delta";

const utf8Encoder = new TextEncoder();

export type NativeDeltaCoalescerLimitResource =
  | "buffer_bytes"
  | "key_bytes"
  | "pending_flushes"
  | "pending_flush_bytes";

/** Safe, typed limit failure. The error never includes source text or keys. */
export class NativeDeltaCoalescerLimitError extends Error {
  readonly code = "NATIVE_DELTA_COALESCER_LIMIT" as const;

  constructor(
    readonly resource: NativeDeltaCoalescerLimitResource,
    readonly limit: number,
    readonly observed: number,
  ) {
    super(`native delta coalescer limit exceeded: ${resource}`);
    this.name = "NativeDeltaCoalescerLimitError";
  }
}

export type NativeDeltaCoalescerConfig = {
  /** Called whenever an aggregated or pass-through envelope is ready. */
  onFlush: (envelope: NativeDeltaEnvelopeInput) => void | Promise<void>;
  /** Idle window before the active run is flushed. Defaults to 250ms. */
  idleMs?: number;
  /** Maximum age of an active run even when idle keeps resetting. */
  maxFlushIntervalMs?: number;
  /** Maximum UTF-8 bytes retained in one aggregated native delta. */
  maxBufferBytes?: number;
  /** Maximum source deltas retained in one aggregated native delta. */
  maxItemsPerBuffer?: number;
  /** Maximum UTF-8 bytes in the session/content coalesce key. */
  maxKeyBytes?: number;
  /** Maximum unresolved asynchronous onFlush calls. */
  maxPendingFlushes?: number;
  /** Maximum serialized UTF-8 bytes represented by unresolved flush calls. */
  maxPendingFlushBytes?: number;
};

export type NativeDeltaCoalescer = {
  push: (envelope: NativeDeltaEnvelopeInput) => void;
  flush: () => void;
  destroy: () => void;
};

type DeltaParts = {
  delta: string;
  sessionId: string;
  contentType: string;
};

/** Only the exact object shape is aggregated; all other inputs pass through. */
const readDeltaParts = (envelope: NativeDeltaEnvelopeInput): DeltaParts | null => {
  const payload = envelope.payload;
  if (typeof payload !== "object" || payload === null) return null;
  const data = (payload as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return null;
  const properties = (data as { properties?: unknown }).properties;
  if (typeof properties !== "object" || properties === null) return null;
  const { delta, sessionId, contentType } = properties as Record<string, unknown>;
  if (typeof delta !== "string") return null;
  return {
    delta,
    sessionId: typeof sessionId === "string" ? sessionId : "",
    contentType: typeof contentType === "string" ? contentType : "",
  };
};

const withDelta = (
  envelope: NativeDeltaEnvelopeInput,
  delta: string,
): NativeDeltaEnvelopeInput => {
  const payload = envelope.payload as { data: { properties: Record<string, unknown> } };
  return {
    ...envelope,
    payload: {
      ...(payload as unknown as Record<string, unknown>),
      data: {
        ...payload.data,
        properties: { ...payload.data.properties, delta },
      },
    },
  };
};

const positiveInteger = (value: number | undefined, fallback: number): number => {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 1) {
    throw new RangeError("coalescer limits must be positive finite numbers");
  }
  return Math.floor(value);
};

const utf8Bytes = (value: string): number => utf8Encoder.encode(value).byteLength;

const serializedUtf8Bytes = (
  envelope: NativeDeltaEnvelopeInput,
  limit: number,
): number => {
  try {
    const serialized = JSON.stringify(envelope);
    if (serialized === undefined) return 0;
    return utf8Bytes(serialized);
  } catch {
    throw new NativeDeltaCoalescerLimitError(
      "pending_flush_bytes",
      limit,
      limit + 1,
    );
  }
};

const asError = (value: unknown): Error =>
  value instanceof Error ? value : new Error("native delta flush failed");

export const createNativeDeltaCoalescer = (
  config: NativeDeltaCoalescerConfig,
): NativeDeltaCoalescer => {
  const idleMs = positiveInteger(config.idleMs, DEFAULT_IDLE_MS);
  const maxFlushIntervalMs = positiveInteger(
    config.maxFlushIntervalMs,
    DEFAULT_MAX_FLUSH_INTERVAL_MS,
  );
  const maxBufferBytes = positiveInteger(
    config.maxBufferBytes,
    DEFAULT_MAX_BUFFER_BYTES,
  );
  const maxItemsPerBuffer = positiveInteger(
    config.maxItemsPerBuffer,
    DEFAULT_MAX_ITEMS_PER_BUFFER,
  );
  const maxKeyBytes = positiveInteger(config.maxKeyBytes, DEFAULT_MAX_KEY_BYTES);
  const maxPendingFlushes = positiveInteger(
    config.maxPendingFlushes,
    DEFAULT_MAX_PENDING_FLUSHES,
  );
  const maxPendingFlushBytes = positiveInteger(
    config.maxPendingFlushBytes,
    DEFAULT_MAX_PENDING_FLUSH_BYTES,
  );

  let runEnvelope: NativeDeltaEnvelopeInput | null = null;
  let runKey: string | null = null;
  let buffer = "";
  let bufferBytes = 0;
  let itemCount = 0;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let maxFlushTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingFlushBytes = 0;
  let fatalError: Error | null = null;
  let destroyed = false;
  const pendingFlushes = new Set<Promise<void>>();

  const latchFatal = (error: unknown): Error => {
    fatalError ??= asError(error);
    return fatalError;
  };

  const assertHealthy = (): void => {
    if (fatalError) throw fatalError;
    if (destroyed) throw new Error("native delta coalescer is destroyed");
  };

  const clearIdleTimer = (): void => {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  const clearMaxFlushTimer = (): void => {
    if (maxFlushTimer !== null) {
      clearTimeout(maxFlushTimer);
      maxFlushTimer = null;
    }
  };

  const clearRunTimers = (): void => {
    clearIdleTimer();
    clearMaxFlushTimer();
  };

  const dispatch = (envelope: NativeDeltaEnvelopeInput): void => {
    assertHealthy();
    let envelopeBytes: number;
    try {
      envelopeBytes = serializedUtf8Bytes(envelope, maxPendingFlushBytes);
    } catch (error) {
      throw latchFatal(error);
    }
    if (pendingFlushes.size >= maxPendingFlushes) {
      throw latchFatal(
        new NativeDeltaCoalescerLimitError(
          "pending_flushes",
          maxPendingFlushes,
          pendingFlushes.size + 1,
        ),
      );
    }
    if (pendingFlushBytes + envelopeBytes > maxPendingFlushBytes) {
      throw latchFatal(
        new NativeDeltaCoalescerLimitError(
          "pending_flush_bytes",
          maxPendingFlushBytes,
          pendingFlushBytes + envelopeBytes,
        ),
      );
    }

    let result: void | Promise<void>;
    try {
      result = config.onFlush(envelope);
    } catch (error) {
      throw latchFatal(error);
    }
    if (!result || typeof result.then !== "function") return;

    // Wrap even when callbacks return the same shared deferred so each accepted
    // flush consumes one independently tracked capacity slot.
    const pending = Promise.resolve(result).then(() => undefined);
    pendingFlushes.add(pending);
    pendingFlushBytes += envelopeBytes;
    pending.then(
      () => {
        pendingFlushes.delete(pending);
        pendingFlushBytes -= envelopeBytes;
      },
      (error) => {
        pendingFlushes.delete(pending);
        pendingFlushBytes -= envelopeBytes;
        latchFatal(error);
      },
    );
  };

  const resetRun = (): void => {
    runEnvelope = null;
    runKey = null;
    buffer = "";
    bufferBytes = 0;
    itemCount = 0;
  };

  const flushBuffer = (): void => {
    assertHealthy();
    clearRunTimers();
    if (!runEnvelope) return;
    const aggregated = withDelta(runEnvelope, buffer);
    resetRun();
    dispatch(aggregated);
  };

  const flushFromTimer = (): void => {
    try {
      flushBuffer();
    } catch (error) {
      latchFatal(error);
      clearRunTimers();
    }
  };

  const startRun = (
    envelope: NativeDeltaEnvelopeInput,
    key: string,
  ): void => {
    runEnvelope = envelope;
    runKey = key;
    buffer = "";
    bufferBytes = 0;
    itemCount = 0;
    maxFlushTimer = setTimeout(flushFromTimer, maxFlushIntervalMs);
  };

  const scheduleIdleFlush = (): void => {
    clearIdleTimer();
    idleTimer = setTimeout(flushFromTimer, idleMs);
  };

  const failLimit = (
    resource: NativeDeltaCoalescerLimitResource,
    limit: number,
    observed: number,
  ): never => {
    clearRunTimers();
    throw latchFatal(new NativeDeltaCoalescerLimitError(resource, limit, observed));
  };

  const push = (envelope: NativeDeltaEnvelopeInput): void => {
    assertHealthy();
    const parts = envelope.nativeEventType === COALESCEABLE_EVENT_TYPE
      ? readDeltaParts(envelope)
      : null;

    if (!parts) {
      flushBuffer();
      dispatch(envelope);
      return;
    }

    const keyBytes = utf8Bytes(parts.sessionId) + 1 + utf8Bytes(parts.contentType);
    if (keyBytes > maxKeyBytes) failLimit("key_bytes", maxKeyBytes, keyBytes);
    const deltaBytes = utf8Bytes(parts.delta);
    if (deltaBytes > maxBufferBytes) {
      failLimit("buffer_bytes", maxBufferBytes, deltaBytes);
    }
    const key = `${parts.sessionId}\0${parts.contentType}`;

    if (runEnvelope && runKey !== key) flushBuffer();
    if (!runEnvelope) startRun(envelope, key);
    if (itemCount >= maxItemsPerBuffer) {
      flushBuffer();
      startRun(envelope, key);
    }
    if (bufferBytes + deltaBytes > maxBufferBytes) {
      flushBuffer();
      startRun(envelope, key);
    }

    buffer += parts.delta;
    bufferBytes += deltaBytes;
    itemCount += 1;
    scheduleIdleFlush();
  };

  return {
    push,
    flush: flushBuffer,
    destroy: () => {
      if (destroyed) return;
      flushBuffer();
      clearRunTimers();
      destroyed = true;
    },
  };
};
