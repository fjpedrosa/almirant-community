import { describe, expect, test } from "bun:test";
import {
  isCronDue,
  isOnceDue,
  isScheduleDue,
  isTimeWindowActive,
  type ScheduleEvaluationInput,
} from "./schedule-evaluation";

const cron = (
  expression: string,
  lastRunAt: string | null = null,
): ScheduleEvaluationInput => ({
  scheduleType: "cron",
  scheduleConfig: { expression },
  timezone: "UTC",
  lastRunAt,
});

const window = (
  overrides: Partial<ScheduleEvaluationInput> & {
    startHour: number;
    endHour: number;
    daysOfWeek?: number[];
  },
): ScheduleEvaluationInput => {
  const { startHour, endHour, daysOfWeek, ...rest } = overrides;
  return {
    scheduleType: "time_window",
    scheduleConfig: { startHour, endHour, daysOfWeek },
    timezone: "UTC",
    lastRunAt: null,
    ...rest,
  };
};

// 2026-08-05 is a Wednesday (day 3).
const WED_10H = new Date("2026-08-05T10:00:00Z");
const WED_23H = new Date("2026-08-05T23:00:00Z");

describe("isCronDue", () => {
  test("a config that has never run is due", () => {
    expect(isCronDue(cron("*/5 * * * *"), WED_10H)).toBe(true);
  });

  test("is not due again until the next occurrence has passed", () => {
    // Ran at 09:58 on a */5 schedule: the next occurrence is 10:00, still in
    // the future at 09:59.
    expect(
      isCronDue(cron("*/5 * * * *", "2026-08-05T09:58:00Z"), new Date("2026-08-05T09:59:00Z")),
    ).toBe(false);
  });

  test("is due exactly at the next occurrence", () => {
    // Boundary: ran at 09:59, next occurrence is 10:00, and it is now 10:00.
    expect(isCronDue(cron("*/5 * * * *", "2026-08-05T09:59:00Z"), WED_10H)).toBe(true);
  });

  test("is due once the next occurrence is in the past", () => {
    expect(isCronDue(cron("*/5 * * * *", "2026-08-05T09:50:00Z"), WED_10H)).toBe(true);
  });

  test("a weekly cron stays not due mid-week", () => {
    // Mondays at 08:00; last ran this Monday.
    expect(isCronDue(cron("0 8 * * 1", "2026-08-03T08:00:00Z"), WED_10H)).toBe(false);
  });

  test("an invalid expression is never due rather than firing every tick", () => {
    expect(isCronDue(cron("not a cron"), WED_10H)).toBe(false);
  });
});

describe("isTimeWindowActive", () => {
  test("active inside the window", () => {
    expect(isTimeWindowActive(window({ startHour: 9, endHour: 17 }), WED_10H)).toBe(true);
  });

  test("inactive outside the window", () => {
    expect(isTimeWindowActive(window({ startHour: 9, endHour: 17 }), WED_23H)).toBe(false);
  });

  test("handles a window that wraps past midnight", () => {
    expect(isTimeWindowActive(window({ startHour: 22, endHour: 6 }), WED_23H)).toBe(true);
    expect(isTimeWindowActive(window({ startHour: 22, endHour: 6 }), WED_10H)).toBe(false);
  });

  test("inactive on a weekday that is not allowed", () => {
    // Only Mondays (1); WED_10H is a Wednesday.
    expect(
      isTimeWindowActive(window({ startHour: 9, endHour: 17, daysOfWeek: [1] }), WED_10H),
    ).toBe(false);
  });

  test("a prompt-style agent is held back by the cooldown", () => {
    expect(
      isTimeWindowActive(
        window({ startHour: 9, endHour: 17, lastRunAt: "2026-08-05T09:58:00Z" }),
        WED_10H,
      ),
    ).toBe(false);
  });

  test("a built-in reconciler ignores the cooldown", () => {
    expect(
      isTimeWindowActive(
        window({
          startHour: 9,
          endHour: 17,
          lastRunAt: "2026-08-05T09:58:00Z",
          targetConfig: { backlogDrain: { enabled: true } },
        }),
        WED_10H,
      ),
    ).toBe(true);
  });

  // ---------------------------------------------------------------------
  // isBuiltinReconciler contract pin — must treat all four built-in
  // automation flags identically (any one of them enabled -> no cooldown),
  // and must NOT treat an unrelated/absent targetConfig as a reconciler.
  // This now derives from @almirant/shared's builtin-automations catalog
  // (resolveEnabledBuiltinAutomation) instead of its own literal OR chain;
  // these cases pin that the derived behavior is unchanged.
  // ---------------------------------------------------------------------
  test("dodRemediation ignores the cooldown, same as backlogDrain", () => {
    expect(
      isTimeWindowActive(
        window({
          startHour: 9,
          endHour: 17,
          lastRunAt: "2026-08-05T09:58:00Z",
          targetConfig: { dodRemediation: { enabled: true } },
        }),
        WED_10H,
      ),
    ).toBe(true);
  });

  test("dodReview ignores the cooldown, same as backlogDrain", () => {
    expect(
      isTimeWindowActive(
        window({
          startHour: 9,
          endHour: 17,
          lastRunAt: "2026-08-05T09:58:00Z",
          targetConfig: { dodReview: { enabled: true } },
        }),
        WED_10H,
      ),
    ).toBe(true);
  });

  test("releaseIntegration ignores the cooldown, same as backlogDrain", () => {
    expect(
      isTimeWindowActive(
        window({
          startHour: 9,
          endHour: 17,
          lastRunAt: "2026-08-05T09:58:00Z",
          targetConfig: { releaseIntegration: { enabled: true } },
        }),
        WED_10H,
      ),
    ).toBe(true);
  });

  test("a targetConfig with every flag explicitly false is NOT a reconciler — cooldown still applies", () => {
    expect(
      isTimeWindowActive(
        window({
          startHour: 9,
          endHour: 17,
          lastRunAt: "2026-08-05T09:58:00Z",
          targetConfig: {
            backlogDrain: { enabled: false },
            dodRemediation: { enabled: false },
            dodReview: { enabled: false },
            releaseIntegration: { enabled: false },
          },
        }),
        WED_10H,
      ),
    ).toBe(false);
  });

  test("an absent targetConfig is NOT a reconciler — cooldown still applies", () => {
    expect(
      isTimeWindowActive(
        window({
          startHour: 9,
          endHour: 17,
          lastRunAt: "2026-08-05T09:58:00Z",
        }),
        WED_10H,
      ),
    ).toBe(false);
  });
});

