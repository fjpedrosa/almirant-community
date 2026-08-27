// ---------------------------------------------------------------------------
// Stream event publishing utilities
//
// Extracted from job-executor.ts — sequence tracking, stream channel adapter,
// and fire-and-forget event publishers.
// ---------------------------------------------------------------------------

import type {
  StreamPublisher,
  AgentOutputEvent,
  CanonicalEventEnvelope,
  NativeEventEnvelope,
  StreamPublisherOperationOptions,
} from "@almirant/stream-consumer";
import {
  DURABLE_SEQUENCE_PROTOCOL_VERSION,
  normalizeCanonicalEnvelope,
} from "@almirant/stream-consumer";
import type { DiscordRichChannelAdapter } from "@almirant/remote-agent";
import { AsyncLocalStorage } from "node:async_hooks";
import { sanitizeLogContent } from "../observability/log-sanitizer";

/** Interval in ms for throttled queue publishing of streaming output. */
export const QUEUE_PUBLISH_THROTTLE_MS = 2_000;

// ---------------------------------------------------------------------------
// Sequence number tracking for stream events
// ---------------------------------------------------------------------------

type SequenceChannelState = {
  readonly base: number;
  allocated: number;
  committed: number;
  reservationEnd?: number;
  tail: Promise<void>;
};

type StreamSequenceState = {
  canonical: SequenceChannelState;
  native: SequenceChannelState;
  legacyOutputSequence: number;
  claimAttemptId?: string;
  ensureReservation?: (
    channel: "sessionEvents" | "nativeEvents",
    requiredThrough: number,
    requestOptions?: StreamPublisherOperationOptions,
  ) => Promise<number>;
  frozen: boolean;
  fatalError?: Error;
};

export type StreamSequenceBases = {
  canonical: number;
  native: number;
  canonicalEnd?: number;
  nativeEnd?: number;
  claimAttemptId?: string;
  ensureReservation?: StreamSequenceState["ensureReservation"];
};

const streamSequenceStorage = new AsyncLocalStorage<StreamSequenceState>();
let _legacyCanonicalSequence = 0;
let _legacyNativeSequence = 0;
let _legacyOutputSequence = 0;

/**
 * Scope sequence generators to one claimed job execution. AsyncLocalStorage
 * keeps concurrently executing jobs isolated while preserving the durable
 * high-water marks returned by the atomic claim.
 */
export const runWithStreamSequenceBases = <T>(
  bases: StreamSequenceBases,
  callback: () => T,
): T => streamSequenceStorage.run({
  canonical: {
    base: bases.canonical,
    allocated: bases.canonical,
    committed: bases.canonical,
    reservationEnd: bases.canonicalEnd,
    tail: Promise.resolve(),
  },
  native: {
    base: bases.native,
    allocated: bases.native,
    committed: bases.native,
    reservationEnd: bases.nativeEnd,
    tail: Promise.resolve(),
  },
  legacyOutputSequence: 0,
  claimAttemptId: bases.claimAttemptId,
  ensureReservation: bases.ensureReservation,
  frozen: false,
}, callback);

export type StreamSequenceHighWater = {
  canonical: number;
  native: number;
};

export const getCurrentStreamSequenceHighWater = (): StreamSequenceHighWater => {
  const state = streamSequenceStorage.getStore();
  if (!state) {
    throw new Error("stream sequence high-water marks require an active job execution");
  }
  return {
    canonical: state.canonical.committed,
    native: state.native.committed,
  };
};

export const nextSequence = (): number => {
  const state = streamSequenceStorage.getStore();
  if (!state) return ++_legacyCanonicalSequence;
  return ++state.canonical.allocated;
};

export const nextNativeSequence = (): number => {
  const state = streamSequenceStorage.getStore();
  if (!state) return ++_legacyNativeSequence;
  return ++state.native.allocated;
};

const nextLegacyOutputSequence = (): number => {
  const state = streamSequenceStorage.getStore();
  if (!state) return ++_legacyOutputSequence;
  return ++state.legacyOutputSequence;
};

const MAX_PERSISTED_SEQUENCE = 2_147_483_647;
const DEFAULT_PUBLISH_ATTEMPTS = 3;
const DEFAULT_PUBLISH_ATTEMPT_TIMEOUT_MS = 30_000;
const DEFAULT_CLOSE_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_PENDING_EVENTS = 256;
const DEFAULT_MAX_PENDING_BYTES = 8 * 1024 * 1024;
const RESERVATION_RENEWAL_RATIO = 0.75;
const streamUtf8Encoder = new TextEncoder();

