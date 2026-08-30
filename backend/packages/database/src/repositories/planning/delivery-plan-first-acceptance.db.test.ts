import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { closeConnections } from "../../client";
import * as schema from "../../schema";
import {
  acceptFirstDeliveryPlan,
  type DeliveryPlanAcceptanceWriteGroup,
} from "./delivery-plan-repository";

const url = process.env.DELIVERY_LIFECYCLE_TEST_DATABASE_URL?.trim();
const parsed = url ? new URL(url) : null;
const safe = parsed && ["localhost", "127.0.0.1"].includes(parsed.hostname) && parsed.pathname.slice(1).startsWith("almirant_delivery_lifecycle_test");
if (url && !safe) throw new Error("DELIVERY_LIFECYCLE_TEST_DATABASE_URL must target a dedicated local test database");
const d = safe ? describe : describe.skip;
const id = (n: number) => `25900000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { workspaceId: "first-plan-test", projectId: id(1), boardId: id(2), userId: "first-plan-user" };
const plan = {
  version: 1 as const, kind: "plan" as const, title: "Atomic plan",
  target: { projectId: scope.projectId, boardId: scope.boardId },
  features: [{ kind: "feature" as const, tempId: "feature-a", title: "Feature A", workUnits: [
    { kind: "work_unit" as const, tempId: "wu-b", title: "Featured WU", priority: "high" as const, work_unit_size: "M" as const, acceptance: ["Works"], dependencies: ["wu-a"] },
  ] }],
  workUnits: [{ kind: "work_unit" as const, tempId: "wu-a", title: "Direct WU", priority: "medium" as const, work_unit_size: "S" as const, acceptance: ["Ready"], dependencies: [] }],
};

 d("first delivery Plan acceptance (dedicated PostgreSQL 17)", () => {
  const sql = postgres(url!, { max: 8 });
  const database = drizzle(sql, { schema });
  const accept = (requestKey: string, value: unknown = plan, failAfter?: DeliveryPlanAcceptanceWriteGroup) =>
    acceptFirstDeliveryPlan({ ...scope, requestKey, plan: value }, {
      database,
      ...(failAfter ? { failAfter: (group: DeliveryPlanAcceptanceWriteGroup) => { if (group === failAfter) throw new Error(`injected_${group}`); } } : {}),
    });

  beforeEach(async () => {
    await sql`DELETE FROM projects WHERE id = ${scope.projectId}`;
    await sql`DELETE FROM workspace WHERE id = ${scope.workspaceId}`;
    await sql`DELETE FROM "user" WHERE id = ${scope.userId}`;
    await sql`INSERT INTO "user" (id, name, email) VALUES (${scope.userId}, 'Plan User', 'first-plan@example.test')`;
    await sql`INSERT INTO workspace (id, name, slug) VALUES (${scope.workspaceId}, 'First Plan', 'first-plan-test')`;
    await sql`INSERT INTO member (id, workspace_id, user_id, role) VALUES ('first-plan-member', ${scope.workspaceId}, ${scope.userId}, 'owner')`;
    await sql`INSERT INTO projects (id, name, workspace_id) VALUES (${scope.projectId}, 'Project', ${scope.workspaceId})`;
    await sql`INSERT INTO boards (id, workspace_id, name, area) VALUES (${scope.boardId}, ${scope.workspaceId}, 'Development', 'desarrollo')`;
    await sql`INSERT INTO board_columns (id, board_id, name, role) VALUES (${id(3)}, ${scope.boardId}, 'Backlog', 'backlog')`;
  });
  afterAll(async () => {
    await sql`DELETE FROM projects WHERE id = ${scope.projectId}`;
    await sql`DELETE FROM workspace WHERE id = ${scope.workspaceId}`;
    await sql`DELETE FROM "user" WHERE id = ${scope.userId}`;
    await sql.end({ timeout: 5 });
    await closeConnections();
  });

  test("atomically projects only Work Units and replays the stored response", async () => {
    const first = await accept("request-a");
    expect(first).toMatchObject({ revisionNumber: 1, contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/), responseSha256: expect.stringMatching(/^[a-f0-9]{64}$/), replayed: false });
    const items = await sql<Array<{ kind: string; work_item_id: string | null; parent_feature_item_id: string | null }>>`
      SELECT i.kind, i.work_item_id, ri.parent_feature_item_id FROM delivery_plan_items i
      JOIN delivery_plan_revision_items ri ON ri.item_id = i.id WHERE i.plan_id = ${first.planId} ORDER BY i.stable_key`;
    expect(items.map(({ kind, work_item_id }) => [kind, work_item_id === null])).toEqual([["feature", true], ["work_unit", false], ["work_unit", false]]);
    expect(items.filter(({ kind }) => kind === "work_unit").map(({ parent_feature_item_id }) => parent_feature_item_id === null).sort()).toEqual([false, true]);
    const projections = await sql<Array<{ type: string; parent_id: string | null; board_column_id: string; work_unit_size_origin: string; backlog_intent: string }>>`
      SELECT type, parent_id, board_column_id, work_unit_size_origin, backlog_intent FROM work_items WHERE board_id = ${scope.boardId} ORDER BY title`;
    expect([...projections]).toEqual([
      { type: "task", parent_id: null, board_column_id: id(3), work_unit_size_origin: "plan", backlog_intent: "new" },
      { type: "task", parent_id: null, board_column_id: id(3), work_unit_size_origin: "plan", backlog_intent: "new" },
    ]);
    expect(await sql`SELECT 1 FROM delivery_plan_revision_dependencies`).toHaveLength(1);
    expect(await sql`SELECT 1 FROM work_item_dependencies`).toHaveLength(1);
    expect(await sql`SELECT 1 FROM work_item_events WHERE event_type = 'created'`).toHaveLength(2);
    const replay = await accept("request-a");
    expect(replay).toEqual({ ...first, replayed: true });
    expect(await sql`SELECT 1 FROM delivery_plans`).toHaveLength(1);
    await expect(accept("request-a", { ...plan, title: "Changed" })).rejects.toMatchObject({ code: "acceptance_idempotency_conflict" });
  });

  test("serializes concurrent first acceptance without duplicate authority", async () => {
    const results = await Promise.all([accept("request-race"), accept("request-race")]);
    expect(results.map(({ planId }) => planId)).toEqual([results[0]!.planId, results[0]!.planId]);
    expect(results.map(({ replayed }) => replayed).sort()).toEqual([false, true]);
    expect(await sql`SELECT 1 FROM delivery_plans`).toHaveLength(1);
    expect(await sql`SELECT 1 FROM work_items WHERE board_id = ${scope.boardId}`).toHaveLength(2);
  });

  test("locks stable Work Unit identities in sorted order before projecting state", async () => {
    const blocker = postgres(url!, { max: 1 });
    let unlock!: () => void; let announce!: () => void;
    const released = new Promise<void>((resolve) => { unlock = resolve; });
    const locked = new Promise<void>((resolve) => { announce = resolve; });
    const blockerTx = blocker.begin(async (tx) => { await tx.unsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [JSON.stringify([scope.workspaceId, "ordered-locks", "wu-b"])]); announce(); await released; });
    await locked;
    const pending = accept("ordered-locks");
    try {
      let waitingPid: number | undefined;
      for (let attempt = 0; attempt < 100 && waitingPid === undefined; attempt += 1) {
        const [waiting] = await sql<Array<{ pid: number }>>`SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`;
        waitingPid = waiting?.pid; if (waitingPid === undefined) await Bun.sleep(10);
      }
      const locks = waitingPid === undefined ? [] : await sql<Array<{ granted: boolean }>>`SELECT granted FROM pg_locks WHERE pid = ${waitingPid} AND locktype = 'advisory'`;
      expect(locks.filter(({ granted }) => granted)).toHaveLength(2);
      expect(locks.filter(({ granted }) => !granted)).toHaveLength(1);
      expect(await sql`SELECT 1 FROM delivery_plans`).toHaveLength(0);
    } finally { unlock(); await blockerTx; await pending; await blocker.end({ timeout: 5 }); }
    expect(await sql`SELECT 1 FROM delivery_plans`).toHaveLength(1);
  });

  test("conflicts a concurrent mismatched digest and replays through a fresh connection", async () => {
    const competingPlan = { ...plan, title: "Competing plan" };
    const outcomes = await Promise.allSettled([
      accept("request-digest-race"),
      accept("request-digest-race", competingPlan),
    ]);
    expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === "rejected").map((result) => (result as PromiseRejectedResult).reason.code)).toEqual(["acceptance_idempotency_conflict"]);
    const freshSql = postgres(url!, { max: 1 });
    try {
      const winner = (outcomes.find(({ status }) => status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof accept>>>).value;
      const [stored] = await freshSql<Array<{ content_json: { title: string } }>>`SELECT content_json FROM delivery_plan_revisions WHERE id = ${winner.revisionId}`;
      const winningPlan = stored!.content_json.title === plan.title ? plan : competingPlan;
      const replay = await acceptFirstDeliveryPlan({ ...scope, requestKey: "request-digest-race", plan: winningPlan }, { database: drizzle(freshSql, { schema }) });
      expect(replay).toEqual({ ...winner, replayed: true });
      const updateError = await freshSql`UPDATE delivery_plan_acceptance_receipts SET response_sha256 = 'bad'`.then(() => null, (error) => error);
      expect(updateError).toMatchObject({ code: "23514" });
    } finally { await freshSql.end({ timeout: 5 }); }
  }, 30_000);

  test("honors Community member permission and denies viewer replay", async () => {
    await sql`UPDATE member SET role = 'member' WHERE workspace_id = ${scope.workspaceId}`;
    const first = await accept("member-role");
    await sql`UPDATE member SET role = 'viewer' WHERE workspace_id = ${scope.workspaceId}`;
    await expect(accept("member-role")).rejects.toMatchObject({ code: "acceptance_unauthorized" });
    expect([...(await sql`SELECT revision_id FROM delivery_plan_acceptance_receipts`)]).toEqual([{ revision_id: first.revisionId }]);
  });

  test("derives live membership authorization before readiness and exact replay", async () => {
    const first = await accept("authorized-replay");
    await sql`DELETE FROM member WHERE workspace_id = ${scope.workspaceId}`;
    await sql`INSERT INTO board_columns (id, board_id, name, role) VALUES (${id(4)}, ${scope.boardId}, 'Backlog', 'backlog')`;
    await expect(accept("unauthorized-new")).rejects.toMatchObject({ code: "acceptance_unauthorized" });
    await expect(accept("authorized-replay")).rejects.toMatchObject({ code: "acceptance_unauthorized" });
    expect([...(await sql`SELECT id FROM delivery_plans`)]).toEqual([{ id: first.planId }]);
    expect(await sql`SELECT 1 FROM delivery_plan_acceptance_receipts`).toHaveLength(1);
  });

  test("database rejects a receipt revision belonging to another Plan", async () => {
    const first = await accept("receipt-plan-a"); const second = await accept("receipt-plan-b");
    const error = await sql`UPDATE delivery_plan_acceptance_receipts SET revision_id = ${second.revisionId} WHERE plan_id = ${first.planId}`.then(() => null, (reason) => reason);
    expect(error).toMatchObject({ code: "23503" });
  });

  test("fails closed on scope, invalid graphs, and Backlog readiness", async () => {
    await expect(accept("empty", { ...plan, features: [], workUnits: [] })).rejects.toMatchObject({ code: "acceptance_invalid_plan" });
    await expect(accept("scope", { ...plan, target: { ...plan.target, boardId: id(99) } })).rejects.toMatchObject({ code: "acceptance_scope_mismatch" });
    const cyclic = { ...plan, workUnits: [{ ...plan.workUnits[0]!, dependencies: ["wu-b"] }] };
    await expect(accept("cycle", cyclic)).rejects.toMatchObject({ code: "acceptance_invalid_plan" });
    await sql`DELETE FROM board_columns WHERE board_id = ${scope.boardId}`;
    await expect(accept("missing-backlog")).rejects.toMatchObject({ code: "canonical_backlog_required" });
    await sql`INSERT INTO board_columns (id, board_id, name, role) VALUES (${id(3)}, ${scope.boardId}, 'Backlog', 'backlog'), (${id(4)}, ${scope.boardId}, 'Backlog', 'backlog')`;
    await expect(accept("duplicate-backlog")).rejects.toMatchObject({ code: "canonical_backlog_required" });
    expect(await sql`SELECT 1 FROM delivery_plans`).toHaveLength(0);
  });

  test("rolls back every write group and permits a clean retry", async () => {
    const groups: DeliveryPlanAcceptanceWriteGroup[] = ["plan", "work_units", "items", "dependencies", "receipt", "cas"];
    for (const group of groups) {
      await expect(accept(`rollback-${group}`, plan, group)).rejects.toThrow(`injected_${group}`);
      expect(await sql`SELECT 1 FROM delivery_plans`).toHaveLength(0);
      expect(await sql`SELECT 1 FROM work_items WHERE board_id = ${scope.boardId}`).toHaveLength(0);
    }
    await expect(accept("rollback-cas")).resolves.toMatchObject({ revisionNumber: 1, replayed: false });
  });
});