const once = (runAt: string): ScheduleEvaluationInput => ({
  scheduleType: "once",
  scheduleConfig: { runAt },
  timezone: "UTC",
  lastRunAt: null,
});

describe("isOnceDue", () => {
  test("is due once runAt has passed", () => {
    expect(isOnceDue(once("2026-08-05T09:00:00Z"), WED_10H)).toBe(true);
  });

  test("is due exactly at runAt (boundary)", () => {
    expect(isOnceDue(once("2026-08-05T10:00:00Z"), WED_10H)).toBe(true);
  });

  test("is not due while runAt is still in the future", () => {
    expect(isOnceDue(once("2026-08-05T11:00:00Z"), WED_10H)).toBe(false);
  });

  test("a past runAt is due — creating with a past runAt is allowed and simply fires on the next tick", () => {
    expect(isOnceDue(once("2020-01-01T00:00:00Z"), WED_10H)).toBe(true);
  });

  test("ignores lastRunAt entirely — unlike cron, there is no 'next occurrence' to compute", () => {
    const config: ScheduleEvaluationInput = {
      scheduleType: "once",
      scheduleConfig: { runAt: "2026-08-05T09:00:00Z" },
      timezone: "UTC",
      lastRunAt: "2026-08-05T09:30:00Z",
    };
    expect(isOnceDue(config, WED_10H)).toBe(true);
  });

  test("a missing runAt is never due", () => {
    expect(
      isOnceDue(
        { scheduleType: "once", scheduleConfig: {}, timezone: "UTC", lastRunAt: null },
        WED_10H,
      ),
    ).toBe(false);
  });

  test("an unparseable runAt is never due rather than throwing", () => {
    expect(isOnceDue(once("not-a-date"), WED_10H)).toBe(false);
  });

  test("a null scheduleConfig is never due", () => {
    expect(
      isOnceDue(
        { scheduleType: "once", scheduleConfig: null, timezone: "UTC", lastRunAt: null },
        WED_10H,
      ),
    ).toBe(false);
  });
});

describe("isScheduleDue", () => {
  test("routes by scheduleType", () => {
    expect(isScheduleDue(cron("*/5 * * * *"), WED_10H)).toBe(true);
    expect(isScheduleDue(window({ startHour: 9, endHour: 17 }), WED_10H)).toBe(true);
    expect(isScheduleDue(window({ startHour: 0, endHour: 1 }), WED_10H)).toBe(false);
  });

  test("routes 'once' to isOnceDue", () => {
    expect(isScheduleDue(once("2026-08-05T09:00:00Z"), WED_10H)).toBe(true);
    expect(isScheduleDue(once("2026-08-05T11:00:00Z"), WED_10H)).toBe(false);
  });
});