export type StreamPublishCapacityResource = "pending_events" | "pending_bytes";

/** Safe capacity failure; event content is never copied into its message. */
export class StreamPublishCapacityError extends Error {
  readonly code = "STREAM_PUBLISH_CAPACITY_EXCEEDED" as const;

  constructor(
    readonly resource: StreamPublishCapacityResource,
    readonly limit: number,
    readonly observed: number,
  ) {
    super(`stream publish capacity exceeded: ${resource}`);
    this.name = "StreamPublishCapacityError";
  }
}

/** Safe bounded-operation failure for publish retries and shutdown. */
export class StreamPublishTimeoutError extends Error {
  readonly code = "STREAM_PUBLISH_TIMEOUT" as const;

  constructor(
    readonly operation: "publish" | "reservation" | "close",
    readonly timeoutMs: number,
  ) {
    super(`stream ${operation} timed out within its bounded interval`);
    this.name = "StreamPublishTimeoutError";
  }
}

const asError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(String(value));

const positiveInteger = (value: number | undefined, fallback: number): number => {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 1) {
    throw new RangeError("stream publisher limits must be positive finite numbers");
  }
  return Math.floor(value);
};

const serializedStreamBytes = (value: unknown, limit: number): number => {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return 0;
    return streamUtf8Encoder.encode(serialized).byteLength;
  } catch {
    throw new StreamPublishCapacityError("pending_bytes", limit, limit + 1);
  }
};

const throwIfStreamAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw signal.reason ?? new Error("stream publication aborted");
  }
};

