import { describe, expect, it } from "bun:test";
import {
  isCronDue,
  isOnceDue,
  isScheduledAgentRunnable,
  isTimeWindowActive,
  resolveScheduledDispatchDueKey,
  type ScheduledAgentDueConfig,
} from "./scheduled-agent-due";

const baseConfig = (
  overrides: Partial<ScheduledAgentDueConfig> = {},
): ScheduledAgentDueConfig => ({
  configId: "cfg-1",
  name: "Nightly Backlog Implementation",
  enabled: true,
  trigger: "scheduled",
  scheduleType: "cron",
  scheduleConfig: { expression: "*/15 * * * *" },
  timezone: "UTC",
  lastRunAt: null,
  pausedUntil: null,
  ...overrides,
});

describe("resolveScheduledDispatchDueKey", () => {
  it("uses the oldest undispatched cron occurrence after lastRunAt", () => {
    const config = baseConfig({ lastRunAt: "2026-07-24T10:00:00.000Z" });

    expect(
      resolveScheduledDispatchDueKey(config, new Date("2026-07-24T10:47:00.000Z")),
    ).toEqual({ due: true, dueKey: "cron:2026-07-24T10:15:00.000Z" });
  });

  it("uses the latest due cron occurrence when there is no prior run", () => {
    const config = baseConfig({ lastRunAt: null });

    expect(
      resolveScheduledDispatchDueKey(config, new Date("2026-07-24T10:47:00.000Z")),
    ).toEqual({ due: true, dueKey: "cron:2026-07-24T10:45:00.000Z" });
  });

  it("keeps time-window retries in one stable five-minute bucket", () => {
    const config = baseConfig({
      scheduleType: "time_window",
      scheduleConfig: { startHour: 22, endHour: 8, daysOfWeek: [1, 2, 3, 4, 5] },
    });

    expect(
      resolveScheduledDispatchDueKey(config, new Date("2026-07-24T10:01:05.000Z")),
    ).toEqual({ due: true, dueKey: "time-window:2026-07-24T10:00:00.000Z" });
    expect(
      resolveScheduledDispatchDueKey(config, new Date("2026-07-24T10:04:59.999Z")),
    ).toEqual({ due: true, dueKey: "time-window:2026-07-24T10:00:00.000Z" });
    expect(
      resolveScheduledDispatchDueKey(config, new Date("2026-07-24T10:05:00.000Z")),
    ).toEqual({ due: true, dueKey: "time-window:2026-07-24T10:05:00.000Z" });
  });

  it("returns due:false instead of throwing for an invalid cron expression", () => {
    const config = baseConfig({
      scheduleConfig: { expression: "not a cron expression" },
      lastRunAt: "2026-07-24T10:00:00.000Z",
    });

    expect(() =>
      resolveScheduledDispatchDueKey(config, new Date("2026-07-24T10:47:00.000Z")),
    ).not.toThrow();
    expect(
      resolveScheduledDispatchDueKey(config, new Date("2026-07-24T10:47:00.000Z")),
    ).toEqual({ due: false });
  });

  it("returns due:false instead of throwing when lastRunAt is in the future", () => {
    const config = baseConfig({ lastRunAt: "2026-07-25T00:00:00.000Z" });

    expect(() =>
      resolveScheduledDispatchDueKey(config, new Date("2026-07-24T10:47:00.000Z")),
    ).not.toThrow();
    expect(
      resolveScheduledDispatchDueKey(config, new Date("2026-07-24T10:47:00.000Z")),
    ).toEqual({ due: false });
  });

  it("derives a 'once' due key from the canonicalized runAt, not from now", () => {
    const config = baseConfig({
      scheduleType: "once",
      scheduleConfig: { runAt: "2026-07-24T10:00:00.000Z" },
    });

    expect(
      resolveScheduledDispatchDueKey(config, new Date("2026-07-24T10:05:00.000Z")),
    ).toEqual({ due: true, dueKey: "once:2026-07-24T10:00:00.000Z" });
  });

  it("computes the SAME 'once' due key on a replay — the idempotency property two concurrent dispatch authorities rely on", () => {
    const config = baseConfig({
      scheduleType: "once",
      scheduleConfig: { runAt: "2026-07-24T10:00:00.000Z" },
    });

    const first = resolveScheduledDispatchDueKey(config, new Date("2026-07-24T10:00:01.000Z"));
    const second = resolveScheduledDispatchDueKey(config, new Date("2026-07-24T10:00:02.000Z"));

    expect(first).toEqual(second);
  });

  it("a 'once' config is not due while runAt is still in the future", () => {
    const config = baseConfig({
      scheduleType: "once",
      scheduleConfig: { runAt: "2026-07-25T00:00:00.000Z" },
    });

    expect(
      resolveScheduledDispatchDueKey(config, new Date("2026-07-24T10:47:00.000Z")),
    ).toEqual({ due: false });
  });

  it("returns due:false instead of throwing for a 'once' config with a missing runAt", () => {
    const config = baseConfig({ scheduleType: "once", scheduleConfig: {} });

    expect(() =>
      resolveScheduledDispatchDueKey(config, new Date("2026-07-24T10:47:00.000Z")),
    ).not.toThrow();
    expect(
      resolveScheduledDispatchDueKey(config, new Date("2026-07-24T10:47:00.000Z")),
    ).toEqual({ due: false });
  });
});

