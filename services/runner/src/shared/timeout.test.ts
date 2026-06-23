import { describe, expect, it } from "bun:test";
import {
  computeOverallTimeout,
  DEFAULT_OVERALL_TIMEOUT_MS,
  DEFAULT_EFFORT_POINT_DURATION_MS,
  DEFAULT_PRE_SESSION_TIMEOUT_MS,
  withPhaseTimeout,
} from "./timeout";

describe("timeout constants", () => {
  it("DEFAULT_OVERALL_TIMEOUT_MS is 3 hours", () => {
    const threeHoursMs = 3 * 60 * 60 * 1000;
    expect(DEFAULT_OVERALL_TIMEOUT_MS).toBe(threeHoursMs);
    expect(DEFAULT_OVERALL_TIMEOUT_MS).toBe(10_800_000);
  });

  it("DEFAULT_EFFORT_POINT_DURATION_MS is 20 minutes", () => {
    const twentyMinutesMs = 20 * 60 * 1000;
    expect(DEFAULT_EFFORT_POINT_DURATION_MS).toBe(twentyMinutesMs);
    expect(DEFAULT_EFFORT_POINT_DURATION_MS).toBe(1_200_000);
  });

  it("DEFAULT_PRE_SESSION_TIMEOUT_MS is 5 minutes", () => {
    const fiveMinutesMs = 5 * 60 * 1000;
    expect(DEFAULT_PRE_SESSION_TIMEOUT_MS).toBe(fiveMinutesMs);
    expect(DEFAULT_PRE_SESSION_TIMEOUT_MS).toBe(300_000);
  });
});

describe("withPhaseTimeout", () => {
  it("resolves when the phase finishes before the timeout", async () => {
    const result = await withPhaseTimeout(
      Promise.resolve("ok"),
      { phase: "session.create", timeoutMs: 50 },
    );

    expect(result).toBe("ok");
  });

  it("rejects with phase metadata when the phase exceeds the timeout", async () => {
    let timeoutCalled = false;

    await expect(
      withPhaseTimeout(
        new Promise((resolve) => setTimeout(() => resolve("late"), 50)),
        {
          phase: "pre-session",
          timeoutMs: 5,
          onTimeout: () => {
            timeoutCalled = true;
          },
        },
      ),
    ).rejects.toMatchObject({
      message: "Phase \"pre-session\" timed out after 5ms",
      code: "phase_timeout",
      phase: "pre-session",
      timeoutMs: 5,
    });

    expect(timeoutCalled).toBe(true);
  });
});

