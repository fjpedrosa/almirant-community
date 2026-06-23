import type { AgentOutputEvent } from "./types";

// ---------------------------------------------------------------------------
// Generic coalescer — parametrized over key extraction, terminal/coalesceable
// types, and optional extra field extractors.
// ---------------------------------------------------------------------------

/**
 * A coalesced batch groups multiple events for the same key
 * into a single dispatch. Steps are concatenated,
 * and non-coalesceable events are kept individually.
 *
 * `extras` holds additional combined fields defined via `extraExtractors`
 * in the config (e.g., `{ combinedRaw: ["line1", "line2"] }`).
 */
export type CoalescedBatch<TContext = Record<string, never>> = {
  key: string;
  jobId: string;
  events: AgentOutputEvent[];
  /** Combined step descriptions (for "step" events). */
  combinedSteps: string[];
  /** Additional combined fields defined by extraExtractors. */
  extras: Record<string, string[]>;
  /** Non-coalesceable events to dispatch individually. */
  passthrough: AgentOutputEvent[];
  createdAt: number;
  lastEventAt: number;
} & TContext;

/**
 * Extracts extra fields from an event for accumulation.
 * Return `null` when the event is not relevant for this extractor.
 */
export type ExtraExtractor = (event: AgentOutputEvent) => string | null;

export type CoalescerConfig<TContext = Record<string, never>> = {
  /** Idle window in ms -- flush after this period without new events. */
  idleMs: number;
  /** Hard max wait before force-flushing, regardless of activity. */
  maxWaitMs: number;
  /** Called when a batch is flushed. */
  onFlush: (batch: CoalescedBatch<TContext>) => void | Promise<void>;
  /** Extract the grouping key from an event. */
  keyExtractor: (event: AgentOutputEvent) => string;
  /** Set of event types considered terminal (flush immediately). */
  terminalTypes: ReadonlySet<string>;
  /** Set of event types considered coalesceable (buffer with timers). */
  coalesceableTypes: ReadonlySet<string>;
  /**
   * Optional extra field extractors. Each key becomes a field in
   * `batch.extras` whose value is an array of extracted strings.
   * Example: `{ combinedRaw: (e) => e.type === "raw" ? e.content ?? "" : null }`
   */
  extraExtractors?: Record<string, ExtraExtractor>;
  /**
   * Build the bridge-specific context fields that are spread into every batch.
   * Receives the first event in the buffer (used to seed identity fields).
   */
  buildContext?: (event: AgentOutputEvent) => TContext;
  /** Time provider for testability. */
  now?: () => number;
};

export type Coalescer = {
  /** Push an incoming event into the coalescer pipeline. */
  push: (event: AgentOutputEvent) => void;
  /** Flush all pending buffers immediately (used during shutdown). */
  flushAll: () => Promise<void>;
  /** Flush a specific key buffer. */
  flushKey: (key: string) => Promise<void>;
  /** Number of keys currently buffered. */
  pendingCount: () => number;
  /** Total events coalesced (not yet flushed + already flushed). */
  coalescedCount: () => number;
  /** Tear down all timers. */
  destroy: () => void;
};

// ---------------------------------------------------------------------------
// Internal buffer type
// ---------------------------------------------------------------------------

