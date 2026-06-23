import { describe, test, expect } from "bun:test";
import {
  getRunDurationMs,
  resolveRunModel,
  resolveRunStatusLabel,
} from "./run-utils";
import type { AgentJob } from "./types";

const makeJob = (overrides: Partial<AgentJob> = {}): AgentJob => ({
  id: "job-1",
  workItemId: "wi-1",
  projectId: "proj-1",
  boardId: "board-1",
  status: "queued",
  provider: "claude-code",
  priority: "medium",
  branchName: null,
  prUrl: null,
  prNumber: null,
  cost: null,
  tokensUsed: null,
  durationMs: null,
  errorMessage: null,
  errorType: null,
  createdAt: new Date("2025-01-01T00:00:00Z"),
  startedAt: null,
  completedAt: null,
  ...overrides,
});

describe("getRunDurationMs", () => {
  test("completed job: returns stored durationMs directly", () => {
    const job = makeJob({
      status: "completed",
      durationMs: 45000,
      startedAt: new Date("2025-01-01T00:00:00Z"),
      completedAt: new Date("2025-01-01T00:01:00Z"),
    });

    expect(getRunDurationMs(job)).toBe(45000);
  });

  test("running job, first segment: returns elapsed since startedAt", () => {
    const startedAt = new Date("2025-01-01T00:00:00Z");
    const nowMs = startedAt.getTime() + 30_000; // 30s after start

    const job = makeJob({
      status: "running",
      startedAt,
    });

    const result = getRunDurationMs(job, nowMs);

    expect(result).toBeGreaterThanOrEqual(29_900);
    expect(result).toBeLessThanOrEqual(30_100);
  });

  test("running job, Nth segment: returns cumulative + current segment", () => {
    const startedAt = new Date("2025-01-01T00:10:00Z");
    const nowMs = startedAt.getTime() + 20_000; // 20s into current segment

    const job = makeJob({
      status: "running",
      startedAt,
      cumulativeDurationMs: 60_000, // 60s from previous segments
    });

    const result = getRunDurationMs(job, nowMs);

    // Should be cumulative (60s) + current segment (20s) = 80s
    expect(result).toBeGreaterThanOrEqual(79_900);
    expect(result).toBeLessThanOrEqual(80_100);
  });

  test("queued job between segments: returns cumulative only", () => {
    const job = makeJob({
      status: "queued",
      startedAt: null,
      cumulativeDurationMs: 45_000,
    });

    expect(getRunDurationMs(job)).toBe(45_000);
  });

  test("queued job, never started, no cumulative: returns null", () => {
    const job = makeJob({
      status: "queued",
      startedAt: null,
    });

    expect(getRunDurationMs(job)).toBeNull();
  });

  test("completed job without cumulativeDurationMs field: works like before", () => {
    const job = makeJob({
      status: "completed",
      durationMs: 120_000,
      startedAt: new Date("2025-01-01T00:00:00Z"),
      completedAt: new Date("2025-01-01T00:02:00Z"),
      // no cumulativeDurationMs
    });

    expect(getRunDurationMs(job)).toBe(120_000);
  });

  test("running job without cumulativeDurationMs field: fallback to segment only", () => {
    const startedAt = new Date("2025-01-01T00:00:00Z");
    const nowMs = startedAt.getTime() + 15_000; // 15s into segment

    const job = makeJob({
      status: "running",
      startedAt,
      // no cumulativeDurationMs
    });

    const result = getRunDurationMs(job, nowMs);

    // cumulative defaults to 0, so result = 0 + 15s = 15s
    expect(result).toBeGreaterThanOrEqual(14_900);
    expect(result).toBeLessThanOrEqual(15_100);
  });
});

describe("resolveRunModel", () => {
  test("prefers the runtime-resolved top-level model over config aliases", () => {
    const job = makeJob({
      model: "gpt-5.4",
      config: {
        model: "gpt-5",
      },
      result: {
        model: "gpt-5-mini",
      },
    });

    expect(resolveRunModel(job)).toBe("gpt-5.4");
  });

  test("falls back to config model when top-level model is missing", () => {
    const job = makeJob({
      config: {
        model: "claude-sonnet-4-5",
      },
    });

    expect(resolveRunModel(job)).toBe("claude-sonnet-4-5");
  });
});

describe("resolveRunStatusLabel", () => {
  test("labels paused rate-limit jobs as rate-limit pauses, not quota pauses", () => {
    expect(
      resolveRunStatusLabel("paused", {
        errorType: "rate_limit",
        errorMessage: "Session hit API rate limit",
      }),
    ).toBe("Paused by rate limit");
  });

  test("keeps true quota pauses explicit", () => {
    expect(
      resolveRunStatusLabel("paused", {
        errorType: "weekly_quota_exceeded",
        errorMessage: "weekly token limit exceeded",
      }),
    ).toBe("Paused by quota");
  });

  test("uses a neutral paused label when no pause reason is known", () => {
    expect(resolveRunStatusLabel("paused")).toBe("Paused");
  });
});
