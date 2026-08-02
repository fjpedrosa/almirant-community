import {
  createPhaseTimeoutError,
  type PhaseTimeoutError,
} from "../shared/timeout";
import {
  resolveJobTerminalIntent,
  type BackendJobStatus,
} from "./job-cancellation";

export type PreSessionJobStatus = BackendJobStatus;

export type PreSessionTerminalIntentError = Error & {
  code: "phase_terminal_intent";
  phase: string;
  terminalStatus: "cancelled" | "failed";
  shutdownRequested: boolean;
  errorType?: string;
  errorMessage?: string;
};

export const createPreSessionTerminalIntentError = (
  phase: string,
  intent: NonNullable<ReturnType<typeof resolveJobTerminalIntent>>,
): PreSessionTerminalIntentError => {
  const reason =
    intent.errorMessage ??
    (intent.status === "failed"
      ? "job failed by backend request"
      : intent.shutdownRequested
        ? "shutdown requested"
        : "job cancelled");
  const error = new Error(
    `Pre-session phase "${phase}" interrupted: ${reason}`,
  ) as PreSessionTerminalIntentError;
  error.code = "phase_terminal_intent";
  error.phase = phase;
  error.terminalStatus = intent.status;
  error.shutdownRequested = intent.shutdownRequested;
  if (intent.errorType) error.errorType = intent.errorType;
  if (intent.errorMessage) error.errorMessage = intent.errorMessage;
  return error;
};

/**
 * Race an operation against an external interruption. When interruption wins,
 * abort cooperatively and drain the loser without awaiting it. Cleanup and
 * receipt handoff must not be retained forever by a non-cooperative dependency.
 */
export const runAbortableOperationUntilInterrupted = async <T>(
  operation: (signal: AbortSignal) => Promise<T>,
  interruption: Promise<never>,
): Promise<T> => {
  const abortController = new AbortController();
  let interruptionWon = false;
  const operationPromise = Promise.resolve().then(() =>
    operation(abortController.signal),
  );
  operationPromise.catch(() => undefined);
  const markedInterruption = interruption.catch((error) => {
    interruptionWon = true;
    throw error;
  });

  try {
    return await Promise.race([operationPromise, markedInterruption]);
  } catch (error) {
    if (!interruptionWon) throw error;

    abortController.abort(error);
    throw error;
  }
};

export const runWithPreSessionWatchdog = async <T>(
  options: {
    phase: string;
    timeoutMs: number;
    pollIntervalMs?: number;
    getJobStatus: () => Promise<PreSessionJobStatus>;
    onTimeout?: (error: PhaseTimeoutError) => void;
    onTerminalIntent?: (error: PreSessionTerminalIntentError) => void;
  },
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> => {
  let stopped = false;
  let cancelTimer: ReturnType<typeof setTimeout> | undefined;
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

  const pollIntervalMs = Math.max(1, options.pollIntervalMs ?? 5_000);

  const cancellationPromise = new Promise<never>((_, reject) => {
    const poll = async () => {
      if (stopped) return;

      try {
        const status = await options.getJobStatus();
        const terminalIntent = resolveJobTerminalIntent(status);
        if (terminalIntent) {
          const error = createPreSessionTerminalIntentError(
            options.phase,
            terminalIntent,
          );
          options.onTerminalIntent?.(error);
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

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutTimer = setTimeout(() => {
      const error = createPhaseTimeoutError(options.phase, options.timeoutMs);
      options.onTimeout?.(error);
      reject(error);
    }, options.timeoutMs);
  });

  try {
    return await runAbortableOperationUntilInterrupted(
      operation,
      Promise.race([cancellationPromise, timeoutPromise]),
    );
  } finally {
    stopped = true;
    if (cancelTimer) clearTimeout(cancelTimer);
    if (timeoutTimer) clearTimeout(timeoutTimer);
  }
};
