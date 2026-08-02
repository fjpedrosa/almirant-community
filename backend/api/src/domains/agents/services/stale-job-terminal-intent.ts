import type { AgentJobConfig } from "@almirant/database";

export type StaleRecoveryTerminalFallback = Readonly<{
  result?: Record<string, unknown> | null;
  errorType?: string | null;
  errorMessage?: string | null;
  durationMs?: number | null;
}>;

export type StaleRecoveryTerminalIntent = Readonly<{
  status: "cancelled" | "failed";
  requestedAt: Date;
  result: Record<string, unknown> | undefined;
  errorType: string | undefined;
  errorMessage: string | undefined;
  durationMs: number | undefined;
  completedAt: Date | null;
  failedAt: Date | null;
}>;

/**
 * Resolve the server-owned first terminal intent for a stale claim. Watchdog
 * diagnostics are useful result context, but may never replace the outcome or
 * error metadata that won when the external intent was recorded.
 */
export const resolveStaleRecoveryTerminalIntent = (
  config: Pick<AgentJobConfig, "pendingTerminalIntent"> | null | undefined,
  fallback: StaleRecoveryTerminalFallback,
): StaleRecoveryTerminalIntent | null => {
  const intent = config?.pendingTerminalIntent;
  if (!intent || (intent.status !== "cancelled" && intent.status !== "failed")) {
    return null;
  }

  const requestedAt = new Date(intent.requestedAt);
  if (Number.isNaN(requestedAt.getTime())) return null;

  const fallbackResult =
    fallback.result && typeof fallback.result === "object"
      ? fallback.result
      : undefined;
  const result =
    fallbackResult || intent.result
      ? { ...(fallbackResult ?? {}), ...(intent.result ?? {}) }
      : undefined;
  const fallbackDuration =
    typeof fallback.durationMs === "number" && Number.isFinite(fallback.durationMs)
      ? Math.max(0, fallback.durationMs)
      : undefined;
  const intentDuration =
    typeof intent.durationMs === "number" && Number.isFinite(intent.durationMs)
      ? Math.max(0, intent.durationMs)
      : undefined;

  return {
    status: intent.status,
    requestedAt,
    result,
    errorType: intent.errorType,
    errorMessage: intent.errorMessage,
    durationMs: intentDuration ?? fallbackDuration,
    completedAt: intent.status === "cancelled" ? requestedAt : null,
    failedAt: intent.status === "failed" ? requestedAt : null,
  };
};
