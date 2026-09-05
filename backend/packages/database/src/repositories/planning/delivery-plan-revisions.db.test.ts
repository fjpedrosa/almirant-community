import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../schema";
import { acceptFirstDeliveryPlan, acceptRevisedDeliveryPlan, type DeliveryPlanAcceptanceWriteGroup } from "./delivery-plan-repository";
const url = process.env.DELIVERY_LIFECYCLE_TEST_DATABASE_URL?.trim(), parsed = url ? new URL(url) : null;
const safe = parsed && ["localhost", "127.0.0.1"].includes(parsed.hostname) && parsed.pathname.slice(1).startsWith("almirant_delivery_lifecycle_test");
if (url && !safe) throw new Error("DELIVERY_LIFECYCLE_TEST_DATABASE_URL must target a dedicated local test database");
const d = safe ? describe : describe.skip, id = (n: number) => `26500000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { workspaceId: "revision-plan-test", projectId: id(1), boardId: id(2), userId: "revision-plan-user" };
const unit = (tempId: string, dependencies: string[] = []) => ({ kind: "work_unit" as const, tempId, title: tempId, priority: "medium" as const, work_unit_size: "M" as const, acceptance: ["done"], dependencies });
const plan = { version: 1 as const, kind: "plan" as const, title: "Plan 1", target: { projectId: scope.projectId, boardId: scope.boardId }, features: [{ kind: "feature" as const, tempId: "f-a", title: "A", workUnits: [unit("wu-b", ["wu-a"])] }], workUnits: [unit("wu-a")] };
const plan2 = { ...plan, title: "Plan 2", features: [{ kind: "feature" as const, tempId: "f-b", title: "B", workUnits: [{ ...unit("wu-a", ["wu-b"]), title: "changed", priority: "high" as const, work_unit_size: "L" as const }] }], workUnits: [unit("wu-b")] };

d("CAS-safe same-set delivery Plan revisions (dedicated PostgreSQL 17)", () => {
  const sql = postgres(url!, { max: 12 }), database = drizzle(sql, { schema });
  const first = (key = "first") => acceptFirstDeliveryPlan({ ...scope, requestKey: key, plan }, { database });
  const revise = (planId: string, requestKey: string, expectedCurrentRevisionNumber: number, value: unknown = plan2, failAfter?: DeliveryPlanAcceptanceWriteGroup) => acceptRevisedDeliveryPlan({ workspaceId: scope.workspaceId, userId: scope.userId, planId, requestKey, expectedCurrentRevisionNumber, plan: value }, { database, ...(failAfter ? { failAfter: (group: DeliveryPlanAcceptanceWriteGroup) => { if (group === failAfter) throw new Error(`injected_${group}`); } } : {}) });
  beforeEach(async () => {
    await sql`DELETE FROM agent_jobs WHERE id=${id(19)}`; await sql`DELETE FROM projects WHERE id = ${scope.projectId}`; await sql`DELETE FROM workspace WHERE id = ${scope.workspaceId}`; await sql`DELETE FROM "user" WHERE id = ${scope.userId}`;
    await sql`INSERT INTO "user" (id,name,email) VALUES (${scope.userId},'Revision User','revision@example.test')`; await sql`INSERT INTO workspace (id,name,slug) VALUES (${scope.workspaceId},'Revision','revision-plan-test')`; await sql`INSERT INTO member (id,workspace_id,user_id,role) VALUES ('revision-member',${scope.workspaceId},${scope.userId},'owner')`;
    await sql`INSERT INTO projects (id,name,workspace_id) VALUES (${scope.projectId},'Project',${scope.workspaceId})`; await sql`INSERT INTO project_repositories (id,project_id,name,url) VALUES (${id(5)},${scope.projectId},'Repo','https://example.test/repo')`; await sql`INSERT INTO boards (id,workspace_id,name,area) VALUES (${scope.boardId},${scope.workspaceId},'Development','desarrollo')`; await sql`INSERT INTO board_columns (id,board_id,name,role) VALUES (${id(3)},${scope.boardId},'Backlog','backlog'),(${id(4)},${scope.boardId},'In Progress','in_progress')`;
  });
  afterAll(async () => { await sql`DELETE FROM agent_jobs WHERE id=${id(19)}`; await sql`DELETE FROM projects WHERE id = ${scope.projectId}`; await sql`DELETE FROM workspace WHERE id = ${scope.workspaceId}`; await sql`DELETE FROM "user" WHERE id = ${scope.userId}`; await sql.end({ timeout: 5 }); });

  test("creates, no-ops, intentionally returns to history, and replays exact receipts with stable projections", async () => {
    const initial = await first(), before = await sql`SELECT stable_key,id,work_item_id FROM delivery_plan_items WHERE plan_id=${initial.planId} ORDER BY stable_key`;
    const created = await revise(initial.planId, "created", 1); expect(created).toMatchObject({ revisionNumber: 2, outcome: "created", replayed: false });
    expect([...(await sql`SELECT stable_key,id,work_item_id FROM delivery_plan_items WHERE plan_id=${initial.planId} AND kind='work_unit' ORDER BY stable_key`)]).toEqual([...before].filter((row) => row.work_item_id));
    expect([...(await sql`SELECT child.stable_key,parent.stable_key AS "parentKey" FROM delivery_plan_revision_items ri JOIN delivery_plan_items child ON child.id=ri.item_id LEFT JOIN delivery_plan_items parent ON parent.id=ri.parent_feature_item_id WHERE ri.plan_revision_id=${created.revisionId} AND child.kind='work_unit' ORDER BY child.stable_key`)]).toEqual([{ stable_key: "wu-a", parentKey: "f-b" }, { stable_key: "wu-b", parentKey: null }]);
    expect([...(await sql`SELECT child.stable_key AS "workUnit",blocker.stable_key AS "blockedBy" FROM delivery_plan_revision_dependencies d JOIN delivery_plan_items child ON child.id=d.work_unit_item_id JOIN delivery_plan_items blocker ON blocker.id=d.blocked_by_work_unit_item_id WHERE d.plan_revision_id=${created.revisionId}`)]).toEqual([{ workUnit: "wu-a", blockedBy: "wu-b" }]);
    expect([...(await sql`SELECT title,priority,work_unit_size FROM work_items WHERE id IN (SELECT work_item_id FROM delivery_plan_items WHERE plan_id=${initial.planId}) ORDER BY title`)]).toEqual([{ title: "changed", priority: "high", work_unit_size: "L" }, { title: "wu-b", priority: "medium", work_unit_size: "M" }]);
    const noOp = await revise(initial.planId, "noop", 2); expect(noOp).toMatchObject({ revisionNumber: 2, outcome: "no_op" }); expect(await sql`SELECT 1 FROM delivery_plan_revisions`).toHaveLength(2);
    const historical = await revise(initial.planId, "historical", 2, plan); expect(historical).toMatchObject({ revisionNumber: 3, outcome: "created" });
    expect([...(await sql`SELECT child.stable_key,parent.stable_key AS "parentKey" FROM delivery_plan_revision_items ri JOIN delivery_plan_items child ON child.id=ri.item_id LEFT JOIN delivery_plan_items parent ON parent.id=ri.parent_feature_item_id WHERE ri.plan_revision_id=${historical.revisionId} AND child.kind='work_unit' ORDER BY child.stable_key`)]).toEqual([{ stable_key: "wu-a", parentKey: null }, { stable_key: "wu-b", parentKey: "f-a" }]);
    expect([...(await sql`SELECT child.stable_key AS "workUnit",blocker.stable_key AS "blockedBy" FROM delivery_plan_revision_dependencies d JOIN delivery_plan_items child ON child.id=d.work_unit_item_id JOIN delivery_plan_items blocker ON blocker.id=d.blocked_by_work_unit_item_id WHERE d.plan_revision_id=${historical.revisionId}`)]).toEqual([{ workUnit: "wu-b", blockedBy: "wu-a" }]);
    expect((await sql`SELECT id FROM delivery_plan_items WHERE plan_id=${initial.planId} AND stable_key='f-a'`)[0]?.id).toBe(before.find((row) => row.stable_key === "f-a")?.id);
    expect(await revise(initial.planId, "created", 1)).toEqual({ ...created, replayed: true });
    await expect(revise(initial.planId, "created", 2)).rejects.toMatchObject({ code: "acceptance_idempotency_conflict" });
    await expect(revise(initial.planId, "stale", 2)).rejects.toMatchObject({ code: "acceptance_stale_revision" });
    expect(await sql`SELECT 1 FROM delivery_plan_acceptance_receipts`).toHaveLength(4);
  });

  test("fails changed units closed on projection or durable evidence while unchanged blocked units carry forward", async () => {
    const initial = await first(), [changed, unchanged] = await sql<Array<{ work_item_id: string }>>`SELECT work_item_id FROM delivery_plan_items WHERE plan_id=${initial.planId} AND kind='work_unit' ORDER BY stable_key`;
    const partial = { ...plan, title: "Plan 2", workUnits: [{ ...plan.workUnits[0]!, title: "changed" }] };
    await sql`UPDATE work_items SET board_column_id=${id(4)},is_ai_processing=true WHERE id=${unchanged!.work_item_id}`;
    await sql`INSERT INTO agent_jobs (id,work_item_id,status,provider,config) VALUES (${id(19)},${unchanged!.work_item_id},'completed','claude-code','{}')`;
    const carriedProjection = [...(await sql`SELECT title,description,priority,position,work_unit_size,metadata,updated_at FROM work_items WHERE id=${unchanged!.work_item_id}`)];
    await expect(revise(initial.planId, "unchanged-blocked", 1, partial)).resolves.toMatchObject({ outcome: "created" });
    expect([...(await sql`SELECT title,description,priority,position,work_unit_size,metadata,updated_at FROM work_items WHERE id=${unchanged!.work_item_id}`)]).toEqual(carriedProjection);
    const changedPlan = { ...partial, title: "Plan 3", workUnits: [{ ...partial.workUnits[0]!, title: "changed again" }] };
    const cases: Array<[string, () => Promise<unknown>, () => Promise<unknown>]> = [
      ["advanced", () => sql`UPDATE work_items SET board_column_id=${id(4)} WHERE id=${changed!.work_item_id}`, () => sql`UPDATE work_items SET board_column_id=${id(3)} WHERE id=${changed!.work_item_id}`],
      ["intent", () => sql`UPDATE work_items SET backlog_intent='fix' WHERE id=${changed!.work_item_id}`, () => sql`UPDATE work_items SET backlog_intent='new' WHERE id=${changed!.work_item_id}`],
      ["ai", () => sql`UPDATE work_items SET is_ai_processing=true WHERE id=${changed!.work_item_id}`, () => sql`UPDATE work_items SET is_ai_processing=false WHERE id=${changed!.work_item_id}`],
      ["queued", () => sql`INSERT INTO agent_jobs (id,project_id,work_item_id,board_id,created_by_user_id,workspace_id,status,provider,config) VALUES (${id(20)},${scope.projectId},${changed!.work_item_id},${scope.boardId},${scope.userId},${scope.workspaceId},'queued','claude-code','{}')`, () => sql`DELETE FROM agent_jobs WHERE id=${id(20)}`],
      ["claimed", () => sql`INSERT INTO agent_jobs (id,work_item_id,status,provider,worker_id,config) VALUES (${id(27)},${changed!.work_item_id},'running','claude-code','worker','{}')`, () => sql`DELETE FROM agent_jobs WHERE id=${id(27)}`],
      ["durable-run", () => sql`INSERT INTO agent_jobs (id,work_item_id,status,provider,job_type,config) VALUES (${id(28)},${changed!.work_item_id},'completed','claude-code','implementation','{}')`, () => sql`DELETE FROM agent_jobs WHERE id=${id(28)}`],
      ["review", () => sql`INSERT INTO agent_jobs (id,work_item_id,status,provider,job_type,config) VALUES (${id(21)},${changed!.work_item_id},'completed','claude-code','review','{}')`, () => sql`DELETE FROM agent_jobs WHERE id=${id(21)}`],
      ["correction", () => sql`INSERT INTO agent_jobs (id,work_item_id,status,provider,job_type,config) VALUES (${id(22)},${changed!.work_item_id},'failed','claude-code','bug-fix','{}')`, () => sql`DELETE FROM agent_jobs WHERE id=${id(22)}`],
      ["run", () => sql`INSERT INTO ai_sessions (id,work_item_id,model) VALUES (${id(23)},${changed!.work_item_id},'test')`, () => sql`DELETE FROM ai_sessions WHERE id=${id(23)}`],
      ["integration", async () => { await sql`INSERT INTO integration_batches (id,workspace_id,project_id,repository_id,board_id,integration_branch) VALUES (${id(24)},${scope.workspaceId},${scope.projectId},${id(5)},${scope.boardId},'integration/test')`; return sql`INSERT INTO integration_batch_items (id,batch_id,work_item_id,processing_order) VALUES (${id(25)},${id(24)},${changed!.work_item_id},0)`; }, () => sql`DELETE FROM integration_batches WHERE id=${id(24)}`],
      ["combined", async () => { await sql`UPDATE work_items SET is_ai_processing=true WHERE id=${changed!.work_item_id}`; return sql`INSERT INTO ai_sessions (id,work_item_id,model) VALUES (${id(26)},${changed!.work_item_id},'test')`; }, async () => { await sql`DELETE FROM ai_sessions WHERE id=${id(26)}`; return sql`UPDATE work_items SET is_ai_processing=false WHERE id=${changed!.work_item_id}`; }],
    ];
    for (const [name, block, clear] of cases) { await block(); await expect(revise(initial.planId, name, 2, changedPlan)).rejects.toMatchObject({ code: "acceptance_projection_blocked" }); await clear(); }
    await expect(revise(initial.planId, "allowed", 2, changedPlan)).resolves.toMatchObject({ revisionNumber: 3 });
  });

  test("rejects membership/kind changes and rolls back write groups before a race produces one stale loser", async () => {
    const initial = await first();
    await expect(revise(initial.planId, "removed", 1, { ...plan2, workUnits: [], features: [{ ...plan2.features[0]!, workUnits: [{ ...plan2.features[0]!.workUnits[0]!, dependencies: [] }] }] })).rejects.toMatchObject({ code: "acceptance_conflict" });
    await expect(revise(initial.planId, "kind", 1, { ...plan2, features: [{ ...plan2.features[0]!, tempId: "wu-b" }] })).rejects.toMatchObject({ code: "acceptance_invalid_plan" });
    await expect(acceptRevisedDeliveryPlan({ workspaceId: "other-tenant", userId: scope.userId, planId: initial.planId, requestKey: "cross-tenant", expectedCurrentRevisionNumber: 1, plan: plan2 }, { database })).rejects.toMatchObject({ code: "acceptance_unauthorized" });
    for (const group of ["plan", "work_units", "items", "dependencies", "receipt", "cas"] as DeliveryPlanAcceptanceWriteGroup[]) { await expect(revise(initial.planId, `rollback-${group}`, 1, plan2, group)).rejects.toThrow(`injected_${group}`); expect([...(await sql`SELECT current_revision_number FROM delivery_plans WHERE id=${initial.planId}`)]).toEqual([{ current_revision_number: 1 }]); expect(await sql`SELECT 1 FROM delivery_plan_revisions`).toHaveLength(1); expect(await sql`SELECT 1 FROM delivery_plan_acceptance_receipts`).toHaveLength(1); }
    expect(await revise(initial.planId, "retry", 1)).toMatchObject({ revisionNumber: 2, outcome: "created" });
    await sql`UPDATE board_columns SET name='Not Backlog' WHERE id=${id(3)}`; await expect(revise(initial.planId, "retry", 1)).rejects.toMatchObject({ code: "canonical_backlog_required" }); await sql`UPDATE board_columns SET name='Backlog' WHERE id=${id(3)}`;
    await sql`UPDATE member SET role='viewer' WHERE workspace_id=${scope.workspaceId}`; await expect(revise(initial.planId, "retry", 1)).rejects.toMatchObject({ code: "acceptance_unauthorized" }); await sql`UPDATE member SET role='owner' WHERE workspace_id=${scope.workspaceId}`;
    const same = await Promise.all([revise(initial.planId, "same-race", 2, plan), revise(initial.planId, "same-race", 2, plan)]); expect(same.map(({ replayed }) => replayed).sort()).toEqual([false, true]);
    const outcomes = await Promise.allSettled([revise(initial.planId, "winner-a", 3), revise(initial.planId, "winner-b", 3, { ...plan2, title: "other" })]);
    expect(outcomes.filter((value) => value.status === "fulfilled")).toHaveLength(1); expect(outcomes.filter((value) => value.status === "rejected").map((value) => (value as PromiseRejectedResult).reason.code)).toEqual(["acceptance_stale_revision"]);
  });
});
