/**
 * Per-job monotonic sequence tracking for dedup and ordering.
 *
 * Ensures that:
 * - Finite producer sequence numbers retain their durable identity
 * - Legacy envelopes receive a monotonically increasing local fallback
 * - Duplicate or out-of-order envelopes are detected and can be skipped
 * - Tracking state is cleaned up when a job reaches a terminal state
 */

export type SequenceGuard = {
  /** Get the next monotonic sequence number for a job. */
  nextSequence: (jobId: string) => number;

  /**
   * Preserve a finite producer sequence. Only legacy envelopes without one
   * receive a bridge-local fallback, advanced beyond any producer value that
   * has already been observed for the job.
   */
  resolveOutboundSequence: (
    jobId: string,
    producerSequence: number | undefined,
    sequenceProtocolVersion: "durable.v2" | undefined,
  ) => number;

  /**
   * Check if the given sequence number represents a regression (duplicate
   * or out-of-order) for the job. If NOT a regression, the high water mark
   * is advanced.
   * Returns `true` when the event should be DROPPED.
   */
  isRegression: (
    jobId: string,
    seq: number,
    sequenceProtocolVersion?: "durable.v2",
  ) => boolean;

  /**
   * Reset ONLY the regression high-water mark for a job, keeping the legacy
   * fallback counter intact.
   *
   * Used when a reused jobId starts a new attempt on a fresh (ephemeral) runner
   * whose producer sequence restarts low — e.g. after a quota pause or a
   * pre-session-timeout retry, neither of which emits a terminal event. Without
   * this reset the resumed attempt's low producer sequences would be mistaken
   * for stale/duplicate redeliveries and dropped. Unlike `cleanup`, the local
   * fallback counter for legacy unsequenced envelopes is preserved.
   */
  resetHighWater: (jobId: string) => void;

  /** Clean up all tracking state for a completed job. */
  cleanup: (jobId: string) => void;
};

const MAX_DURABLE_SEQUENCE = 2_147_483_647;

export const assertValidDurableSequence = (sequence: number): void => {
  if (
    !Number.isSafeInteger(sequence) ||
    sequence < 0 ||
    sequence > MAX_DURABLE_SEQUENCE
  ) {
    throw new Error("invalid durable.v2 sequence");
  }
};

export const createSequenceGuard = (): SequenceGuard => {
  const counters = new Map<string, number>();
  const highWaterMarks = new Map<string, number>();

  return {
    nextSequence: (jobId: string): number => {
      const current = counters.get(jobId) ?? 0;
      counters.set(jobId, current + 1);
      return current;
    },

    resolveOutboundSequence: (
      jobId: string,
      producerSequence: number | undefined,
      sequenceProtocolVersion: "durable.v2" | undefined,
    ): number => {
      if (
        sequenceProtocolVersion === "durable.v2" &&
        typeof producerSequence === "number"
      ) {
        assertValidDurableSequence(producerSequence);
        const nextFallback = counters.get(jobId) ?? 0;
        counters.set(jobId, Math.max(nextFallback, producerSequence + 1));
        return producerSequence;
      }

      const current = counters.get(jobId) ?? 0;
      counters.set(jobId, current + 1);
      return current;
    },

    isRegression: (
      jobId: string,
      seq: number,
      sequenceProtocolVersion?: "durable.v2",
    ): boolean => {
      if (sequenceProtocolVersion === "durable.v2") {
        assertValidDurableSequence(seq);
        // Redis may redeliver after a crash and independently reserved ranges
        // may arrive out of order. Only PostgreSQL's durable.v2 partial unique
        // constraint can decide idempotency without losing legitimate rows.
        return false;
      }
      const highWater = highWaterMarks.get(jobId);
      if (highWater !== undefined && seq <= highWater) {
        return true;
      }
      highWaterMarks.set(jobId, seq);
      return false;
    },

    resetHighWater: (jobId: string): void => {
      highWaterMarks.delete(jobId);
    },

    cleanup: (jobId: string): void => {
      counters.delete(jobId);
      highWaterMarks.delete(jobId);
    },
  };
};
