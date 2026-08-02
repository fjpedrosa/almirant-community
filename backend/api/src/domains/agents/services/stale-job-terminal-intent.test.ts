import { describe, expect, it } from "bun:test";
import { resolveStaleRecoveryTerminalIntent } from "./stale-job-terminal-intent";

describe("resolveStaleRecoveryTerminalIntent", () => {
  it("applies the first pending cancellation instead of a synthetic stale failure", () => {
    const requestedAt = "2026-07-13T10:05:00.000Z";

    expect(
      resolveStaleRecoveryTerminalIntent(
        {
          pendingTerminalIntent: {
            status: "cancelled",
            requestedAt,
            result: { cancelledBy: "user", shutdownRequested: true },
          },
        },
        {
          result: { recoveryReason: "worker-offline" },
          errorType: "worker-crash",
          errorMessage: "Worker disappeared",
          durationMs: 42_000,
        },
      ),
    ).toEqual({
      status: "cancelled",
      requestedAt: new Date(requestedAt),
      result: {
        recoveryReason: "worker-offline",
        cancelledBy: "user",
        shutdownRequested: true,
      },
      errorType: undefined,
      errorMessage: undefined,
      durationMs: 42_000,
      completedAt: new Date(requestedAt),
      failedAt: null,
    });
  });

  it("preserves the first pending failure metadata and rejects malformed intents", () => {
    const requestedAt = "2026-07-13T11:15:00.000Z";

    expect(
      resolveStaleRecoveryTerminalIntent(
        {
          pendingTerminalIntent: {
            status: "failed",
            requestedAt,
            errorType: "interaction-timeout",
            errorMessage: "The user did not answer",
            durationMs: 7_500,
          },
        },
        {
          errorType: "post-processing-timeout",
          errorMessage: "Synthetic watchdog failure",
          durationMs: 99_000,
        },
      ),
    ).toEqual({
      status: "failed",
      requestedAt: new Date(requestedAt),
      result: undefined,
      errorType: "interaction-timeout",
      errorMessage: "The user did not answer",
      durationMs: 7_500,
      completedAt: null,
      failedAt: new Date(requestedAt),
    });

    expect(
      resolveStaleRecoveryTerminalIntent(
        {
          pendingTerminalIntent: {
            status: "cancelled",
            requestedAt: "not-an-iso-date",
          },
        },
        {},
      ),
    ).toBeNull();
  });
});
