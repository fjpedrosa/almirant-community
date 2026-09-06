import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../schema";
import { loadDeliveryAuthorities } from "./delivery-compatibility-repository";
import { acceptFirstDeliveryPlan, acceptRevisedDeliveryPlan } from "./delivery-plan-repository";

const url = process.env.DELIVERY_LIFECYCLE_TEST_DATABASE_URL?.trim(), parsed = url ? new URL(url) : null;
const safe = parsed && ["localhost", "127.0.0.1"].includes(parsed.hostname) && parsed.pathname.slice(1).startsWith("almirant_delivery_lifecycle_test");
if (url && !safe) throw new Error("DELIVERY_LIFECYCLE_TEST_DATABASE_URL must target a dedicated local test database");
const d = safe ? describe : describe.skip, id = (n: number) => `26700000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { workspaceId: "membership-plan-test", projectId: id(1), boardId: id(2), userId: "membership-plan-user" };
const unit = (tempId: string, dependencies: string[] = [], title = tempId) => ({ kind: "work_unit" as const, tempId, title, priority: "medium" as const, work_unit_size: "M" as const, acceptance: [`${title} done`], dependencies });
const makePlan = (title: string, direct: ReturnType<typeof unit>[], featured: ReturnType<typeof unit>[] = []) => ({ version: 1 as const, kind: "plan" as const, title, target: { projectId: scope.projectId, boardId: scope.boardId }, features: featured.length ? [{ kind: "feature" as const, tempId: "feature", title: "Feature", workUnits: featured }] : [], workUnits: direct });

d("membership-changing delivery Plan revisions (dedicated PostgreSQL 17)", () => {
  const sql = postgres(url!, { max: 8 }), database = drizzle(sql, { schema });
  const first = () => acceptFirstDeliveryPlan({ ...scope, requestKey: "first", plan: makePlan("first", [unit("a"), unit("b", ["a"])]) }, { database });
  const revise = (planId: string, key: string, revision: number, plan: unknown) => acceptRevisedDeliveryPlan({ workspaceId: scope.workspaceId, userId: scope.userId, planId, requestKey: key, expectedCurrentRevisionNumber: revision, plan }, { database });
  beforeEach(async () => {
    await sql`DELETE FROM agent_jobs WHERE work_item_id IN (SELECT work_item_id FROM delivery_plan_items WHERE plan_id IN (SELECT id FROM delivery_plans WHERE workspace_id=${scope.workspaceId}))`;
    await sql`DELETE FROM projects WHERE id=${scope.projectId}`; await sql`DELETE FROM workspace WHERE id=${scope.workspaceId}`; await sql`DELETE FROM "user" WHERE id=${scope.userId}`;
    await sql`INSERT INTO "user" (id,name,email) VALUES (${scope.userId},'Membership User','membership@example.test')`; await sql`INSERT INTO workspace (id,name,slug) VALUES (${scope.workspaceId},'Membership','membership-plan-test')`; await sql`INSERT INTO member (id,workspace_id,user_id,role) VALUES ('membership-member',${scope.workspaceId},${scope.userId},'owner')`;
    await sql`INSERT INTO projects (id,name,workspace_id) VALUES (${scope.projectId},'Project',${scope.workspaceId})`; await sql`INSERT INTO boards (id,workspace_id,name,area) VALUES (${scope.boardId},${scope.workspaceId},'Development','desarrollo')`; await sql`INSERT INTO board_columns (id,board_id,name,role) VALUES (${id(3)},${scope.boardId},'Backlog','backlog')`;
  });
  afterAll(async () => { await sql`DELETE FROM projects WHERE id=${scope.projectId}`; await sql`DELETE FROM workspace WHERE id=${scope.workspaceId}`; await sql`DELETE FROM "user" WHERE id=${scope.userId}`; await sql.end({ timeout: 5 }); });

  test("adds, archives, preserves blocked retirement, and restores stable identity with dependency churn", async () => {
    const initial = await first();
    const addedPlan = makePlan("added", [unit("a"), unit("b", ["a"]), unit("c", ["b"])]);
    const added = await revise(initial.planId, "add", 1, addedPlan); expect(added).toMatchObject({ revisionNumber: 2, outcome: "created" });
    const [stable] = await sql<Array<{ item_id: string; work_item_id: string; board_column_id: string }>>`SELECT i.id AS item_id,i.work_item_id,w.board_column_id FROM delivery_plan_items i JOIN work_items w ON w.id=i.work_item_id WHERE i.plan_id=${initial.planId} AND i.stable_key='b'`;
    expect(stable).toMatchObject({ board_column_id: id(3) });
    expect([...(await sql`SELECT type,parent_id,work_unit_size_origin,backlog_intent,archived_at FROM work_items WHERE id IN (SELECT work_item_id FROM delivery_plan_items WHERE plan_id=${initial.planId} AND stable_key='c')`)]).toEqual([{ type: "task", parent_id: null, work_unit_size_origin: "plan", backlog_intent: "new", archived_at: null }]);

    const removedPlan = makePlan("removed", [unit("a"), unit("c", ["a"])]);
    const removed = await revise(initial.planId, "remove", 2, removedPlan); expect(removed.revisionNumber).toBe(3);
    const [archived] = await sql<Array<{ archived_at: string; board_column_id: string }>>`SELECT to_char(archived_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS archived_at,board_column_id FROM work_items WHERE id=${stable!.work_item_id}`;
    expect(archived).toMatchObject({ board_column_id: id(3), archived_at: expect.any(String) });
    const archivedAtIso = archived!.archived_at;
    expect((await loadDeliveryAuthorities([stable!.work_item_id], scope, database))[stable!.work_item_id]).toMatchObject({ kind: "native_retired", itemId: stable!.item_id });
    const before = [...(await sql`SELECT title,archived_at,updated_at FROM work_items WHERE id=${stable!.work_item_id}`)];
    await sql`INSERT INTO agent_jobs (id,work_item_id,status,provider,config) VALUES (${id(10)},${stable!.work_item_id},'completed','claude-code','{}')`;
    await expect(revise(initial.planId, "retired-untouched", 3, { ...removedPlan, title: "retired untouched" })).resolves.toMatchObject({ revisionNumber: 4 });
    expect([...(await sql`SELECT title,archived_at,updated_at FROM work_items WHERE id=${stable!.work_item_id}`)]).toEqual(before);

    const restoredPlan = makePlan("restored", [unit("a"), unit("c", ["a"])], [unit("b", ["c"], "B restored")]);
    await expect(revise(initial.planId, "blocked-restore", 4, restoredPlan)).rejects.toMatchObject({ code: "acceptance_projection_blocked" });
    await sql`DELETE FROM agent_jobs WHERE id=${id(10)}`;
    const restored = await revise(initial.planId, "restore", 4, restoredPlan); expect(restored.revisionNumber).toBe(5);
    expect([...(await sql`SELECT i.id AS item_id,i.work_item_id,w.title,w.archived_at FROM delivery_plan_items i JOIN work_items w ON w.id=i.work_item_id WHERE i.plan_id=${initial.planId} AND i.stable_key='b'`)]).toEqual([{ item_id: stable!.item_id, work_item_id: stable!.work_item_id, title: "B restored", archived_at: null }]);
    expect((await loadDeliveryAuthorities([stable!.work_item_id], scope, database))[stable!.work_item_id]).toMatchObject({ kind: "native_work_unit", itemId: stable!.item_id, currentRevisionId: restored.revisionId });
    expect([...(await sql`SELECT source.stable_key AS source,blocker.stable_key AS blocker FROM work_item_dependencies d JOIN delivery_plan_items source ON source.work_item_id=d.work_item_id JOIN delivery_plan_items blocker ON blocker.work_item_id=d.blocked_by_work_item_id WHERE source.plan_id=${initial.planId} ORDER BY source.stable_key`)]).toEqual([{ source: "b", blocker: "c" }, { source: "c", blocker: "a" }]);
    const events = await sql`SELECT event_type,field_name,old_value,new_value,metadata->>'deliveryPlanId' AS plan_id FROM work_item_events WHERE work_item_id=${stable!.work_item_id} AND field_name='archivedAt' ORDER BY created_at`;
    expect([...events]).toEqual([{ event_type: "updated", field_name: "archivedAt", old_value: null, new_value: archivedAtIso, plan_id: initial.planId }, { event_type: "updated", field_name: "archivedAt", old_value: archivedAtIso, new_value: null, plan_id: initial.planId }]);
    expect(await sql`SELECT 1 FROM delivery_plan_revision_items WHERE item_id=${stable!.item_id}`).toHaveLength(3);
  });
});
