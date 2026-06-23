import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";
import {
  createDatabaseMocks,
  createLoggerMock,
  createResponseMocks,
  restoreRealModules,
  withTestOrg,
} from "../../../test/mocks";

const originalFetch = globalThis.fetch;
const configMock = createLoggerMock() as ReturnType<typeof createLoggerMock> & {
  env: Record<string, unknown>;
};
configMock.env.SCALER_METRICS_URL = "http://scaler.internal/metrics";

const state = {
  lifecycleEvents: [] as Array<{
    id: string;
    workerName: string;
    eventType: "started" | "stopped" | "draining_started" | "draining_stopped";
    ip: string | null;
    metadata: Record<string, unknown>;
    createdAt: Date;
  }>,
};

mock.module("@almirant/config", () => configMock);
mock.module("@almirant/database", () =>
  createDatabaseMocks({
    getLifecycleEventsInRange: async () => state.lifecycleEvents,
  }),
);
mock.module("../../../shared/services/response", () => createResponseMocks());

const makeApp = async (withOrgContext = false) => {
  const { workersDashboardRoutes } = await import("./workers-dashboard.routes");
  const app = new Elysia();
  if (withOrgContext) app.use(withTestOrg);
  return app.use(workersDashboardRoutes);
};

describe("workersDashboardRoutes GET /workers/scaler-metrics", () => {
  beforeEach(() => {
    configMock.env.SCALER_METRICS_URL = "http://scaler.internal/metrics";
    state.lifecycleEvents = [];
  });

  it("parses labeled shared metrics and enriches the response with shared status metadata", async () => {
    const startedAtSeconds = Math.floor(Date.now() / 1000) - 180;

    globalThis.fetch = mock(async (input: string | URL | Request) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

      if (url === "http://scaler.internal/metrics") {
        return new Response(
          [
            'almirant_scaler_queue_depth{coding_agent="shared"} 3',
            'almirant_scaler_runners_total{coding_agent="shared"} 2',
            'almirant_scaler_runners_target{coding_agent="shared"} 4',
            `process_start_time_seconds ${startedAtSeconds}`,
          ].join("\n"),
          { status: 200 },
        );
      }

      if (url === "http://scaler.internal/status") {
        return Response.json({
          ok: true,
          config: {
            infrastructureMode: "shared",
            queueAggregation: "shared-runners",
            minAvailableSlots: 2,
            maxConcurrentPerRunner: 3,
          },
        });
      }

      return new Response("NOT_FOUND", { status: 404 });
    }) as unknown as typeof fetch;

    const app = await makeApp();
    const res = await app.handle(
      new Request("http://localhost/workers/scaler-metrics"),
    );

    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      success: boolean;
      data: {
        available: boolean;
        queueDepth: number | null;
        activeRunners: number | null;
        targetRunners: number | null;
        infrastructureMode: string | null;
        queueAggregation: string | null;
        minAvailableSlots: number | null;
        maxConcurrentPerRunner: number | null;
        uptimeSeconds: number | null;
      };
    };

    expect(body.success).toBe(true);
    expect(body.data.available).toBe(true);
    expect(body.data.queueDepth).toBe(3);
    expect(body.data.activeRunners).toBe(2);
    expect(body.data.targetRunners).toBe(4);
    expect(body.data.infrastructureMode).toBe("shared");
    expect(body.data.queueAggregation).toBe("shared-runners");
    expect(body.data.minAvailableSlots).toBe(2);
    expect(body.data.maxConcurrentPerRunner).toBe(3);
    expect(body.data.uptimeSeconds).not.toBeNull();
    expect(body.data.uptimeSeconds).toBeGreaterThanOrEqual(180);
  });

  it("falls back to aggregating all metric series when a shared label is not present", async () => {
    globalThis.fetch = mock(async (input: string | URL | Request) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

      if (url === "http://scaler.internal/metrics") {
        return new Response(
          [
            'almirant_scaler_queue_depth{coding_agent="claude-code"} 1',
            'almirant_scaler_queue_depth{coding_agent="codex"} 2',
            'almirant_scaler_runners_total{coding_agent="claude-code"} 1',
            'almirant_scaler_runners_total{coding_agent="codex"} 1',
            'almirant_scaler_runners_target{coding_agent="claude-code"} 2',
            'almirant_scaler_runners_target{coding_agent="codex"} 1',
          ].join("\n"),
          { status: 200 },
        );
      }

      if (url === "http://scaler.internal/status") {
        return new Response("NOT_FOUND", { status: 404 });
      }

      return new Response("NOT_FOUND", { status: 404 });
    }) as unknown as typeof fetch;

    const app = await makeApp();
    const res = await app.handle(
      new Request("http://localhost/workers/scaler-metrics"),
    );

    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      success: boolean;
      data: {
        available: boolean;
        queueDepth: number | null;
        activeRunners: number | null;
        targetRunners: number | null;
        infrastructureMode: string | null;
      };
    };

    expect(body.success).toBe(true);
    expect(body.data.available).toBe(true);
    expect(body.data.queueDepth).toBe(3);
    expect(body.data.activeRunners).toBe(2);
    expect(body.data.targetRunners).toBe(3);
    expect(body.data.infrastructureMode).toBeNull();
  });
});

