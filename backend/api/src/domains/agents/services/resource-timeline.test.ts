import { describe, expect, test } from "bun:test";
import { buildResourceTimeline, buildSubagentMemoryProfiles } from "./resource-timeline";

describe("resource timeline", () => {
  test("correlates RAM samples with active subagents", () => {
    const timeline = buildResourceTimeline(
      {
        id: "job-1",
        workerId: "worker-1",
        workItemId: "task-1",
        config: { skillName: "runner-implement", resourceEstimate: { estimatedMemoryMb: 4096, source: "forecast", confidence: "low" } },
      } as never,
      [
        { timestamp: new Date("2026-01-01T00:00:00Z"), ramUsedMb: 2000, ramTotalMb: 16000, containerMetrics: [{ jobId: "job-1", memoryUsageMb: 2100 }] },
        { timestamp: new Date("2026-01-01T00:01:00Z"), ramUsedMb: 4500, ramTotalMb: 16000, containerMetrics: [{ jobId: "job-1", memoryUsageMb: 4600 }] },
        { timestamp: new Date("2026-01-01T00:03:00Z"), ramUsedMb: 2500, ramTotalMb: 16000, containerMetrics: [{ jobId: "job-1", memoryUsageMb: 2600 }] },
      ] as never,
      [
        { kind: "agent.subagent.spawn", createdAt: new Date("2026-01-01T00:00:30Z"), payload: { subagentId: "a", subagentType: "frontend-developer", description: "Build UI" } },
        { kind: "agent.subagent.complete", createdAt: new Date("2026-01-01T00:02:00Z"), payload: { subagentId: "a", success: true } },
      ] as never,
    );

    expect(timeline.samples.map((sample) => sample.activeSubagents)).toEqual([0, 1, 0]);
    expect(timeline.summary.peakRamMb).toBe(4600);
    expect(timeline.summary.forecastDeltaMb).toBe(504);
  });

  test("infers background subagent completion from transcript text", () => {
    const timeline = buildResourceTimeline(
      { id: "job-1", workerId: "worker-1", workItemId: "task-1", config: {} } as never,
      [
        { timestamp: new Date("2026-01-01T00:00:00Z"), ramUsedMb: 1000, ramTotalMb: 16000, containerMetrics: null },
        { timestamp: new Date("2026-01-01T00:01:00Z"), ramUsedMb: 2000, ramTotalMb: 16000, containerMetrics: null },
        { timestamp: new Date("2026-01-01T00:02:00Z"), ramUsedMb: 2100, ramTotalMb: 16000, containerMetrics: null },
      ] as never,
      [
        { kind: "agent.subagent.spawn", createdAt: new Date("2026-01-01T00:00:10Z"), payload: { subagentId: "a", subagentType: "javascript-pro", description: "Implement ZC-79 Zod schema" } },
        { kind: "agent.text", createdAt: new Date("2026-01-01T00:01:30Z"), payload: { content: "ZC-79 agent completed successfully." } },
      ] as never,
    );

    expect(timeline.agents[0]?.completedAt).toBe("2026-01-01T00:01:30.000Z");
    expect(timeline.samples.map((sample) => sample.activeSubagents)).toEqual([0, 1, 0]);
  });

  test("uses remaining progress text to mark completed background subagents", () => {
    const timeline = buildResourceTimeline(
      { id: "job-1", workerId: "worker-1", workItemId: "task-1", config: {} } as never,
      [
        { timestamp: new Date("2026-01-01T00:00:00Z"), ramUsedMb: 1000, ramTotalMb: 16000, containerMetrics: null },
        { timestamp: new Date("2026-01-01T00:01:00Z"), ramUsedMb: 2000, ramTotalMb: 16000, containerMetrics: null },
        { timestamp: new Date("2026-01-01T00:02:00Z"), ramUsedMb: 2100, ramTotalMb: 16000, containerMetrics: null },
      ] as never,
      [
        { kind: "agent.subagent.spawn", createdAt: new Date("2026-01-01T00:00:10Z"), payload: { subagentId: "a", subagentType: "backend-architect", description: "Implement ZC-78 module skeleton" } },
        { kind: "agent.subagent.spawn", createdAt: new Date("2026-01-01T00:00:10Z"), payload: { subagentId: "b", subagentType: "backend-architect", description: "Implement ZC-81 LinkedIn adapter" } },
        { kind: "agent.text", createdAt: new Date("2026-01-01T00:01:30Z"), payload: { content: "Still waiting for ZC-81 to complete." } },
      ] as never,
    );

    expect(timeline.agents.find((agent) => agent.subagentId === "a")?.completedAt).toBe("2026-01-01T00:01:30.000Z");
    expect(timeline.agents.find((agent) => agent.subagentId === "b")?.completedAt).toBeNull();
    expect(timeline.samples.map((sample) => sample.activeSubagents)).toEqual([0, 2, 1]);
  });

  test("counts retried wave agents without keeping completed or failed attempts active", () => {
    const timeline = buildResourceTimeline(
      { id: "job-1", workerId: "worker-1", workItemId: "task-1", config: {} } as never,
      [
        { timestamp: new Date("2026-04-29T12:20:00Z"), ramUsedMb: 1000, ramTotalMb: 16000, containerMetrics: null },
        { timestamp: new Date("2026-04-29T12:35:00Z"), ramUsedMb: 2400, ramTotalMb: 16000, containerMetrics: null },
      ] as never,
      [
        { kind: "agent.subagent.spawn", createdAt: new Date("2026-04-29T12:05:59Z"), payload: { subagentId: "f-156", subagentType: "backend-architect", description: "Implement F-156 BetterAuth backend config" } },
        { kind: "agent.text", createdAt: new Date("2026-04-29T12:23:14Z"), payload: { content: "F-156|SUCCESS" } },
        { kind: "agent.subagent.spawn", createdAt: new Date("2026-04-29T12:28:56Z"), payload: { subagentId: "f-157-original", subagentType: "frontend-developer", description: "Implement F-157 frontend auth client" } },
        { kind: "agent.subagent.spawn", createdAt: new Date("2026-04-29T12:28:56Z"), payload: { subagentId: "f-158", subagentType: "backend-architect", description: "Implement F-158 auth session tests" } },
        { kind: "agent.text", createdAt: new Date("2026-04-29T12:34:05Z"), payload: { content: "frontend-developer|F-157|FAILED|429 rate limit - reintentando..." } },
        { kind: "agent.subagent.spawn", createdAt: new Date("2026-04-29T12:34:15Z"), payload: { subagentId: "f-157-retry", subagentType: "frontend-developer", description: "Retry F-157 frontend auth client" } },
        { kind: "agent.text", createdAt: new Date("2026-04-29T12:34:15Z"), payload: { content: "F-157 relanzado tras error 429. Esperando ambos agentes de Wave 2..." } },
      ] as never,
    );

    expect(timeline.agents.find((agent) => agent.subagentId === "f-156")?.success).toBe(true);
    expect(timeline.agents.find((agent) => agent.subagentId === "f-157-original")?.success).toBe(false);
    expect(timeline.agents.find((agent) => agent.subagentId === "f-157-retry")?.completedAt).toBeNull();
    expect(timeline.samples.map((sample) => sample.activeSubagents)).toEqual([1, 2]);
  });

  test("keeps original interval when a completed subagent lifecycle is replayed", () => {
    const timeline = buildResourceTimeline(
      { id: "job-1", workerId: "worker-1", workItemId: "task-1", config: {} } as never,
      [
        {
          timestamp: new Date("2026-05-02T12:01:00Z"),
          ramUsedMb: 1000,
          ramTotalMb: 16000,
          containerMetrics: null,
        },
        {
          timestamp: new Date("2026-05-02T12:03:00Z"),
          ramUsedMb: 2000,
          ramTotalMb: 16000,
          containerMetrics: null,
        },
        {
          timestamp: new Date("2026-05-02T12:06:00Z"),
          ramUsedMb: 2200,
          ramTotalMb: 16000,
          containerMetrics: null,
        },
        {
          timestamp: new Date("2026-05-02T12:09:00Z"),
          ramUsedMb: 1200,
          ramTotalMb: 16000,
          containerMetrics: null,
        },
      ] as never,
      [
        {
          kind: "agent.subagent.spawn",
          createdAt: new Date("2026-05-02T12:01:23Z"),
          payload: {
            subagentId: "call-a",
            subagentType: "frontend-developer",
            description: "Implement ZC-152",
          },
        },
        {
          kind: "agent.subagent.complete",
          createdAt: new Date("2026-05-02T12:08:37Z"),
          payload: { subagentId: "call-a", success: true },
        },
        {
          kind: "agent.subagent.spawn",
          createdAt: new Date("2026-05-02T12:10:00Z"),
          payload: {
            subagentId: "call-a",
            subagentType: "frontend-developer",
            description: "Implement ZC-152",
          },
        },
        {
          kind: "agent.subagent.complete",
          createdAt: new Date("2026-05-02T12:10:00Z"),
          payload: { subagentId: "call-a", success: true },
        },
      ] as never,
    );

    expect(timeline.agents).toHaveLength(1);
    expect(timeline.agents[0]?.startedAt).toBe("2026-05-02T12:01:23.000Z");
    expect(timeline.agents[0]?.completedAt).toBe("2026-05-02T12:08:37.000Z");
    expect(timeline.samples.map((sample) => sample.activeSubagents)).toEqual([0, 1, 1, 0]);
  });

  test("builds statistical profiles without exact per-subagent attribution", () => {
    const timeline = buildResourceTimeline(
      { id: "job-1", workerId: "w", workItemId: "t", config: {} } as never,
      [
        { timestamp: new Date("2026-01-01T00:00:00Z"), ramUsedMb: 2000, ramTotalMb: 16000, containerMetrics: null },
        { timestamp: new Date("2026-01-01T00:01:00Z"), ramUsedMb: 5000, ramTotalMb: 16000, containerMetrics: null },
      ] as never,
      [
        { kind: "agent.subagent.spawn", createdAt: new Date("2026-01-01T00:00:30Z"), payload: { subagentId: "a", subagentType: "frontend-developer" } },
      ] as never,
    );

    const profiles = buildSubagentMemoryProfiles([timeline]);
    expect(profiles[0]).toMatchObject({
      subagentType: "frontend-developer",
      p50MemoryDeltaMb: 3000,
      p95MemoryDeltaMb: 3000,
      sampleCount: 1,
      confidence: "low",
    });
  });
});
