/**
 * Per-job monotonic sequence tracking for dedup and ordering.
 *
 * Ensures that:
 * - Each job gets a monotonically increasing sequence number
 * - Duplicate or out-of-order envelopes are detected and can be skipped
 * - Tracking state is cleaned up when a job reaches a terminal state
 */

export type SequenceGuard = {
  /** Get the next monotonic sequence number for a job. */
  nextSequence: (jobId: string) => number;

  /**
   * Check if the given sequence number represents a regression (duplicate
   * or out-of-order) for the job. If NOT a regression, the high water mark
   * is advanced.
   * Returns `true` when the event should be DROPPED.
   */
  isRegression: (jobId: string, seq: number) => boolean;

  /**
   * Reset ONLY the regression high-water mark for a job, keeping the outbound
   * sequence counter intact.
   *
   * Used when a reused jobId starts a new attempt on a fresh (ephemeral) runner
   * whose producer sequence restarts low — e.g. after a quota pause or a
   * pre-session-timeout retry, neither of which emits a terminal event. Without
   * this reset the resumed attempt's low producer sequences would be mistaken
   * for stale/duplicate redeliveries and dropped. Unlike `cleanup`, the outbound
   * (bridge-local) counter is preserved so the frontend keeps receiving a
   * contiguous, monotonic sequence across attempts.
   */
  resetHighWater: (jobId: string) => void;

  /** Clean up all tracking state for a completed job. */
  cleanup: (jobId: string) => void;
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

    isRegression: (jobId: string, seq: number): boolean => {
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
