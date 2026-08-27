// ---------------------------------------------------------------------------
// Canonical text/thinking coalescer
//
// Consecutive text/thinking deltas are aggregated before persistence. Every
// retained dimension is explicitly bounded: UTF-8 bytes, items, time in the
// active run, and asynchronous flush work. Limits fail closed without copying
// source content into errors or logs.
// ---------------------------------------------------------------------------

import type { CanonicalEvent } from "@almirant/canonical-events";

const DEFAULT_IDLE_MS = 250;
const DEFAULT_MAX_FLUSH_INTERVAL_MS = 2_000;
const DEFAULT_MAX_BUFFER_BYTES = 64 * 1024;
const DEFAULT_MAX_ITEMS_PER_BUFFER = 4_096;
const DEFAULT_MAX_PENDING_FLUSHES = 64;
const DEFAULT_MAX_PENDING_FLUSH_BYTES = 4 * 1024 * 1024;

const utf8Encoder = new TextEncoder();

export type CanonicalTextCoalescerLimitResource =
  | "buffer_bytes"
  | "pending_flushes"
  | "pending_flush_bytes";

/** Safe, typed limit failure. The error never includes source text. */
export class CanonicalTextCoalescerLimitError extends Error {
  readonly code = "CANONICAL_TEXT_COALESCER_LIMIT" as const;

  constructor(
    readonly resource: CanonicalTextCoalescerLimitResource,
    readonly limit: number,
    readonly observed: number,
  ) {
    super(`canonical text coalescer limit exceeded: ${resource}`);
    this.name = "CanonicalTextCoalescerLimitError";
  }
}

export type CanonicalTextCoalescerConfig = {
  /** Called whenever a coalesced or pass-through event is ready to dispatch. */
  onFlush: (event: CanonicalEvent) => void | Promise<void>;
  /** Idle window before the active run is flushed. Defaults to 250ms. */
  idleMs?: number;
  /** Maximum age of an active run even when idle keeps resetting. */
  maxFlushIntervalMs?: number;
  /** Maximum UTF-8 bytes retained in one text/thinking output. */
  maxBufferBytes?: number;
  /** Maximum source events retained in one coalesced output. */
  maxItemsPerBuffer?: number;
  /** Maximum unresolved asynchronous onFlush calls. */
  maxPendingFlushes?: number;
  /** Maximum serialized UTF-8 bytes represented by unresolved flush calls. */
  maxPendingFlushBytes?: number;
  /** Retained for callers that provide a clock; timers remain the flush authority. */
  now?: () => number;
};

export type CanonicalTextCoalescer = {
  push: (event: CanonicalEvent) => void;
  flush: () => void;
  destroy: () => void;
};

type RunKind = "text" | "thinking";

const coalesceKindOf = (event: CanonicalEvent): RunKind | null => {
  if (event.kind === "agent.text" || event.kind === "agent.text.complete") {
    return "text";
  }
  if (event.kind === "agent.thinking") return "thinking";
  return null;
};

const positiveInteger = (value: number | undefined, fallback: number): number => {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 1) {
    throw new RangeError("coalescer limits must be positive finite numbers");
  }
  return Math.floor(value);
};

const utf8Bytes = (value: string): number => utf8Encoder.encode(value).byteLength;

const serializedUtf8Bytes = (event: CanonicalEvent, limit: number): number => {
  try {
    const serialized = JSON.stringify(event);
    if (serialized === undefined) return 0;
    return utf8Bytes(serialized);
  } catch {
    throw new CanonicalTextCoalescerLimitError(
      "pending_flush_bytes",
      limit,
      limit + 1,
    );
  }
};

const asError = (value: unknown): Error =>
  value instanceof Error ? value : new Error("canonical text flush failed");

