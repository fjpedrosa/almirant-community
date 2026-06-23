import { describe, expect, it } from "bun:test";
import {
  buildCapacityDiagnostics,
  recommendConcurrentAgents,
  recommendReservedMemoryMb,
  type InstanceCapacityConfigSnapshot,
  type InstanceCapacityHostSnapshot,
} from "./instance-capacity-service";

const baseHost: InstanceCapacityHostSnapshot = {
  source: "runner-heartbeat",
  memorySource: "proc-meminfo",
  ramTotalMb: 24 * 1024,
  ramUsedMb: 8 * 1024,
  ramAvailableMb: 16 * 1024,
  cpuCores: 8,
  observedAt: "2026-04-30T00:00:00.000Z",
};

const baseConfig: InstanceCapacityConfigSnapshot = {
  ramBudgetEnabled: true,
  reservedMb: 4096,
  maxConcurrent: 3,
  defaultJobMemoryMb: 4096,
  source: "environment",
};

describe("instance capacity diagnostics", () => {
  it("recommends the large profile for a 24GB / 8 vCPU host", () => {
    expect(recommendReservedMemoryMb(24 * 1024)).toBe(4096);
    expect(recommendConcurrentAgents({ totalMb: 24 * 1024, cpuCores: 8 })).toBe(3);

    const diagnostics = buildCapacityDiagnostics({
      now: new Date("2026-04-30T00:00:00.000Z"),
      host: baseHost,
      config: baseConfig,
      workers: [
        {
          workerId: "runner-1",
          hostname: "runner.local",
          status: "online",
          activeJobs: 1,
          maxConcurrentAgents: 3,
          availableSlots: 2,
          isDraining: false,
          ramBudgetMb: 20 * 1024,
          ramCommittedMb: 4096,
          ramAvailableMb: 12 * 1024,
          lastHeartbeatAt: "2026-04-30T00:00:00.000Z",
          systemMetrics: null,
        },
      ],
    });

    expect(diagnostics.recommendation.recommendedReservedMb).toBe(4096);
    expect(diagnostics.recommendation.recommendedConcurrent).toBe(3);
    expect(diagnostics.recommendation.safeMaxConcurrent).toBe(4);
    expect(diagnostics.recommendation.isConfiguredSafe).toBe(true);
    expect(diagnostics.warnings).toHaveLength(0);
  });

  it("emits critical warnings when configured concurrency exceeds the safe maximum", () => {
    const diagnostics = buildCapacityDiagnostics({
      now: new Date("2026-04-30T00:00:00.000Z"),
      host: baseHost,
      config: {
        ...baseConfig,
        maxConcurrent: 8,
      },
      workers: [
        {
          workerId: "runner-1",
          hostname: "runner.local",
          status: "online",
          activeJobs: 0,
          maxConcurrentAgents: 8,
          availableSlots: 8,
          isDraining: false,
          ramBudgetMb: 20 * 1024,
          ramCommittedMb: 0,
          ramAvailableMb: 20 * 1024,
          lastHeartbeatAt: "2026-04-30T00:00:00.000Z",
          systemMetrics: null,
        },
      ],
    });

    expect(diagnostics.recommendation.safeMaxConcurrent).toBe(4);
    expect(diagnostics.recommendation.isConfiguredSafe).toBe(false);
    expect(diagnostics.warnings).toContainEqual(
      expect.objectContaining({
        code: "configured_concurrency_above_safe_max",
        severity: "critical",
      }),
    );
  });

  it("warns when diagnostics fall back to backend host data without runner heartbeat", () => {
    const diagnostics = buildCapacityDiagnostics({
      now: new Date("2026-04-30T00:00:00.000Z"),
      host: {
        ...baseHost,
        source: "backend-os",
        memorySource: "os",
      },
      config: baseConfig,
      workers: [],
    });

    expect(diagnostics.host.source).toBe("backend-os");
    expect(diagnostics.warnings).toContainEqual(
      expect.objectContaining({
        code: "no_runner_heartbeat",
        severity: "warning",
      }),
    );
  });

  it("hides historical offline runners unless they still own orphaned active jobs", () => {
    const diagnostics = buildCapacityDiagnostics({
      now: new Date("2026-04-30T00:00:00.000Z"),
      host: baseHost,
      config: baseConfig,
      workers: [
        {
          workerId: "runner-online",
          hostname: "online.local",
          status: "online",
          activeJobs: 1,
          maxConcurrentAgents: 3,
          availableSlots: 2,
          isDraining: false,
          ramBudgetMb: 20 * 1024,
          ramCommittedMb: 4096,
          ramAvailableMb: 12 * 1024,
          lastHeartbeatAt: "2026-04-30T00:00:00.000Z",
          systemMetrics: null,
        },
        {
          workerId: "runner-offline-history",
          hostname: "old-deploy.local",
          status: "offline",
          activeJobs: 2,
          maxConcurrentAgents: 3,
          availableSlots: 0,
          isDraining: false,
          ramBudgetMb: 20 * 1024,
          ramCommittedMb: 8192,
          ramAvailableMb: 8 * 1024,
          lastHeartbeatAt: "2026-04-29T23:00:00.000Z",
          systemMetrics: null,
        },
        {
          workerId: "runner-offline-orphan",
          hostname: "orphaned.local",
          status: "offline",
          activeJobs: 0,
          maxConcurrentAgents: 3,
          availableSlots: 0,
          isDraining: false,
          ramBudgetMb: 20 * 1024,
          ramCommittedMb: 0,
          ramAvailableMb: 20 * 1024,
          lastHeartbeatAt: "2026-04-29T23:30:00.000Z",
          systemMetrics: null,
        },
      ],
      orphanedJobs: [
        {
          id: "job-orphaned",
          status: "running",
          jobType: "implementation",
          skillName: "runner-implement",
          promptTemplate: "runner-implement",
          workerId: "runner-offline-orphan",
          workerHostname: "orphaned.local",
          workItemId: "work-item-1",
          workItemTaskId: "A-123",
          workItemTitle: "Implement recovery",
          createdAt: "2026-04-29T23:25:00.000Z",
          startedAt: "2026-04-29T23:26:00.000Z",
        },
      ],
    });

    expect(diagnostics.workers.map((worker) => worker.workerId)).toEqual([
      "runner-online",
      "runner-offline-orphan",
    ]);
    expect(diagnostics.workers.find((worker) => worker.workerId === "runner-offline-orphan")?.activeJobs).toBe(1);
    expect(diagnostics.orphanedJobs).toHaveLength(1);
    expect(diagnostics.workerCounts).toEqual({
      total: 3,
      visible: 2,
      online: 1,
      offlineWithOrphanedJobs: 1,
      hiddenOffline: 1,
    });
  });
});
