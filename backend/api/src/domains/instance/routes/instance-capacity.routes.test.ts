import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";
import * as capacityServiceActual from "../services/instance-capacity-service";

type CapacityDiagnosticsResponse = {
  success: boolean;
  data: {
    host: {
      ramTotalMb: number;
    };
    recommendation: {
      safeMaxConcurrent: number;
    };
  };
};

const realGetInstanceCapacityDiagnostics =
  capacityServiceActual.getInstanceCapacityDiagnostics;

mock.module("../services/instance-capacity-service", () => ({
  ...capacityServiceActual,
  getInstanceCapacityDiagnostics: async () => ({
    generatedAt: "2026-04-30T00:00:00.000Z",
    host: {
      source: "runner-heartbeat",
      memorySource: "proc-meminfo",
      ramTotalMb: 24576,
      ramUsedMb: 8192,
      ramAvailableMb: 16384,
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
    workers: [],
    workerCounts: {
      total: 0,
      visible: 0,
      online: 0,
      offlineWithOrphanedJobs: 0,
      hiddenOffline: 0,
    },
    orphanedJobs: [],
    warnings: [],
    recommendedEnv:
      "RUNNER_RAM_BUDGET_ENABLED=true\nRUNNER_RAM_RESERVED_MB=4096\nMAX_CONCURRENT=3",
  }),
}));

describe("instanceCapacityRoutes", () => {
  let app: Elysia<any, any, any, any, any, any, any>;

  beforeAll(async () => {
    const { instanceCapacityRoutes } = await import("./instance-capacity.routes");
    app = new Elysia()
      .derive(() => ({ user: { id: "admin-user-id", role: "admin" } }))
      .use(instanceCapacityRoutes) as unknown as typeof app;
  });

  afterAll(() => {
    mock.module("../services/instance-capacity-service", () => ({
      ...capacityServiceActual,
      getInstanceCapacityDiagnostics: realGetInstanceCapacityDiagnostics,
    }));
  });

  it("returns protected capacity diagnostics without caching", async () => {
    const response = await app.handle(
      new Request("http://localhost/instance/capacity"),
    );
    const body = (await response.json()) as CapacityDiagnosticsResponse;

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.success).toBe(true);
    expect(body.data.host.ramTotalMb).toBe(24576);
    expect(body.data.recommendation.safeMaxConcurrent).toBe(4);
  });
});