// isCronDue / isTimeWindowActive are thin delegations to `@almirant/shared`'s
// schedule-evaluation policy — the exhaustive scenario coverage (cron
// boundaries, invalid expressions, midnight-wrap windows, daysOfWeek gating,
// the targetConfig cooldown bypass for all four built-in reconciler modes,
// the 5-minute cooldown itself) lives in
// `backend/packages/shared/src/agents/schedule-evaluation.test.ts` and must
// not be duplicated here. These two smoke tests exist only to prove the
// `ScheduledAgentDueConfig` -> `ScheduleEvaluationInput` adapter actually
// wires our config shape through to the shared implementation correctly.
describe("isCronDue (adapter wiring to @almirant/shared)", () => {
  it("delegates to the shared cron policy", () => {
    const dueConfig = baseConfig({ lastRunAt: null });
    expect(isCronDue(dueConfig, new Date("2026-07-24T10:03:00.000Z"))).toBe(true);

    const notDueConfig = baseConfig({ lastRunAt: "2026-07-24T10:40:00.000Z" });
    expect(isCronDue(notDueConfig, new Date("2026-07-24T10:42:00.000Z"))).toBe(false);
  });
});

describe("isTimeWindowActive (adapter wiring to @almirant/shared)", () => {
  it("delegates to the shared time-window policy", () => {
    const config = baseConfig({
      scheduleType: "time_window",
      scheduleConfig: { startHour: 9, endHour: 17 },
    });

    // 2026-07-24T12:00:00.000Z is a Friday, inside the window.
    expect(isTimeWindowActive(config, new Date("2026-07-24T12:00:00.000Z"))).toBe(true);
    // 2026-07-24T18:00:00.000Z is outside the window.
    expect(isTimeWindowActive(config, new Date("2026-07-24T18:00:00.000Z"))).toBe(false);
  });
});

describe("isOnceDue (adapter wiring to @almirant/shared)", () => {
  it("delegates to the shared once policy", () => {
    const config = baseConfig({
      scheduleType: "once",
      scheduleConfig: { runAt: "2026-07-24T10:00:00.000Z" },
    });

    expect(isOnceDue(config, new Date("2026-07-24T10:00:00.000Z"))).toBe(true);
    expect(isOnceDue(config, new Date("2026-07-24T09:59:59.999Z"))).toBe(false);
  });
});

describe("isScheduledAgentRunnable", () => {
  const now = new Date("2026-07-24T10:47:00.000Z");

  it("is runnable when enabled, scheduled, non-manual, and not paused", () => {
    const config = baseConfig();

    expect(isScheduledAgentRunnable(config, now)).toBe(true);
  });

  it.each([
    ["disabled", { enabled: false }],
    ["webhook trigger", { trigger: "webhook" as const }],
    ["manual schedule type", { scheduleType: "manual" as const }],
    ["paused into the future", { pausedUntil: "2026-07-24T11:00:00.000Z" }],
  ])("is not runnable when %s", (_label, patch) => {
    const config = baseConfig(patch);

    expect(isScheduledAgentRunnable(config, now)).toBe(false);
  });

  it("is runnable again once pausedUntil is in the past", () => {
    const config = baseConfig({ pausedUntil: "2026-07-24T09:00:00.000Z" });

    expect(isScheduledAgentRunnable(config, now)).toBe(true);
  });

  it("treats a pausedUntil exactly equal to now as no longer paused", () => {
    const config = baseConfig({ pausedUntil: now.toISOString() });

    expect(isScheduledAgentRunnable(config, now)).toBe(true);
  });

  it("is runnable when scheduleType='once' — only 'manual' is excluded", () => {
    const config = baseConfig({
      scheduleType: "once",
      scheduleConfig: { runAt: "2026-07-24T10:00:00.000Z" },
    });

    expect(isScheduledAgentRunnable(config, now)).toBe(true);
  });
});
