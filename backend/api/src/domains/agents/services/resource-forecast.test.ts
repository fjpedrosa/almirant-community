import { describe, expect, test } from "bun:test";
import {
  buildExecutionWaves,
  calculateResourceForecast,
  estimateTaskMemory,
  inferSubagentTypeForTask,
} from "./resource-forecast";

describe("resource forecast", () => {
  test("infers meaningful subagent types from task text", () => {
    expect(inferSubagentTypeForTask({ title: "Build React dashboard", description: null })).toBe("frontend-developer");
    expect(inferSubagentTypeForTask({ title: "Add Drizzle migration", description: null })).toBe("database-architect");
    expect(inferSubagentTypeForTask({ title: "Write docs guide", description: null })).toBe("api-documenter");
  });

  test("builds dependency waves instead of counting all tasks as concurrent", () => {
    const waves = buildExecutionWaves(["a", "b", "c"], [
      { workItemId: "b", blockedByWorkItemId: "a" },
      { workItemId: "c", blockedByWorkItemId: "b" },
    ]);

    expect(waves).toEqual([
      { wave: 1, taskIds: ["a"] },
      { wave: 2, taskIds: ["b"] },
      { wave: 3, taskIds: ["c"] },
    ]);
  });

  test("uses capped empirical p95 profiles when available", () => {
    const estimated = estimateTaskMemory(
      { id: "task-1", title: "Build frontend page", type: "task" },
      [{ subagentType: "frontend-developer", p95MemoryDeltaMb: 5632, sampleCount: 42 }],
    );

    expect(estimated.estimatedMemoryMb).toBe(2560);
    expect(estimated.estimateSource).toBe("profile");
    expect(estimated.confidence).toBe("high");
  });

  test("caps empirical profile memory to avoid double-counting shared runner RAM", () => {
    const forecast = calculateResourceForecast({
      workItemId: "epic-1",
      generatedAt: new Date("2026-01-01T00:00:00.000Z"),
      tasks: [
        { id: "a", taskId: "A-1", title: "Add database migration", type: "task" },
        { id: "b", taskId: "A-2", title: "Add database indexes", type: "task" },
        { id: "c", taskId: "A-3", title: "Add database seed data", type: "task" },
      ],
      dependencies: [],
      profiles: [
        { subagentType: "database-architect", p95MemoryDeltaMb: 1927, sampleCount: 18 },
      ],
    });

    expect(forecast.waves[0]?.tasks.map((task) => task.estimatedMemoryMb)).toEqual([
      1927,
      1927,
      1927,
    ]);
    expect(forecast.estimatedPeakMemoryMb).toBe(7168);
    expect(forecast.confidence).toBe("medium");
  });

  test("starts with production-informed heuristics when profiles are not mature", () => {
    const estimated = estimateTaskMemory(
      { id: "task-1", title: "Build frontend page", type: "task" },
      [{ subagentType: "frontend-developer", p95MemoryDeltaMb: 3072, sampleCount: 3 }],
    );

    expect(estimated.estimatedMemoryMb).toBe(1280);
    expect(estimated.estimateSource).toBe("heuristic");
    expect(estimated.confidence).toBe("low");
  });

  test("computes peak memory from the most expensive wave", () => {
    const forecast = calculateResourceForecast({
      workItemId: "epic-1",
      generatedAt: new Date("2026-01-01T00:00:00.000Z"),
      tasks: [
        { id: "a", taskId: "A-1", title: "Build frontend", type: "task" },
        { id: "b", taskId: "A-2", title: "Write docs", type: "task" },
        { id: "c", taskId: "A-3", title: "Add database migration", type: "task" },
      ],
      dependencies: [{ workItemId: "c", blockedByWorkItemId: "a" }],
    });

    expect(forecast.waves).toHaveLength(2);
    expect(forecast.bottleneckWave).toBe(1);
    expect(forecast.estimatedConcurrentTasks).toBe(2);
    expect(forecast.estimatedPeakMemoryMb).toBe(4096);
  });

  test("caps peak wave memory to five concurrent subagents", () => {
    const tasks = Array.from({ length: 9 }, (_, index) => ({
      id: `task-${index + 1}`,
      taskId: `A-${index + 1}`,
      title: `Build frontend slice ${index + 1}`,
      type: "task",
    }));

    const forecast = calculateResourceForecast({
      workItemId: "epic-1",
      generatedAt: new Date("2026-01-01T00:00:00.000Z"),
      tasks,
      dependencies: [],
    });

    expect(forecast.waves[0]?.tasks).toHaveLength(9);
    expect(forecast.estimatedConcurrentTasks).toBe(5);
    expect(forecast.estimatedPeakMemoryMb).toBe(8192);
  });
});
