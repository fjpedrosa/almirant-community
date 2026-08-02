import { Cron } from "croner";

/**
 * Dev-flow (issue #235) per-automation schedule override validation.
 *
 * Reuses the SAME cron parser (`croner`'s `Cron`) already relied on at
 * dispatch time by `@almirant/shared`'s schedule-evaluation.ts (`isCronDue`)
 * and by `scheduled-agent-due.ts` / `scheduled-agent-explain.ts` — so a
 * schedule override that passes this check is guaranteed to be evaluable
 * later, instead of silently never firing because of a malformed expression
 * or an unknown IANA timezone that only surfaces at dispatch time.
 *
 * `Cron`'s constructor synchronously validates the pattern (it throws for a
 * malformed expression), but an invalid IANA timezone only surfaces once a
 * date computation is attempted (`nextRun()` etc.) — the constructor itself
 * accepts any string as `timezone` without checking it. So this calls
 * `nextRun()` once, right after constructing, purely to force that
 * validation and discard the result; no timers/side effects are created,
 * mirroring the "construct once for validation" pattern already used at the
 * read paths above (`isCronDue`'s `job.nextRun(lastRun)`).
 */
export const DEV_FLOW_CRON_VALIDATION_ERROR = "Invalid cron expression";

export const assertValidDevFlowCronExpression = (
  expression: string,
  timezone?: string | null,
): void => {
  const trimmedTimezone = timezone?.trim() || undefined;
  try {
    const job = new Cron(expression, trimmedTimezone ? { timezone: trimmedTimezone } : undefined);
    job.nextRun();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${DEV_FLOW_CRON_VALIDATION_ERROR} '${expression}': ${reason}`);
  }
};