describe("computeOverallTimeout", () => {
  const baseTimeout = DEFAULT_OVERALL_TIMEOUT_MS;
  const effortDuration = DEFAULT_EFFORT_POINT_DURATION_MS;

  describe("returns base timeout for invalid estimatedHours", () => {
    it("returns base timeout when estimatedHours is null", () => {
      const result = computeOverallTimeout(null, baseTimeout, effortDuration);
      expect(result).toBe(baseTimeout);
    });

    it("returns base timeout when estimatedHours is undefined", () => {
      const result = computeOverallTimeout(undefined, baseTimeout, effortDuration);
      expect(result).toBe(baseTimeout);
    });

    it("returns base timeout when estimatedHours is 0", () => {
      const result = computeOverallTimeout(0, baseTimeout, effortDuration);
      expect(result).toBe(baseTimeout);
    });

    it("returns base timeout when estimatedHours is negative", () => {
      const result = computeOverallTimeout(-5, baseTimeout, effortDuration);
      expect(result).toBe(baseTimeout);
    });

    it("returns base timeout when estimatedHours is -0.1", () => {
      const result = computeOverallTimeout(-0.1, baseTimeout, effortDuration);
      expect(result).toBe(baseTimeout);
    });
  });

  describe("returns base timeout when effort calculation is less than base", () => {
    it("estimatedHours = 1 with default 20min/point = 20min < 3h base", () => {
      // 1 hour * 20 min/point = 20 minutes = 1,200,000 ms
      // base = 3 hours = 10,800,000 ms
      // max(10,800,000, 1,200,000) = 10,800,000
      const result = computeOverallTimeout(1, baseTimeout, effortDuration);
      expect(result).toBe(baseTimeout);
    });

    it("estimatedHours = 5 with default 20min/point = 100min < 3h base", () => {
      // 5 hours * 20 min/point = 100 minutes = 6,000,000 ms
      // base = 3 hours = 10,800,000 ms
      // max(10,800,000, 6,000,000) = 10,800,000
      const result = computeOverallTimeout(5, baseTimeout, effortDuration);
      expect(result).toBe(baseTimeout);
    });

    it("estimatedHours = 9 with default 20min/point = 180min = 3h = base", () => {
      // 9 hours * 20 min/point = 180 minutes = 3 hours = 10,800,000 ms
      // max(10,800,000, 10,800,000) = 10,800,000
      const result = computeOverallTimeout(9, baseTimeout, effortDuration);
      expect(result).toBe(baseTimeout);
    });
  });

  describe("returns effort-based timeout when it exceeds base", () => {
    it("estimatedHours = 10 with default 20min/point = 200min > 3h base", () => {
      // 10 hours * 20 min/point = 200 minutes = 12,000,000 ms
      // base = 3 hours = 10,800,000 ms
      // max(10,800,000, 12,000,000) = 12,000,000
      const result = computeOverallTimeout(10, baseTimeout, effortDuration);
      expect(result).toBe(12_000_000);
    });

    it("estimatedHours = 20 with default 20min/point = 400min", () => {
      // 20 hours * 20 min/point = 400 minutes = 24,000,000 ms
      const result = computeOverallTimeout(20, baseTimeout, effortDuration);
      expect(result).toBe(24_000_000);
    });

    it("estimatedHours = 15 with default 20min/point = 300min = 5h", () => {
      // 15 hours * 20 min/point = 300 minutes = 5 hours = 18,000,000 ms
      const result = computeOverallTimeout(15, baseTimeout, effortDuration);
      expect(result).toBe(18_000_000);
    });
  });

  describe("scales linearly with effort points", () => {
    it("doubling estimatedHours doubles the effort-based timeout", () => {
      const result10 = computeOverallTimeout(10, baseTimeout, effortDuration);
      const result20 = computeOverallTimeout(20, baseTimeout, effortDuration);

      // Both exceed base, so we can compare the linear relationship
      expect(result20).toBe(result10 * 2);
    });

    it("tripling estimatedHours triples the effort-based timeout", () => {
      const result10 = computeOverallTimeout(10, baseTimeout, effortDuration);
      const result30 = computeOverallTimeout(30, baseTimeout, effortDuration);

      expect(result30).toBe(result10 * 3);
    });
  });

  describe("works with custom base timeout and effort duration", () => {
    it("uses custom base timeout", () => {
      const customBase = 5 * 60 * 60 * 1000; // 5 hours
      const result = computeOverallTimeout(null, customBase, effortDuration);
      expect(result).toBe(customBase);
    });

    it("uses custom effort duration", () => {
      const customEffort = 60 * 60 * 1000; // 1 hour per point
      // 10 hours * 1 hour/point = 10 hours = 36,000,000 ms
      const result = computeOverallTimeout(10, baseTimeout, customEffort);
      expect(result).toBe(36_000_000);
    });

    it("respects base timeout even with custom effort duration when effort is less", () => {
      const customBase = 10 * 60 * 60 * 1000; // 10 hours
      const customEffort = 30 * 60 * 1000; // 30 min per point
      // 10 hours * 30 min/point = 300 min = 5 hours = 18,000,000 ms
      // max(36,000,000, 18,000,000) = 36,000,000
      const result = computeOverallTimeout(10, customBase, customEffort);
      expect(result).toBe(customBase);
    });
  });

  describe("edge cases", () => {
    it("handles very large effort points", () => {
      const largeEffort = 1000; // 1000 hours
      // 1000 * 20 min = 20,000 min = 333.33 hours = 1,200,000,000 ms
      const result = computeOverallTimeout(largeEffort, baseTimeout, effortDuration);
      expect(result).toBe(1_200_000_000);
    });

    it("handles fractional effort points", () => {
      // 10.5 hours * 20 min/point = 210 min = 12,600,000 ms
      const result = computeOverallTimeout(10.5, baseTimeout, effortDuration);
      expect(result).toBe(12_600_000);
    });

    it("handles very small positive effort points", () => {
      // 0.1 hours * 20 min/point = 2 min = 120,000 ms
      // max(10,800,000, 120,000) = 10,800,000
      const result = computeOverallTimeout(0.1, baseTimeout, effortDuration);
      expect(result).toBe(baseTimeout);
    });

    it("handles zero base timeout", () => {
      // With zero base, any positive effort calculation wins
      const result = computeOverallTimeout(1, 0, effortDuration);
      expect(result).toBe(1_200_000); // 1 * 20 min = 1,200,000 ms
    });

    it("handles zero effort duration", () => {
      // 10 hours * 0 = 0 ms
      // max(10,800,000, 0) = 10,800,000
      const result = computeOverallTimeout(10, baseTimeout, 0);
      expect(result).toBe(baseTimeout);
    });

    it("handles both zero base and zero effort duration", () => {
      // max(0, 0) = 0
      const result = computeOverallTimeout(10, 0, 0);
      expect(result).toBe(0);
    });

    it("handles Number.MAX_SAFE_INTEGER effort", () => {
      // This tests numeric overflow behavior
      const result = computeOverallTimeout(Number.MAX_SAFE_INTEGER, baseTimeout, 1);
      expect(result).toBe(Number.MAX_SAFE_INTEGER);
    });
  });

  describe("boundary conditions around base timeout", () => {
    it("effort exactly at base returns base (Math.max behavior)", () => {
      // Find effort that equals base exactly
      // baseTimeout = estimatedHours * effortDuration
      // 10,800,000 = estimatedHours * 1,200,000
      // estimatedHours = 9
      const exactMatch = computeOverallTimeout(9, baseTimeout, effortDuration);
      expect(exactMatch).toBe(baseTimeout);
    });

    it("effort just above base returns effort", () => {
      // 9.001 hours * 20 min = 180.02 min = 10,801,200 ms
      const justAbove = computeOverallTimeout(9.001, baseTimeout, effortDuration);
      expect(justAbove).toBeGreaterThan(baseTimeout);
      expect(justAbove).toBe(9.001 * effortDuration);
    });

    it("effort just below base returns base", () => {
      // 8.999 hours * 20 min = 179.98 min = 10,798,800 ms
      const justBelow = computeOverallTimeout(8.999, baseTimeout, effortDuration);
      expect(justBelow).toBe(baseTimeout);
    });
  });
});