const raceWithStreamAbort = async <T>(
  operation: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> => {
  throwIfStreamAborted(signal);
  const pending = operation();
  pending.catch(() => undefined);
  if (!signal) return pending;

  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      reject(signal.reason ?? new Error("stream publication aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([pending, aborted]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
};

const runBoundedStreamOperation = async <T>(
  operation: (requestOptions: StreamPublisherOperationOptions) => Promise<T>,
  requestOptions: StreamPublisherOperationOptions | undefined,
  configuredTimeoutMs: number,
  operationName: "publish" | "reservation" | "close",
): Promise<T> => {
  throwIfStreamAborted(requestOptions?.signal);
  const requestedTimeoutMs = requestOptions?.timeoutMs;
  const timeoutMs =
    typeof requestedTimeoutMs === "number" &&
    Number.isFinite(requestedTimeoutMs) &&
    requestedTimeoutMs > 0
      ? Math.min(configuredTimeoutMs, Math.floor(requestedTimeoutMs))
      : configuredTimeoutMs;
  const localController = requestOptions?.signal ? undefined : new AbortController();
  const signal = requestOptions?.signal ?? localController!.signal;
  const boundedOptions: StreamPublisherOperationOptions = {
    ...requestOptions,
    signal,
    timeoutMs,
  };

  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      reject(signal.reason ?? new Error("stream publication aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      const error = new StreamPublishTimeoutError(operationName, timeoutMs);
      localController?.abort(error);
      reject(error);
    }, timeoutMs);
  });

  let pending: Promise<T>;
  try {
    pending = operation(boundedOptions);
  } catch (error) {
    pending = Promise.reject(error);
  }
  pending.catch(() => undefined);
  try {
    return await Promise.race([pending, aborted, timedOut]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
};

const latchStreamFatal = (state: StreamSequenceState | undefined, error: unknown): Error => {
  const normalized = asError(error);
  if (state && !state.fatalError) state.fatalError = normalized;
  return state?.fatalError ?? normalized;
};

const ensureSequenceCapacity = async (
  state: StreamSequenceState,
  channelName: "sessionEvents" | "nativeEvents",
  channel: SequenceChannelState,
  sequence: number,
  requestOptions?: StreamPublisherOperationOptions,
): Promise<void> => {
  if (sequence > MAX_PERSISTED_SEQUENCE) {
    throw new Error("durable sequence INT32 space exhausted before publish");
  }

  const currentEnd = channel.reservationEnd;
  if (currentEnd === undefined) return;

  const span = currentEnd - channel.base;
  const renewalAt = channel.base + Math.ceil(span * RESERVATION_RENEWAL_RATIO);
  const needsExtension = sequence > currentEnd || sequence >= renewalAt;
  if (!needsExtension || currentEnd === MAX_PERSISTED_SEQUENCE) return;
  if (!state.ensureReservation) {
    throw new Error("durable sequence reservation capability is unavailable");
  }

  const requiredThrough = Math.max(sequence, currentEnd + 1);
  const reservedThrough = await raceWithStreamAbort(
    () =>
      state.ensureReservation!(
        channelName,
        requiredThrough,
        requestOptions,
      ),
    requestOptions?.signal,
  );
  throwIfStreamAborted(requestOptions?.signal);
  if (
    !Number.isInteger(reservedThrough) ||
    reservedThrough < currentEnd ||
    reservedThrough < sequence ||
    reservedThrough > MAX_PERSISTED_SEQUENCE
  ) {
    throw new Error("durable sequence reservation response is invalid or non-monotonic");
  }
  channel.reservationEnd = Math.max(currentEnd, reservedThrough);
};

/**
 * Serialize each durable store independently. The wrapper owns the emitted
 * sequence: callers may allocate optimistically, but a store high-water mark
 * moves only after the exact XADD has succeeded. Legacy session output shares
 * the canonical tail to preserve XADD order, but stays outside the durable
 * receipt range because bridges ACK it without database persistence. A
 * terminal failure is latched so even fire-and-forget callers cannot later
 * pass the release handoff.
 */
export const createSequencedStreamPublisher = (
  underlying: StreamPublisher,
  options: {
    maxPublishAttempts?: number;
    publishAttemptTimeoutMs?: number;
    closeTimeoutMs?: number;
    maxPendingEvents?: number;
    maxPendingBytes?: number;
    operationOptions?: () => StreamPublisherOperationOptions | undefined;
  } = {},
): StreamPublisher => {
  const state = streamSequenceStorage.getStore();
  const maxPublishAttempts = positiveInteger(
    options.maxPublishAttempts,
    DEFAULT_PUBLISH_ATTEMPTS,
  );
  const publishAttemptTimeoutMs = positiveInteger(
    options.publishAttemptTimeoutMs,
    DEFAULT_PUBLISH_ATTEMPT_TIMEOUT_MS,
  );
  const closeTimeoutMs = positiveInteger(
    options.closeTimeoutMs,
    DEFAULT_CLOSE_TIMEOUT_MS,
  );
  const maxPendingEvents = positiveInteger(
    options.maxPendingEvents,
    DEFAULT_MAX_PENDING_EVENTS,
  );
  const maxPendingBytes = positiveInteger(
    options.maxPendingBytes,
    DEFAULT_MAX_PENDING_BYTES,
  );
  let pendingEvents = 0;
  let pendingBytes = 0;
  let frozen = false;
  let localFatalError: Error | undefined;
  let legacyCanonicalTail = Promise.resolve();
  let legacyNativeTail = Promise.resolve();
  let closeInFlight: Promise<void> | null = null;

  const rejectAndLatch = (error: unknown): Promise<never> => {
    const latched = latchStreamFatal(state, error);
    localFatalError ??= latched;
    return Promise.reject(latched);
  };

  const reservePending = (value: unknown): (() => void) => {
    const eventBytes = serializedStreamBytes(value, maxPendingBytes);
    if (pendingEvents + 1 > maxPendingEvents) {
      throw new StreamPublishCapacityError(
        "pending_events",
        maxPendingEvents,
        pendingEvents + 1,
      );
    }
    if (pendingBytes + eventBytes > maxPendingBytes) {
      throw new StreamPublishCapacityError(
        "pending_bytes",
        maxPendingBytes,
        pendingBytes + eventBytes,
      );
    }
    pendingEvents += 1;
    pendingBytes += eventBytes;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      pendingEvents -= 1;
      pendingBytes -= eventBytes;
    };
  };

  const enqueueDurable = <T extends CanonicalEventEnvelope | NativeEventEnvelope>(
    channelName: "sessionEvents" | "nativeEvents",
    value: T,
    publish: (
      value: T,
      requestOptions?: StreamPublisherOperationOptions,
    ) => Promise<string>,
    explicitRequestOptions?: StreamPublisherOperationOptions,
  ): Promise<string> => {
    const fatal = state?.fatalError ?? localFatalError;
    if (frozen || state?.frozen) {
      return Promise.reject(new Error("durable stream publishers are frozen"));
    }
    if (fatal) return Promise.reject(fatal);

    const channel = state
      ? channelName === "sessionEvents"
        ? state.canonical
        : state.native
      : undefined;
    const claimAttemptId = state?.claimAttemptId;
    let releasePending: () => void;
    try {
      releasePending = reservePending({
        ...value,
        ...(claimAttemptId
          ? {
              sequenceProtocolVersion: DURABLE_SEQUENCE_PROTOCOL_VERSION,
              claimAttemptId,
            }
          : {}),
      });
    } catch (error) {
      return rejectAndLatch(error);
    }
    const previousTail = channel
      ? channel.tail
      : channelName === "sessionEvents"
        ? legacyCanonicalTail
        : legacyNativeTail;

    const task = previousTail.then(async (): Promise<string> => {
      const priorFatal = state?.fatalError ?? localFatalError;
      if (priorFatal) throw priorFatal;
      const sequence = channel ? channel.committed + 1 : value.sequenceNumber;
      try {
        const requestOptions =
          explicitRequestOptions ?? options.operationOptions?.();
        throwIfStreamAborted(requestOptions?.signal);
        if (state && channel) {
          await runBoundedStreamOperation(
            (boundedOptions) =>
              ensureSequenceCapacity(
                state,
                channelName,
                channel,
                sequence,
                boundedOptions,
              ),
            requestOptions,
            publishAttemptTimeoutMs,
            "reservation",
          );
        }

        const durableValue = {
          ...value,
          sequenceNumber: sequence,
          ...(claimAttemptId
            ? {
                sequenceProtocolVersion: DURABLE_SEQUENCE_PROTOCOL_VERSION,
                claimAttemptId,
              }
            : {}),
        } as T;

        let lastError: unknown;
        for (let attempt = 1; attempt <= maxPublishAttempts; attempt += 1) {
          throwIfStreamAborted(requestOptions?.signal);
          try {
            const entryId = await runBoundedStreamOperation(
              (boundedOptions) => publish(durableValue, boundedOptions),
              requestOptions,
              publishAttemptTimeoutMs,
              "publish",
            );
            throwIfStreamAborted(requestOptions?.signal);
            if (channel) {
              channel.committed = sequence;
              channel.allocated = Math.max(channel.allocated, sequence);
            }
            return entryId;
          } catch (error) {
            throwIfStreamAborted(requestOptions?.signal);
            lastError = error;
          }
        }
        throw lastError;
      } catch (error) {
        const latched = latchStreamFatal(state, error);
        localFatalError ??= latched;
        throw latched;
      }
    });

    const settledTail = task.then(
      () => releasePending(),
      () => releasePending(),
    );
    if (channel) channel.tail = settledTail;
    else if (channelName === "sessionEvents") legacyCanonicalTail = settledTail;
    else legacyNativeTail = settledTail;
    return task;
  };

  const enqueueLegacy = (
    event: AgentOutputEvent,
    explicitRequestOptions?: StreamPublisherOperationOptions,
  ): Promise<string> => {
    const fatal = state?.fatalError ?? localFatalError;
    if (frozen || state?.frozen) {
      return Promise.reject(new Error("durable stream publishers are frozen"));
    }
    if (fatal) return Promise.reject(fatal);

    const {
      sequenceProtocolVersion: _untrustedSequenceProtocolVersion,
      claimAttemptId: _untrustedClaimAttemptId,
      ...legacyEvent
    } = event;
    let releasePending: () => void;
    try {
      releasePending = reservePending(legacyEvent);
    } catch (error) {
      return rejectAndLatch(error);
    }
    const previousTail = state?.canonical.tail ?? legacyCanonicalTail;

    const task = previousTail.then(async (): Promise<string> => {
      const priorFatal = state?.fatalError ?? localFatalError;
      if (priorFatal) throw priorFatal;
      try {
        const requestOptions =
          explicitRequestOptions ?? options.operationOptions?.();
        throwIfStreamAborted(requestOptions?.signal);
        let lastError: unknown;
        for (let attempt = 1; attempt <= maxPublishAttempts; attempt += 1) {
          throwIfStreamAborted(requestOptions?.signal);
          try {
            const entryId = await runBoundedStreamOperation(
              (boundedOptions) => underlying.publish(legacyEvent, boundedOptions),
              requestOptions,
              publishAttemptTimeoutMs,
              "publish",
            );
            throwIfStreamAborted(requestOptions?.signal);
            return entryId;
          } catch (error) {
            throwIfStreamAborted(requestOptions?.signal);
            lastError = error;
          }
        }
        throw lastError;
      } catch (error) {
        const latched = latchStreamFatal(state, error);
        localFatalError ??= latched;
        throw latched;
      }
    });

    const settledTail = task.then(
      () => releasePending(),
      () => releasePending(),
    );
    if (state) state.canonical.tail = settledTail;
    else legacyCanonicalTail = settledTail;
    return task;
  };

  const close = (
    explicitRequestOptions?: StreamPublisherOperationOptions,
  ): Promise<void> => {
    if (closeInFlight) return closeInFlight;
    frozen = true;
    if (state) state.frozen = true;
    const requestOptions =
      explicitRequestOptions ?? options.operationOptions?.();

    closeInFlight = (async () => {
      const tails = state
        ? [state.canonical.tail, state.native.tail]
        : [legacyCanonicalTail, legacyNativeTail];
      let underlyingClose: Promise<void> | undefined;
      const triggerUnderlyingClose = (
        closeOptions: StreamPublisherOperationOptions | undefined = requestOptions,
      ): Promise<void> => {
        underlyingClose ??= underlying.close(closeOptions);
        return underlyingClose;
      };
      let onAbort: (() => void) | undefined;
      if (requestOptions?.signal) {
        onAbort = () => {
          void triggerUnderlyingClose().catch(() => undefined);
        };
        requestOptions.signal.addEventListener("abort", onAbort, {
          once: true,
        });
      }

      let closeError: Error | undefined;
      try {
        await runBoundedStreamOperation(
          () => Promise.all(tails).then(() => undefined),
          requestOptions,
          closeTimeoutMs,
          "close",
        );
        await runBoundedStreamOperation(
          (boundedOptions) => triggerUnderlyingClose(boundedOptions),
          requestOptions,
          closeTimeoutMs,
          "close",
        );
      } catch (error) {
        closeError = asError(error);
        // A pre-aborted signal never dispatches an abort event retroactively.
        // Trigger the underlying close explicitly so Redis hard-disconnects
        // even when the durable tails cannot be awaited.
        void triggerUnderlyingClose().catch(() => undefined);
      } finally {
        if (onAbort && requestOptions?.signal) {
          requestOptions.signal.removeEventListener("abort", onAbort);
        }
      }

      const fatal = state?.fatalError ?? localFatalError ?? closeError;
      if (fatal) throw fatal;
    })();
    return closeInFlight;
  };

  return {
    publish: enqueueLegacy,
    publishCanonicalEnvelope: (envelope, requestOptions) =>
      enqueueDurable(
        "sessionEvents",
        envelope,
        underlying.publishCanonicalEnvelope,
        requestOptions,
      ),
    publishNativeEnvelope: (envelope, requestOptions) =>
      enqueueDurable(
        "nativeEvents",
        envelope,
        underlying.publishNativeEnvelope,
        requestOptions,
      ),
    close,
  };
};

// ---------------------------------------------------------------------------
// Stream-backed channel adapter
// ---------------------------------------------------------------------------

/**
 * Thin adapter that publishes stream events instead of calling Discord directly.
 * Satisfies the subset of DiscordRichChannelAdapter required by BidirectionalRelay.
 */
export const createStreamChannelAdapter = (params: {
  streamPublisher: StreamPublisher;
  jobId: string;
  threadId: string;
  sessionId: string;
  workspaceId: string;
}): Pick<DiscordRichChannelAdapter, "sendMessage" | "sendRichMessage"> => ({
  sendMessage: async (targetThreadId, content) => {
    await params.streamPublisher.publish({
      type: "message",
      jobId: params.jobId,
      threadId: targetThreadId || params.threadId,
      sessionId: params.sessionId,
      workspaceId: params.workspaceId,
      content: sanitizeLogContent(typeof content === "string" ? content : String(content)),
      timestamp: Date.now(),
      sequenceNumber: nextLegacyOutputSequence(),
    });
    return { id: `q-${Date.now()}`, content: String(content), channelId: "" };
  },
  sendRichMessage: async (targetThreadId, payload) => {
    await params.streamPublisher.publish({
      type: "rich_message",
      jobId: params.jobId,
      threadId: targetThreadId || params.threadId,
      sessionId: params.sessionId,
      workspaceId: params.workspaceId,
      payload: payload as Record<string, unknown>,
      timestamp: Date.now(),
      sequenceNumber: nextLegacyOutputSequence(),
    });
    return { id: `q-${Date.now()}`, content: "", channelId: "" };
  },
});

// ---------------------------------------------------------------------------
// Helper: publish a typed event to the stream (failure is propagated/latching)
// ---------------------------------------------------------------------------

export const publishStreamEvent = async (
  publisher: StreamPublisher | undefined,
  event: Omit<AgentOutputEvent, "sequenceNumber">,
  requestOptions?: StreamPublisherOperationOptions,
): Promise<void> => {
  if (!publisher) return;
  await publisher.publish({
    ...event,
    sequenceNumber: nextLegacyOutputSequence(),
  }, requestOptions);
};

/**
 * Publish a canonical event envelope to Redis Stream via raw XADD.
 * Uses the same StreamPublisher's Redis connection but writes in canonical format.
 */
export const publishCanonicalEvent = async (
  publisher: StreamPublisher | undefined,
  envelope: CanonicalEventEnvelope,
  requestOptions?: StreamPublisherOperationOptions,
): Promise<void> => {
  if (!publisher) return;
  const claimAttemptId = streamSequenceStorage.getStore()?.claimAttemptId;
  const {
    sequenceProtocolVersion: _untrustedSequenceProtocolVersion,
    claimAttemptId: _untrustedClaimAttemptId,
    ...baseEnvelope
  } = envelope;
  await publisher.publishCanonicalEnvelope(
    normalizeCanonicalEnvelope({
      ...baseEnvelope,
      ...(claimAttemptId
        ? {
            sequenceProtocolVersion: DURABLE_SEQUENCE_PROTOCOL_VERSION,
            claimAttemptId,
          }
        : {}),
    }),
    requestOptions,
  );
};

/**
 * Publish a canonical `job.started` event at the beginning of an attempt.
 *
 * Runners are ephemeral: the quota-pause and pre-session-timeout retry paths
 * reuse the SAME jobId on a fresh runner whose per-process sequence counter
 * restarts low, WITHOUT emitting a terminal event. The web-bridge consumer uses
 * job.started to reset its per-job dedup high-water mark, so the resumed
 * attempt's events are not mistaken for stale/duplicate redeliveries and
 * dropped. Emitting this at the start of EVERY attempt (initial and resumed) is
 * what makes the resume safe.
 */
export const publishJobStarted = async (
  publisher: StreamPublisher | undefined,
  params: {
    jobId: string;
    sessionId: string;
    workspaceId: string;
    threadId: string;
    model?: string;
    branch?: string;
  },
): Promise<void> => {
  await publishCanonicalEvent(publisher, {
    jobId: params.jobId,
    sessionId: params.sessionId,
    workspaceId: params.workspaceId,
    threadId: params.threadId,
    timestamp: Date.now(),
    sequenceNumber: nextSequence(),
    event: {
      kind: "job.started",
      ...(params.model ? { model: params.model } : {}),
      ...(params.branch ? { branch: params.branch } : {}),
    },
  });
};

/**
 * Publish a native runtime event envelope to Redis Stream. Native events are
 * diagnostic/source-of-truth records and are persisted separately from canonical
 * events so mapper bugs can be investigated after the job finishes.
 */
export const publishNativeEvent = async (
  publisher: StreamPublisher | undefined,
  envelope: NativeEventEnvelope,
  requestOptions?: StreamPublisherOperationOptions,
): Promise<void> => {
  if (!publisher) return;
  const claimAttemptId = streamSequenceStorage.getStore()?.claimAttemptId;
  const {
    sequenceProtocolVersion: _untrustedSequenceProtocolVersion,
    claimAttemptId: _untrustedClaimAttemptId,
    ...baseEnvelope
  } = envelope;
  await publisher.publishNativeEnvelope(
    {
      ...baseEnvelope,
      ...(claimAttemptId
        ? {
            sequenceProtocolVersion: DURABLE_SEQUENCE_PROTOCOL_VERSION,
            claimAttemptId,
          }
        : {}),
    },
    requestOptions,
  );
};
