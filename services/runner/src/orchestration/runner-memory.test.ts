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
  workspaceId: null,
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

// ---------------------------------------------------------------------------
// A-1946 (ported from enterprise): claim-time effort estimates from
// work_item_effort_estimates drive job memory sizing, with the community
// safety floors (template minimums + browser heavy minimum) still applied.
// ---------------------------------------------------------------------------

describe("resolveJobMemoryRequirement — effort estimates (A-1946)", () => {
  it("prefers the claim-time effort estimate over the config forecast", () => {
    expect(resolveJobMemoryRequirement(createJob({
      promptTemplate: "runner-implement",
      estimatedMemoryMb: 4096,
      estimatedSubagents: 3,
      childCount: 2,
      config: {
        skillName: "runner-implement",
        resourceEstimate: {
          estimatedMemoryMb: 2048,
          source: "forecast",
          confidence: "high",
        },
      },
    }))).toMatchObject({
      memoryMb: 4096,
      label: "runner-implement",
      source: "effort-estimate",
    });
  });

  it("clamps oversized effort estimates to the 8192 MB ceiling", () => {
    expect(resolveJobMemoryRequirement(createJob({
      promptTemplate: "runner-document",
      estimatedMemoryMb: 999_999,
      config: { skillName: "runner-document" },
    }))).toMatchObject({
      memoryMb: 8192,
      source: "effort-estimate",
    });
  });

  it("clamps undersized effort estimates to the 256 MB floor (no template minimum)", () => {
    expect(resolveJobMemoryRequirement(createJob({
      promptTemplate: "runner-document",
      estimatedMemoryMb: 100,
      config: { skillName: "runner-document" },
    }))).toMatchObject({
      memoryMb: 256,
      source: "effort-estimate",
    });
  });

  it("keeps the production safety minimum for runner-implement even when the estimate is lower", () => {
    expect(resolveJobMemoryRequirement(createJob({
      promptTemplate: "runner-implement",
      estimatedMemoryMb: 1024,
      config: { skillName: "runner-implement" },
    }))).toMatchObject({
      memoryMb: 3072,
      label: "runner-implement",
      source: "effort-estimate",
    });
  });

  it("keeps the browser heavy minimum for browser jobs with low estimates", () => {
    expect(resolveJobMemoryRequirement(createJob({
      promptTemplate: "record-video",
      estimatedMemoryMb: 1024,
      config: { skillName: "record-video", needsBrowser: true },
    }))).toMatchObject({
      memoryMb: 3072,
      label: "record-video",
      source: "effort-estimate",
    });
  });

  it("falls back to the childCount heuristic for runner-document parents without an estimate", () => {
    // min(4, 2) * 500 + 1024 = 2024
    expect(resolveJobMemoryRequirement(createJob({
      promptTemplate: "runner-document",
      childCount: 2,
      config: { skillName: "runner-document" },
    }))).toMatchObject({
      memoryMb: 2024,
      label: "runner-document",
      source: "child-heuristic",
    });
  });

  it("caps the childCount heuristic at 4 children", () => {
    // min(4, 9) * 500 + 1024 = 3024
    expect(resolveJobMemoryRequirement(createJob({
      promptTemplate: "runner-document",
      childCount: 9,
      config: { skillName: "runner-document" },
    }))).toMatchObject({
      memoryMb: 3024,
      source: "child-heuristic",
    });
  });

  it("floors the childCount heuristic to the runner-implement safety minimum", () => {
    // min(4, 1) * 500 + 1024 = 1524 → floored to 3072 for runner-implement
    expect(resolveJobMemoryRequirement(createJob({
      promptTemplate: "runner-implement",
      childCount: 1,
      config: { skillName: "runner-implement" },
    }))).toMatchObject({
      memoryMb: 3072,
      label: "runner-implement",
      source: "child-heuristic",
    });
  });

  it("does not apply the childCount heuristic to non-runner templates", () => {
    expect(resolveJobMemoryRequirement(createJob({
      promptTemplate: "fix",
      childCount: 3,
      config: { skillName: "fix" },
    }))).toMatchObject({
      memoryMb: 1536,
      source: "tier",
    });
  });

  it("does not apply the childCount heuristic to leaf items (childCount 0)", () => {
    expect(resolveJobMemoryRequirement(createJob({
      promptTemplate: "runner-document",
      childCount: 0,
      config: { skillName: "runner-document" },
    }))).toMatchObject({
      memoryMb: 1536,
      source: "tier",
    });
  });

  it("prefers the config forecast over the childCount heuristic", () => {
    expect(resolveJobMemoryRequirement(createJob({
      promptTemplate: "runner-document",
      childCount: 3,
      config: {
        skillName: "runner-document",
        resourceEstimate: {
          estimatedMemoryMb: 4096,
          source: "forecast",
          confidence: "high",
        },
      },
    }))).toMatchObject({
      memoryMb: 4096,
      source: "forecast",
    });
  });

  it("ignores non-finite effort estimates", () => {
    expect(resolveJobMemoryRequirement(createJob({
      promptTemplate: "runner-document",
      estimatedMemoryMb: Number.NaN,
      config: { skillName: "runner-document" },
    }))).toMatchObject({
      source: "tier",
    });
  });
});
