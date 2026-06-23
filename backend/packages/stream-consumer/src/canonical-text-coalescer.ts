// ---------------------------------------------------------------------------
// Canonical text/thinking coalescer
//
// OpenCode-class shims emit `agent.text` and `agent.thinking` deltas at
// word/sub-token granularity (thousands of events per session). Persisting
// each delta as a separate canonical event:
//   - bloats `session_events` (one row per word),
//   - causes downstream consumers that load events with a LIMIT (e.g. the
//     runner-implement completion validator with limit=2000) to miss the
//     `## Summary` block at the tail of the run, and
//   - makes the rehydrated transcript appear to "type itself" in the UI.
//
// This module sits between the canonical adapter and the stream publisher.
// It buffers consecutive deltas of the same coalesce kind and flushes a
// single aggregated event whenever:
//   (a) the coalesce kind changes (text → thinking or vice-versa),
//   (b) a non-coalesceable canonical event arrives (any kind that is not
//       agent.text / agent.text.complete / agent.thinking) — flushed first,
//       then the new event is dispatched immediately,
//   (c) an explicit `agent.text.complete` arrives — its fullText replaces
//       the accumulated deltas (matches the existing collapse semantics in
//       the frontend),
//   (d) `idleMs` elapse with no new event,
//   (e) `flush()` or `destroy()` is called by the host.
//
// Aggregation rules:
//   - run of agent.text deltas with NO explicit complete → ONE `agent.text`
//     whose `content` is the concatenation in arrival order. Reserving
//     `agent.text.complete` for true full-text snapshots is what lets
//     downstream consumers (frontend collapse, runner-implement validator,
//     PR-summary update) treat consecutive `agent.text` events as
//     concatenable, while keeping `agent.text.complete` as the canonical
//     "this is the full text of the message" signal.
//   - run of agent.text deltas WHERE an explicit `agent.text.complete`
//     arrived during the window → ONE `agent.text.complete` whose
//     `fullText` is that explicit fullText (the explicit complete wins
//     over the buffered deltas).
//   - run of agent.thinking deltas → ONE `agent.thinking` whose `content`
//     is the concatenation in arrival order.
//
// Output ordering exactly matches input ordering — buffered runs are flushed
// before the event that closes them is dispatched.
// ---------------------------------------------------------------------------

import type { CanonicalEvent } from "@almirant/canonical-events";

export type CanonicalTextCoalescerConfig = {
  /** Called whenever a coalesced or pass-through event is ready to dispatch. */
  onFlush: (event: CanonicalEvent) => void | Promise<void>;
  /**
   * Idle window in ms — flush the current buffer after this period without
   * any new push. Defaults to 250ms.
   */
  idleMs?: number;
  /** Time provider for testability. Defaults to Date.now. */
  now?: () => number;
};

export type CanonicalTextCoalescer = {
  /** Push a canonical event into the pipeline. */
  push: (event: CanonicalEvent) => void;
  /** Flush any pending buffer immediately. */
  flush: () => void;
  /** Tear down (clears timers, flushes pending). */
  destroy: () => void;
};

type RunKind = "text" | "thinking";

const coalesceKindOf = (event: CanonicalEvent): RunKind | null => {
  if (event.kind === "agent.text" || event.kind === "agent.text.complete") {
    return "text";
  }
  if (event.kind === "agent.thinking") {
    return "thinking";
  }
  return null;
};

export const createCanonicalTextCoalescer = (
  config: CanonicalTextCoalescerConfig,
): CanonicalTextCoalescer => {
  const idleMs = config.idleMs ?? 250;
  const onFlush = config.onFlush;

  let runKind: RunKind | null = null;
  let buffer = "";
  /** When set, an explicit agent.text.complete fullText overrides the deltas. */
  let explicitFullText: string | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const clearIdleTimer = (): void => {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  const scheduleIdleFlush = (): void => {
    clearIdleTimer();
    idleTimer = setTimeout(() => {
      flushBuffer();
    }, idleMs);
  };

  const flushBuffer = (): void => {
    clearIdleTimer();
    if (runKind === null || (buffer.length === 0 && explicitFullText === null)) {
      runKind = null;
      buffer = "";
      explicitFullText = null;
      return;
    }

    let aggregated: CanonicalEvent;
    if (runKind === "text") {
      // Only emit `agent.text.complete` when the source actually produced an
      // explicit fullText snapshot during the window. Otherwise the buffer
      // holds delta-derived content that successive flushes will need to
      // append to — emit `agent.text` so consumers know to concatenate.
      aggregated =
        explicitFullText !== null
          ? { kind: "agent.text.complete", fullText: explicitFullText }
          : { kind: "agent.text", content: buffer };
    } else {
      aggregated = { kind: "agent.thinking", content: buffer };
    }

    runKind = null;
    buffer = "";
    explicitFullText = null;
    void onFlush(aggregated);
  };

  const push = (event: CanonicalEvent): void => {
    const kind = coalesceKindOf(event);

    if (kind === null) {
      // Non-coalesceable event: flush any pending run first, then pass through.
      flushBuffer();
      void onFlush(event);
      return;
    }

    // Coalesceable event. If the run kind changed, flush the old run first.
    if (runKind !== null && runKind !== kind) {
      flushBuffer();
    }

    runKind = kind;

    if (event.kind === "agent.text") {
      buffer += event.content;
    } else if (event.kind === "agent.text.complete") {
      // Explicit complete wins over any accumulated deltas in the same run.
      explicitFullText = event.fullText;
    } else if (event.kind === "agent.thinking") {
      buffer += event.content;
    }

    scheduleIdleFlush();
  };

  return {
    push,
    flush: flushBuffer,
    destroy: () => {
      flushBuffer();
      clearIdleTimer();
    },
  };
};
