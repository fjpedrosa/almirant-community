import { describe, expect, it } from "bun:test";
import {
  DEV_FLOW_CRON_VALIDATION_ERROR,
  assertValidDevFlowCronExpression,
} from "./dev-flow-cron-validation";

// ---------------------------------------------------------------------------
// dev-flow (issue #235) per-automation schedule override validation. Uses
// the SAME cron parser (`croner`'s `Cron`) already relied on at dispatch
// time by @almirant/shared's schedule-evaluation.ts, so a config that
// passes this check is guaranteed to be evaluable by isCronDue later —
// no "valid at save time, silently never fires" gap.
// ---------------------------------------------------------------------------

describe("assertValidDevFlowCronExpression", () => {
  it("accepts a well-formed 5-field cron expression", () => {
    expect(() => assertValidDevFlowCronExpression("*/5 * * * *")).not.toThrow();
  });

  it("accepts a well-formed cron expression together with a valid IANA timezone", () => {
    expect(() =>
      assertValidDevFlowCronExpression("0 9 * * 1-5", "Europe/Madrid"),
    ).not.toThrow();
  });

  it("rejects a malformed cron expression", () => {
    expect(() => assertValidDevFlowCronExpression("not-a-cron")).toThrow(
      new RegExp(DEV_FLOW_CRON_VALIDATION_ERROR),
    );
  });

  it("rejects an empty cron expression", () => {
    expect(() => assertValidDevFlowCronExpression("")).toThrow(
      new RegExp(DEV_FLOW_CRON_VALIDATION_ERROR),
    );
  });

  it("rejects an unknown IANA timezone even when the expression itself is valid", () => {
    expect(() =>
      assertValidDevFlowCronExpression("*/5 * * * *", "Not/AZone"),
    ).toThrow(new RegExp(DEV_FLOW_CRON_VALIDATION_ERROR));
  });

  it("includes the offending expression in the error message", () => {
    expect(() => assertValidDevFlowCronExpression("garbage")).toThrow(/garbage/);
  });

  it("ignores a null/undefined timezone (falls back to the runtime default)", () => {
    expect(() => assertValidDevFlowCronExpression("*/5 * * * *", null)).not.toThrow();
    expect(() => assertValidDevFlowCronExpression("*/5 * * * *", undefined)).not.toThrow();
  });
});
