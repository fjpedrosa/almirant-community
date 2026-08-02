export type BackendJobStatus = {
  status: string;
  shutdownRequested?: boolean;
  errorType?: string;
  errorMessage?: string;
};

export type JobTerminalIntent = {
  status: "cancelled" | "failed";
  shutdownRequested: boolean;
  errorType?: string;
  errorMessage?: string;
};

export type DurableTerminalHandoff = JobTerminalIntent & {
  expectedClaimAttemptId: string;
  reason: string;
};

export type JobTerminalPresentation = {
  status: "cancelled" | "failed";
  summary: "cancelled" | "shutdown" | "failed";
  logCode: "job.cancelled" | "job.shutdown_requested" | "job.failed";
  logMessage: string;
  event:
    | { kind: "job.cancelled"; reason: string }
    | { kind: "job.failed"; errorMessage: string };
};

export const resolveJobTerminalIntent = (
  status: BackendJobStatus | null | undefined,
): JobTerminalIntent | null => {
  if (status?.status !== "cancelled" && status?.status !== "failed") {
    return null;
  }

  return {
    status: status.status,
    shutdownRequested: status.shutdownRequested === true,
    ...(status.errorType ? { errorType: status.errorType } : {}),
    ...(status.errorMessage ? { errorMessage: status.errorMessage } : {}),
  };
};

export const resolveDurableTerminalHandoff = (
  intent: JobTerminalIntent,
  claimAttemptId: string | null | undefined,
): DurableTerminalHandoff | null => {
  const expectedClaimAttemptId = claimAttemptId?.trim();
  if (!expectedClaimAttemptId) return null;

  return {
    expectedClaimAttemptId,
    status: intent.status,
    reason:
      intent.errorType ??
      (intent.status === "failed"
        ? "failed"
        : intent.shutdownRequested
          ? "shutdown"
          : "cancelled"),
    shutdownRequested: intent.shutdownRequested,
    ...(intent.errorType ? { errorType: intent.errorType } : {}),
    ...(intent.errorMessage ? { errorMessage: intent.errorMessage } : {}),
  };
};

/**
 * Keep terminal status, observability and canonical output aligned. In
 * particular an externally requested failure must never be rendered as a
 * user cancellation while the database applies the original failed intent.
 */
export const resolveJobTerminalPresentation = (
  intent: JobTerminalIntent,
): JobTerminalPresentation => {
  if (intent.status === "failed") {
    return {
      status: "failed",
      summary: "failed",
      logCode: "job.failed",
      logMessage: "Job failed by backend terminal intent",
      event: {
        kind: "job.failed",
        errorMessage: intent.errorMessage ?? "Job failed by backend terminal intent.",
      },
    };
  }

  if (intent.shutdownRequested) {
    return {
      status: "cancelled",
      summary: "shutdown",
      logCode: "job.shutdown_requested",
      logMessage: "Job shutdown requested by user",
      event: {
        kind: "job.cancelled",
        reason: "Job shutdown by user.",
      },
    };
  }

  return {
    status: "cancelled",
    summary: "cancelled",
    logCode: "job.cancelled",
    logMessage: "Job cancelled by user",
    event: {
      kind: "job.cancelled",
      reason: "Job cancelled by user.",
    },
  };
};
