import { describe, expect, test } from "bun:test";
import {
  DEFAULT_CRON_EXPRESSION,
  resolveCronFormActiveMode,
  resolveDefaultCronExpression,
} from "./cron-form-defaults";

describe("resolveCronFormActiveMode", () => {
  test("defaults empty cron expressions to the weekly guided mode", () => {
    expect(
      resolveCronFormActiveMode({
        expression: "",
      }),
    ).toBe("weekly");
  });

  test("keeps hourly cron expressions out of the every-X-minutes mode", () => {
    expect(
      resolveCronFormActiveMode({
        expression: "0 * * * *",
        parsedMode: "hourly",
      }),
    ).toBe("hourly");
  });
});

describe("resolveDefaultCronExpression", () => {
  test("seeds a weekly cron expression when cron scheduling starts empty", () => {
    expect(
      resolveDefaultCronExpression({
        scheduleType: "cron",
        cronExpression: "",
      }),
    ).toBe(DEFAULT_CRON_EXPRESSION);
  });

  test("does not seed a cron default for a run-once schedule", () => {
    expect(
      resolveDefaultCronExpression({
        scheduleType: "once",
        cronExpression: "",
      }),
    ).toBeNull();
  });
});
