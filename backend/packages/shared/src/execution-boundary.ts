/**
 * Generic execution-deadline boundary contract.
 *
 * Extracted from Cloud's Shoutrz-specific `site-build-deadline` module
 * (`almirant-cloud/backend/packages/shared/src/site-build-deadline.ts`).
 * That module couples this generic boundary machinery with site-build job
 * config field parsing (`siteBuildRunId`, `siteBuildExecutionDeadlineAt`)
 * and Shoutrz-only admission-window validation — none of which apply to
 * Community, which has no site-build orchestration concept.
 *
 * Community only needs the provider-neutral contract: a live deadline
 * boundary for multi-await workflows (container I/O, delivery pushes, PR
 * creation, remote-agent HTTP calls). Every caller today constructs an
 * unbounded boundary via `createExecutionBoundary()` with no deadline —
 * this is the seam a future Community-native scheduled job timeout plugs
 * into without another change to any consumer.
 */

export interface ExecutionBoundary {
  /** Throws once the deadline has passed. Call immediately before every material mutation. */
  assertOpen(): void;
  /** Clamps `configuredTimeoutMs` to the remaining budget before the deadline. */
  timeoutMs(configuredTimeoutMs: number): number;
  /** Fresh AbortSignal for the next bounded I/O operation. */
  signal(configuredTimeoutMs: number): AbortSignal;
}

export type CreateExecutionBoundaryInput = {
  /** Absolute wall-clock deadline. `null`/`undefined` means unbounded. */
  deadlineAt?: Date | null;
  /** Clock injection point for deterministic tests. */
  now?: () => Date;
  /** Reserved margin subtracted from the deadline before it is considered crossed. */
  terminalMarginMs?: number;
};

/**
 * A live deadline boundary for multi-await workflows.
 *
 * Callers must invoke `assertOpen()` immediately before each material mutation
 * and create a fresh `signal()` for the I/O that precedes it. The clock is read
 * on every invocation so an earlier admission check cannot authorize later
 * work after the cutoff.
 */
export const createExecutionBoundary = (
  input: CreateExecutionBoundaryInput = {},
): ExecutionBoundary => {
  const deadlineAt = input.deadlineAt ?? null;
  const now = input.now ?? (() => new Date());
  const terminalMarginMs = input.terminalMarginMs ?? 0;

  const timeoutMs = (configuredTimeoutMs: number): number => {
    const current = now();
    if (!Number.isFinite(current.getTime())) {
      throw new Error("execution_boundary_invalid");
    }
    if (
      !Number.isFinite(configuredTimeoutMs) ||
      configuredTimeoutMs <= 0 ||
      !Number.isFinite(terminalMarginMs) ||
      terminalMarginMs < 0
    ) {
      throw new Error("execution_boundary_invalid");
    }
    if (deadlineAt == null) {
      return configuredTimeoutMs;
    }
    if (!Number.isFinite(deadlineAt.getTime())) {
      throw new Error("execution_boundary_invalid");
    }

    const remainingMs =
      deadlineAt.getTime() - current.getTime() - terminalMarginMs;
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
      throw new Error("execution_boundary_deadline_exceeded");
    }
    return Math.min(configuredTimeoutMs, remainingMs);
  };

  return {
    assertOpen: () => {
      timeoutMs(Number.MAX_SAFE_INTEGER);
    },
    timeoutMs,
    signal: (configuredTimeoutMs) =>
      AbortSignal.timeout(Math.max(1, Math.ceil(timeoutMs(configuredTimeoutMs)))),
  };
};
