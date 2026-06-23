import { describe, expect, it } from "bun:test";
import type { ClaimedJob } from "@almirant/remote-agent";
import {
  calculateRamBoundAvailableSlots,
  calculateRunnerMemorySnapshot,
  normalizeReservedMemoryMb,
  parseMemAvailableMb,
  resolveJobMemoryRequirement,
} from "./runner-memory";

const createJob = (
  overrides: Partial<ClaimedJob> = {},
): ClaimedJob => ({
  id: "job-1",
  workItemId: null,
  projectId: null,
  boardId: null,
  createdByUserId: null,
  organizationId: null,
  provider: "zipu",
  priority: "medium",
  status: "queued",
  retryCount: 0,
  maxRetries: 0,
  availableAt: null,
  config: { skillName: "runner-implement" },
  ...overrides,
});

describe("runner memory capacity", () => {
  it("parses Linux MemAvailable from /proc/meminfo", () => {
    expect(parseMemAvailableMb([
      "MemTotal:       10157700 kB",
      "MemFree:         1446012 kB",
      "MemAvailable:    6814464 kB",
    ].join("\n"))).toBe(6654);
  });

  it("keeps host reserve and committed forecast out of runner capacity", () => {
    const snapshot = calculateRunnerMemorySnapshot({
      system: { totalMb: 10_000, availableMb: 6_500, source: "proc-meminfo" },
      reservedMb: 2_000,
      committedMb: 3_000,
    });

    expect(snapshot.budgetMb).toBe(8_000);
    expect(snapshot.availableForRunnersMb).toBe(4_500);
    expect(snapshot.pressurePercent).toBe(35);
  });

  it("uses the stricter bound between RAM capacity and MAX_CONCURRENT", () => {
    expect(calculateRamBoundAvailableSlots({
      maxConcurrent: 3,
      activeJobs: 1,
      ramBudgetEnabled: true,
      availableForRunnersMb: 10_000,
      defaultJobMemoryMb: 2_000,
    })).toBe(2);

    expect(calculateRamBoundAvailableSlots({
      maxConcurrent: 8,
      activeJobs: 1,
      ramBudgetEnabled: true,
      availableForRunnersMb: 4_500,
      defaultJobMemoryMb: 2_000,
    })).toBe(2);

    expect(calculateRamBoundAvailableSlots({
      maxConcurrent: 8,
      activeJobs: 1,
      ramBudgetEnabled: false,
      availableForRunnersMb: 0,
      defaultJobMemoryMb: 2_000,
    })).toBe(7);
  });

  it("uses persisted RAM forecast before static tier fallback", () => {
    expect(resolveJobMemoryRequirement(createJob({
      config: {
        skillName: "runner-implement",
        resourceEstimate: {
          estimatedMemoryMb: 5120.2,
          source: "forecast",
          confidence: "low",
        },
      },
    }))).toMatchObject({
      memoryMb: 5121,
      label: "runner-implement",
      source: "forecast",
    });
  });

  it("floors old low-confidence implementation forecasts to the production safety minimum", () => {
    expect(resolveJobMemoryRequirement(createJob({
      promptTemplate: "runner-implement",
      config: {
        skillName: "runner-implement",
        resourceEstimate: {
          estimatedMemoryMb: 1536,
          source: "forecast",
          confidence: "low",
        },
      },
    }))).toMatchObject({
      memoryMb: 3072,
      label: "runner-implement",
      source: "forecast",
    });
  });

  it("floors browser jobs with low forecasts to the heavy browser minimum", () => {
    expect(resolveJobMemoryRequirement(createJob({
      promptTemplate: "record-video",
      interactive: true,
      config: {
        skillName: "record-video",
        needsBrowser: true,
        resourceEstimate: {
          estimatedMemoryMb: 1536,
          source: "forecast",
          confidence: "low",
        },
      },
    }))).toMatchObject({
      memoryMb: 3072,
      label: "record-video",
      source: "forecast",
    });
  });

  it("falls back to resource tier when forecast is absent or invalid", () => {
    expect(resolveJobMemoryRequirement(createJob({
      promptTemplate: "runner-implement",
      config: { skillName: "runner-implement" },
    }))).toMatchObject({
      memoryMb: 1536,
      label: "runner-implement",
      source: "tier",
    });
  });

  it("normalizes invalid reserve to the safe default", () => {
    expect(normalizeReservedMemoryMb(Number.NaN)).toBe(2048);
    expect(normalizeReservedMemoryMb(-1)).toBe(0);
    expect(normalizeReservedMemoryMb(1536.9)).toBe(1536);
  });
});