describe("workersDashboardRoutes GET /workers/offline-timeline", () => {
  beforeEach(() => {
    state.lifecycleEvents = [];
  });

  it("classifies planned scale-downs separately from unexpected incidents", async () => {
    const now = Date.now();
    state.lifecycleEvents = [
      {
        id: "evt-1",
        workerName: "runner-shared-a",
        eventType: "draining_started",
        ip: "10.0.0.1",
        metadata: { reason: "heartbeat_transition" },
        createdAt: new Date(now - 5 * 60 * 60 * 1000),
      },
      {
        id: "evt-2",
        workerName: "runner-shared-a",
        eventType: "stopped",
        ip: "10.0.0.1",
        metadata: { reason: "scale_down" },
        createdAt: new Date(now - 4.5 * 60 * 60 * 1000),
      },
      {
        id: "evt-3",
        workerName: "runner-shared-a",
        eventType: "started",
        ip: "10.0.0.1",
        metadata: {},
        createdAt: new Date(now - 4 * 60 * 60 * 1000),
      },
      {
        id: "evt-4",
        workerName: "runner-shared-b",
        eventType: "stopped",
        ip: "10.0.0.2",
        metadata: { reason: "heartbeat_timeout" },
        createdAt: new Date(now - 3 * 60 * 60 * 1000),
      },
      {
        id: "evt-5",
        workerName: "runner-shared-b",
        eventType: "started",
        ip: "10.0.0.2",
        metadata: {},
        createdAt: new Date(now - 2 * 60 * 60 * 1000),
      },
    ];

    const app = await makeApp(true);
    const res = await app.handle(
      new Request("http://localhost/workers/offline-timeline?range=24h"),
    );

    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      success: boolean;
      data: {
        workers: Array<{
          workerName: string;
          plannedOfflineMs: number;
          incidentOfflineMs: number;
          offlineZones: Array<{
            classification: "planned" | "incident" | "unknown";
            reason: string | null;
          }>;
        }>;
      };
    };

    expect(body.success).toBe(true);

    expect(body.data.workers[0]?.workerName).toBe("runner-shared-b");

    const plannedWorker = body.data.workers.find(
      (worker) => worker.workerName === "runner-shared-a",
    );
    const incidentWorker = body.data.workers.find(
      (worker) => worker.workerName === "runner-shared-b",
    );

    expect(plannedWorker).toBeDefined();
    expect(plannedWorker!.plannedOfflineMs).toBeGreaterThan(0);
    expect(plannedWorker!.incidentOfflineMs).toBe(0);
    expect(plannedWorker!.offlineZones[0]?.classification).toBe("planned");
    expect(plannedWorker!.offlineZones[0]?.reason).toBe("scale_down");

    expect(incidentWorker).toBeDefined();
    expect(incidentWorker!.plannedOfflineMs).toBe(0);
    expect(incidentWorker!.incidentOfflineMs).toBeGreaterThan(0);
    expect(incidentWorker!.offlineZones[0]?.classification).toBe("incident");
    expect(incidentWorker!.offlineZones[0]?.reason).toBe("heartbeat_timeout");
  });
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  mock.restore();
  restoreRealModules();
});
