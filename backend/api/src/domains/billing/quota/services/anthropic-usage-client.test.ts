import { afterAll, describe, expect, it, mock } from "bun:test";
import { createLoggerMock, restoreRealModules } from "../../../../test/mocks";

mock.module("@almirant/config", () => createLoggerMock());

describe("normalizeAnthropicOAuthUsageResponse", () => {
  it("maps Anthropic snake_case OAuth usage into the camelCase UI contract", async () => {
    const { normalizeAnthropicOAuthUsageResponse } = await import(
      "./anthropic-usage-client"
    );

    const normalized = normalizeAnthropicOAuthUsageResponse({
      five_hour: {
        utilization: 72,
        resets_at: "2026-03-08T21:00:00.000Z",
      },
      seven_day: {
        utilization: 0.34,
        resets_at: "2026-03-15T21:00:00.000Z",
      },
      seven_day_opus: null,
      seven_day_sonnet: {
        utilization: 18,
        resets_at: "2026-03-15T21:00:00.000Z",
      },
      extra_usage: {
        is_enabled: false,
        monthly_limit: null,
        used_credits: null,
        utilization: null,
        currency: null,
      },
    });

    expect(normalized.fiveHour).toEqual({
      utilization: 72,
      resetsAt: "2026-03-08T21:00:00.000Z",
    });
    expect(normalized.sevenDay).toEqual({
      utilization: 34,
      resetsAt: "2026-03-15T21:00:00.000Z",
    });
    expect(normalized.sevenDayOpus).toBeUndefined();
    expect(normalized.sevenDaySonnet).toEqual({
      utilization: 18,
      resetsAt: "2026-03-15T21:00:00.000Z",
    });
    expect(normalized.extraUsage).toEqual({
      isEnabled: false,
      monthlyLimit: 0,
      usedCredits: 0,
      utilization: 0,
      currency: "USD",
    });
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
});