type InternalBuffer = {
  key: string;
  jobId: string;
  events: AgentOutputEvent[];
  steps: string[];
  extras: Record<string, string[]>;
  passthrough: AgentOutputEvent[];
  createdAt: number;
  lastEventAt: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
  maxWaitTimer: ReturnType<typeof setTimeout> | null;
  /** The first event, kept for buildContext. */
  seedEvent: AgentOutputEvent;
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createCoalescer = <TContext = Record<string, never>>(
  config: CoalescerConfig<TContext>
): Coalescer => {
  const buffers = new Map<string, InternalBuffer>();
  const now = config.now ?? (() => Date.now());
  const extraExtractors = config.extraExtractors ?? {};
  const extraKeys = Object.keys(extraExtractors);
  let totalCoalesced = 0;

  const createBuffer = (event: AgentOutputEvent, timestamp: number): InternalBuffer => {
    const extras: Record<string, string[]> = {};
    for (const k of extraKeys) {
      extras[k] = [];
    }
    return {
      key: config.keyExtractor(event),
      jobId: event.jobId,
      events: [],
      steps: [],
      extras,
      passthrough: [],
      createdAt: timestamp,
      lastEventAt: timestamp,
      idleTimer: null,
      maxWaitTimer: null,
      seedEvent: event,
    };
  };

  const clearTimers = (buffer: InternalBuffer): void => {
    if (buffer.idleTimer !== null) {
      clearTimeout(buffer.idleTimer);
      buffer.idleTimer = null;
    }
    if (buffer.maxWaitTimer !== null) {
      clearTimeout(buffer.maxWaitTimer);
      buffer.maxWaitTimer = null;
    }
  };

  const toBatch = (buffer: InternalBuffer): CoalescedBatch<TContext> => {
    const context = config.buildContext
      ? config.buildContext(buffer.seedEvent)
      : ({} as TContext);

    return {
      key: buffer.key,
      jobId: buffer.jobId,
      events: buffer.events,
      combinedSteps: buffer.steps,
      extras: buffer.extras,
      passthrough: buffer.passthrough,
      createdAt: buffer.createdAt,
      lastEventAt: buffer.lastEventAt,
      ...context,
    };
  };

  const flushBuffer = async (key: string): Promise<void> => {
    const buffer = buffers.get(key);
    if (!buffer) return;

    clearTimers(buffer);
    buffers.delete(key);

    if (buffer.events.length === 0) return;

    totalCoalesced += buffer.events.length;
    const batch = toBatch(buffer);
    await config.onFlush(batch);
  };

  const scheduleTimers = (buffer: InternalBuffer): void => {
    // Reset idle timer on every new event.
    if (buffer.idleTimer !== null) {
      clearTimeout(buffer.idleTimer);
    }
    buffer.idleTimer = setTimeout(() => {
      void flushBuffer(buffer.key);
    }, config.idleMs);

    // Max-wait timer is set once when the buffer is created.
    if (buffer.maxWaitTimer === null) {
      buffer.maxWaitTimer = setTimeout(() => {
        void flushBuffer(buffer.key);
      }, config.maxWaitMs);
    }
  };

  const addEvent = (buffer: InternalBuffer, event: AgentOutputEvent): void => {
    buffer.events.push(event);
    buffer.lastEventAt = now();

    if (event.type === "step") {
      const description =
        typeof event.description === "string"
          ? event.description
          : String(event.description ?? "");
      buffer.steps.push(description);
    }

    // Run extra extractors
    let matchedExtra = false;
    for (const k of extraKeys) {
      const extractor = extraExtractors[k];
      const extras = buffer.extras[k];
      if (!extractor || !extras) {
        continue;
      }

      const value = extractor(event);
      if (value !== null) {
        extras.push(value);
        matchedExtra = true;
      }
    }

    // If the event is neither a step nor matched by any extra extractor,
    // it is passthrough.
    if (event.type !== "step" && !matchedExtra) {
      buffer.passthrough.push(event);
    }
  };

  return {
    push: (event: AgentOutputEvent): void => {
      const key = config.keyExtractor(event);
      const isTerminal = config.terminalTypes.has(event.type);
      const isCoalesceable = config.coalesceableTypes.has(event.type);

      // Terminal events flush immediately -- add to buffer first, then flush.
      if (isTerminal) {
        let buffer = buffers.get(key);
        if (!buffer) {
          buffer = createBuffer(event, now());
          buffers.set(key, buffer);
        }
        addEvent(buffer, event);
        void flushBuffer(key);
        return;
      }

      // For coalesceable events, buffer and schedule.
      if (isCoalesceable) {
        let buffer = buffers.get(key);
        if (!buffer) {
          buffer = createBuffer(event, now());
          buffers.set(key, buffer);
        }
        addEvent(buffer, event);
        scheduleTimers(buffer);
        return;
      }

      // Non-coalesceable, non-terminal events (message, wave_start, etc.):
      // flush any pending buffer first, then dispatch immediately.
      const existing = buffers.get(key);
      if (existing && existing.events.length > 0) {
        void flushBuffer(key);
      }

      // Create a single-event buffer and flush it right away.
      const singleBuffer = createBuffer(event, now());
      addEvent(singleBuffer, event);
      buffers.set(key, singleBuffer);
      void flushBuffer(key);
    },

    flushAll: async (): Promise<void> => {
      const keys = [...buffers.keys()];
      await Promise.all(keys.map((key) => flushBuffer(key)));
    },

    flushKey: async (key: string): Promise<void> => {
      await flushBuffer(key);
    },

    pendingCount: (): number => buffers.size,

    coalescedCount: (): number => totalCoalesced,

    destroy: (): void => {
      for (const buffer of buffers.values()) {
        clearTimers(buffer);
      }
      buffers.clear();
    },
  };
};