export const createCanonicalTextCoalescer = (
  config: CanonicalTextCoalescerConfig,
): CanonicalTextCoalescer => {
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
  const maxPendingFlushes = positiveInteger(
    config.maxPendingFlushes,
    DEFAULT_MAX_PENDING_FLUSHES,
  );
  const maxPendingFlushBytes = positiveInteger(
    config.maxPendingFlushBytes,
    DEFAULT_MAX_PENDING_FLUSH_BYTES,
  );

  let runKind: RunKind | null = null;
  let buffer = "";
  let bufferBytes = 0;
  let itemCount = 0;
  let explicitFullText: string | null = null;
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
    if (destroyed) throw new Error("canonical text coalescer is destroyed");
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

  const dispatch = (event: CanonicalEvent): void => {
    assertHealthy();
    let eventBytes: number;
    try {
      eventBytes = serializedUtf8Bytes(event, maxPendingFlushBytes);
    } catch (error) {
      throw latchFatal(error);
    }
    if (pendingFlushes.size >= maxPendingFlushes) {
      throw latchFatal(
        new CanonicalTextCoalescerLimitError(
          "pending_flushes",
          maxPendingFlushes,
          pendingFlushes.size + 1,
        ),
      );
    }
    if (pendingFlushBytes + eventBytes > maxPendingFlushBytes) {
      throw latchFatal(
        new CanonicalTextCoalescerLimitError(
          "pending_flush_bytes",
          maxPendingFlushBytes,
          pendingFlushBytes + eventBytes,
        ),
      );
    }

    let result: void | Promise<void>;
    try {
      result = config.onFlush(event);
    } catch (error) {
      throw latchFatal(error);
    }
    if (!result || typeof result.then !== "function") return;

    // Wrap even when callbacks return the same shared deferred so each accepted
    // flush consumes one independently tracked capacity slot.
    const pending = Promise.resolve(result).then(() => undefined);
    pendingFlushes.add(pending);
    pendingFlushBytes += eventBytes;
    pending.then(
      () => {
        pendingFlushes.delete(pending);
        pendingFlushBytes -= eventBytes;
      },
      (error) => {
        pendingFlushes.delete(pending);
        pendingFlushBytes -= eventBytes;
        latchFatal(error);
      },
    );
  };

  const resetRun = (): void => {
    runKind = null;
    buffer = "";
    bufferBytes = 0;
    itemCount = 0;
    explicitFullText = null;
  };

  const flushBuffer = (): void => {
    assertHealthy();
    clearRunTimers();
    if (runKind === null || (bufferBytes === 0 && explicitFullText === null)) {
      resetRun();
      return;
    }

    const aggregated: CanonicalEvent = runKind === "thinking"
      ? { kind: "agent.thinking", content: buffer }
      : explicitFullText !== null
        ? { kind: "agent.text.complete", fullText: explicitFullText }
        : { kind: "agent.text", content: buffer };
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

  const startRun = (kind: RunKind): void => {
    runKind = kind;
    buffer = "";
    bufferBytes = 0;
    itemCount = 0;
    explicitFullText = null;
    maxFlushTimer = setTimeout(flushFromTimer, maxFlushIntervalMs);
  };

  const scheduleIdleFlush = (): void => {
    clearIdleTimer();
    idleTimer = setTimeout(flushFromTimer, idleMs);
  };

  const failOversize = (observed: number): never => {
    clearRunTimers();
    throw latchFatal(
      new CanonicalTextCoalescerLimitError(
        "buffer_bytes",
        maxBufferBytes,
        observed,
      ),
    );
  };

  const push = (event: CanonicalEvent): void => {
    assertHealthy();
    const kind = coalesceKindOf(event);

    if (kind === null) {
      flushBuffer();
      dispatch(event);
      return;
    }

    if (runKind !== null && runKind !== kind) flushBuffer();
    if (runKind === null) startRun(kind);
    if (itemCount >= maxItemsPerBuffer) {
      flushBuffer();
      startRun(kind);
    }

    const content = event.kind === "agent.text.complete"
      ? event.fullText
      : event.kind === "agent.text" || event.kind === "agent.thinking"
        ? event.content
        : "";
    const contentBytes = utf8Bytes(content);
    if (contentBytes > maxBufferBytes) failOversize(contentBytes);

    if (
      event.kind !== "agent.text.complete" &&
      explicitFullText === null &&
      bufferBytes + contentBytes > maxBufferBytes
    ) {
      flushBuffer();
      startRun(kind);
    }

    itemCount += 1;
    if (event.kind === "agent.text.complete") {
      explicitFullText = event.fullText;
      buffer = "";
      bufferBytes = 0;
    } else if (explicitFullText === null) {
      buffer += content;
      bufferBytes += contentBytes;
    }

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
