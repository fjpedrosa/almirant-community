import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { CapacitySettingsSection } from "./capacity-settings-section";
import type { InstanceCapacityDiagnostics } from "../../domain/types";

mock.module("next-intl", () => ({
  useTranslations: () =>
    (key: string, values?: Record<string, string | number>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
}));

const diagnostics: InstanceCapacityDiagnostics = {
  generatedAt: "2026-04-30T00:00:00.000Z",
  host: {
    source: "runner-heartbeat",
    memorySource: "proc-meminfo",
    ramTotalMb: 24 * 1024,
    ramUsedMb: 8 * 1024,
    ramAvailableMb: 16 * 1024,
    cpuCores: 8,
    observedAt: "2026-04-30T00:00:00.000Z",
  },
  config: {
    ramBudgetEnabled: true,
    reservedMb: 4096,
    maxConcurrent: 3,
    defaultJobMemoryMb: 4096,
    source: "environment",
  },
  recommendation: {
    recommendedReservedMb: 4096,
    recommendedConcurrent: 3,
    safeMaxConcurrent: 4,
    memoryBoundConcurrent: 5,
    cpuBoundConcurrent: 4,
    effectiveRunnerBudgetMb: 20480,
    upgradeHeadroomMb: 16384,
    isConfiguredSafe: true,
  },
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
      workerId: "runner-offline-orphan",
      hostname: "orphaned.local",
      status: "offline",
      activeJobs: 1,
      maxConcurrentAgents: 3,
      availableSlots: 0,
      isDraining: false,
      ramBudgetMb: 20 * 1024,
      ramCommittedMb: 4096,
      ramAvailableMb: 12 * 1024,
      lastHeartbeatAt: "2026-04-29T23:30:00.000Z",
      systemMetrics: null,
    },
  ],
  workerCounts: {
    total: 3,
    visible: 2,
    online: 1,
    offlineWithOrphanedJobs: 1,
    hiddenOffline: 1,
  },
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
  warnings: [],
  recommendedEnv:
    "RUNNER_RAM_BUDGET_ENABLED=true\nRUNNER_RAM_RESERVED_MB=4096\nMAX_CONCURRENT=3",
};

describe("CapacitySettingsSection", () => {
  it("muestra solo runners accionables y permite cancelar jobs huérfanos", () => {
    const cancelJob = mock(() => {});
    const cancelAll = mock(() => {});

    render(
      <CapacitySettingsSection
        diagnostics={diagnostics}
        isLoading={false}
        isError={false}
        onRefresh={() => {}}
        onCancelOrphanedJob={cancelJob}
        onCancelAllOrphanedJobs={cancelAll}
        cancellingOrphanedJobId={null}
        isCancellingAllOrphanedJobs={false}
      />,
    );

    expect(screen.getByText("online.local")).toBeInTheDocument();
    expect(screen.getAllByText("orphaned.local").length).toBeGreaterThan(0);
    expect(screen.getByText("workers.hiddenOffline:{\"count\":1}")).toBeInTheDocument();
    expect(screen.getByText("orphanedJobs.title")).toBeInTheDocument();
    expect(screen.getByText("A-123")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "orphanedJobs.cancel" }));
    expect(cancelJob).toHaveBeenCalledWith("job-orphaned");

    fireEvent.click(screen.getByRole("button", { name: "orphanedJobs.cancelAll" }));
    expect(cancelAll).toHaveBeenCalled();
  });
});
