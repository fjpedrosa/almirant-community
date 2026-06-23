/**
 * Timeout configuration and computation utilities for job execution.
 */

/** Default base timeout: 3 hours */
export const DEFAULT_OVERALL_TIMEOUT_MS = 3 * 60 * 60 * 1000;

/** Default duration per effort point: 20 minutes */
export const DEFAULT_EFFORT_POINT_DURATION_MS = 20 * 60 * 1000;

/** Default timeout for the startup window after serve readiness and before the session is alive. */
export const DEFAULT_PRE_SESSION_TIMEOUT_MS = 5 * 60 * 1000;

export type PhaseTimeoutError = Error & {
  code: "phase_timeout";
  phase: string;
  timeoutMs: number;
};

export const createPhaseTimeoutError = (
  phase: string,
  timeoutMs: number,
): PhaseTimeoutError => {
  const error = new Error(`Phase "${phase}" timed out after ${timeoutMs}ms`) as PhaseTimeoutError;
  error.code = "phase_timeout";
  error.phase = phase;
  error.timeoutMs = timeoutMs;
  return error;
};

export const withPhaseTimeout = async <T>(
  operation: Promise<T>,
  options: {
    phase: string;
    timeoutMs: number;
    onTimeout?: (error: PhaseTimeoutError) => void;
  },
): Promise<T> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      const error = createPhaseTimeoutError(options.phase, options.timeoutMs);
      options.onTimeout?.(error);
      reject(error);
    }, options.timeoutMs);
  });

  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

/**
 * Compute dynamic job timeout based on effort points.
 * Returns `max(baseTimeout, effortPoints * durationPerPoint)`.
 *
 * @param estimatedHours - Estimated effort in hours (null/undefined/<=0 uses base timeout)
 * @param baseTimeoutMs - Base timeout in milliseconds
 * @param effortPointDurationMs - Duration per effort point in milliseconds
 * @returns Computed timeout in milliseconds
 */
export const computeOverallTimeout = (
  estimatedHours: number | null | undefined,
  baseTimeoutMs: number,
  effortPointDurationMs: number,
): number => {
  if (estimatedHours == null || estimatedHours <= 0) return baseTimeoutMs;
  return Math.max(baseTimeoutMs, estimatedHours * effortPointDurationMs);
};
