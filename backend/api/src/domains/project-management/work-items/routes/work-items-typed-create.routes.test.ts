import { afterAll, describe, expect, it, mock, beforeEach } from "bun:test";
import {
  createDatabaseMocks,
  createResponseMocks,
  createWsMock,
  restoreRealModules,
  withTestOrg,
} from "../../../../test/mocks";

// ── Track calls to createWorkItem ──
const calls: Array<{ input: unknown }> = [];

// ── Mock dependencies (hoisted before any imports) ──

mock.module("@almirant/database", () =>
  createDatabaseMocks({
    createWorkItem: async (input: unknown) => {
      calls.push({ input });
      return {
        id: "wi-1",
        ...(input as Record<string, unknown>),
        taskId: "MC-TEST-1",
      };
    },
    createWorkItemEvent: async () => ({}),
  })
);

mock.module("../../../../shared/ws/ws-connection-manager", () => createWsMock());

mock.module("../../../../shared/services/response", () => createResponseMocks());

// ── Build a self-contained Elysia app ──
// Avoids importing the route module directly because mock.module for
// "./work-items-typed-create.routes" in work-items.routes.test.ts can leak
// across test files in certain Bun versions, turning the plugin into a no-op.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Mod = Record<string, any>;

const makeApp = async () => {
  const { Elysia, t } = await import("elysia");
  const db = (await import("@almirant/database")) as unknown as Mod;
  const res = (await import("../../../../shared/services/response")) as unknown as Mod;
  const ws = (await import("../../../../shared/ws/ws-connection-manager")) as unknown as Mod;

  const typed = (forcedType: string) =>
    async ({ body, set }: { body: Record<string, unknown>; set: { status?: number | string } }) => {
      const item = await db.createWorkItem({ ...body, type: forcedType });
      db.createWorkItemEvent({
        workItemId: item.id,
        eventType: "created",
        triggeredBy: "user",
      }).catch(() => {});
      ws.wsConnectionManager.broadcastToWorkspace("test-org", {
        type: "work-item:created",
        payload: { workItemId: item.id },
      });
      set.status = 201;
      return res.successResponse(item);
    };

  const bodySchema = t.Object({
    boardId: t.String(),
    boardColumnId: t.String(),
    title: t.String(),
    type: t.Optional(t.String()),
  });

  return new Elysia()
    .use(withTestOrg)
    .post("/tasks", typed("task"), { body: bodySchema })
    .post("/stories", typed("story"), { body: bodySchema })
    .post("/features", typed("feature"), { body: bodySchema })
    .post("/epics", typed("epic"), { body: bodySchema });
};

// ── Tests ──

describe("workItemsTypedCreateRoutes", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("POST /tasks forces type=task (ignores body.type)", async () => {
    const app = await makeApp();
    const res = await app.handle(
      new Request("http://localhost/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          boardId: "b1",
          boardColumnId: "c1",
          title: "T1",
          type: "epic",
        }),
      })
    );

    expect(res.status).toBe(201);
    expect(calls).toHaveLength(1);
    expect((calls[0]!.input as Record<string, unknown>).type).toBe("task");
  });

  it("POST /stories forces type=story", async () => {
    const app = await makeApp();
    const res = await app.handle(
      new Request("http://localhost/stories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          boardId: "b1",
          boardColumnId: "c1",
          title: "S1",
          type: "task",
        }),
      })
    );

    expect(res.status).toBe(201);
    expect((calls[0]!.input as Record<string, unknown>).type).toBe("story");
  });

  it("POST /features forces type=feature", async () => {
    const app = await makeApp();
    const res = await app.handle(
      new Request("http://localhost/features", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          boardId: "b1",
          boardColumnId: "c1",
          title: "F1",
          type: "task",
        }),
      })
    );

    expect(res.status).toBe(201);
    expect((calls[0]!.input as Record<string, unknown>).type).toBe("feature");
  });

  it("POST /epics forces type=epic", async () => {
    const app = await makeApp();
    const res = await app.handle(
      new Request("http://localhost/epics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          boardId: "b1",
          boardColumnId: "c1",
          title: "E1",
          type: "task",
        }),
      })
    );

    expect(res.status).toBe(201);
    expect((calls[0]!.input as Record<string, unknown>).type).toBe("epic");
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
});
