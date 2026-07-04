import { describe, expect, it } from "bun:test";
import { selectConnectionUsage } from "./usage-selectors";
import type { ConnectionUsageData, UsageSummaryResponseItem } from "./types";

const usage = (totalTokens: number): ConnectionUsageData => ({
  supported: true,
  source: "oauth_usage",
  period: { startDate: "2026-07-01", endDate: "2026-07-04" },
  totals: {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens,
    costUsd: 0,
    requests: 0,
  },
});

const item = (connectionId: string, totalTokens: number): UsageSummaryResponseItem => ({
  connectionId,
  provider: "anthropic",
  name: `conn-${connectionId}`,
  accountIdentifier: null,
  usage: usage(totalTokens),
});

describe("selectConnectionUsage (batched usage summary -> per-connection subset)", () => {
  const items = [item("a", 10), item("b", 20), item("c", 30)];

  it("returns the usage subset for the matching connectionId", () => {
    expect(selectConnectionUsage(items, "b")?.totals.totalTokens).toBe(20);
  });

  it("returns null when the connectionId is not present", () => {
    expect(selectConnectionUsage(items, "zzz")).toBeNull();
  });

  it("returns null when items are undefined (query not yet resolved)", () => {
    expect(selectConnectionUsage(undefined, "a")).toBeNull();
  });

  it("returns null for an empty connectionId", () => {
    expect(selectConnectionUsage(items, "")).toBeNull();
  });
});
