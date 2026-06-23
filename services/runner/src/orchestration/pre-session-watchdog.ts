import {
  withPhaseTimeout,
  type PhaseTimeoutError,
} from "../shared/timeout";

export type PreSessionJobStatus = {
  status: string;
  shutdownRequested?: boolean;
};

export type PreSessionCancellationError = Error & {
  code: "phase_cancelled";
  phase: string;
  shutdownRequested: boolean;
};

export const createPreSessionCancellationError = (
  phase: string,
  shutdownRequested: boolean,
): PreSessionCancellationError => {
  const reason = shutdownRequested ? "shutdown requested" : "job cancelled";
  const error = new Error(`Pre-session phase "${phase}" interrupted: ${reason}`) as PreSessionCancellationError;
  error.code = "phase_cancelled";
  error.phase = phase;
  error.shutdownRequested = shutdownRequested;
  return error;
};

export const runWithPreSessionWatchdog = async <T>(
  options: {
    phase: string;
    timeoutMs: number;
    pollIntervalMs?: number;
    getJobStatus: () => Promise<PreSessionJobStatus>;
    onTimeout?: (error: PhaseTimeoutError) => void;
    onCancelled?: (error: PreSessionCancellationError) => void;
  },
  operation: () => Promise<T>,
): Promise<T> => {
  let stopped = false;
  let cancelTimer: ReturnType<typeof setTimeout> | undefined;

  const pollIntervalMs = Math.max(1, options.pollIntervalMs ?? 5_000);

  const cancellationPromise = new Promise<never>((_, reject) => {
    const poll = async () => {
      if (stopped) return;

      try {
        const status = await options.getJobStatus();
        if (status.status === "cancelled") {
          const error = createPreSessionCancellationError(
            options.phase,
            status.shutdownRequested === true,
          );
          options.onCancelled?.(error);
          reject(error);
          return;
        }
      } catch {
        // Best-effort cancellation polling; transient API errors must not kill a healthy startup.
      }

      if (!stopped) {
        cancelTimer = setTimeout(poll, pollIntervalMs);
      }
    };

    cancelTimer = setTimeout(poll, pollIntervalMs);
  });

  try {
    return await withPhaseTimeout(
      Promise.race([operation(), cancellationPromise]),
      {
        phase: options.phase,
        timeoutMs: options.timeoutMs,
        onTimeout: options.onTimeout,
      },
    );
  } finally {
    stopped = true;
    if (cancelTimer) clearTimeout(cancelTimer);
  }
};
