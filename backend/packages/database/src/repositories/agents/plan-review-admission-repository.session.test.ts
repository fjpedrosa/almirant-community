import { describe, expect, test } from "bun:test";

const repositorySource = await Bun.file(
  new URL("./plan-review-admission-repository.ts", import.meta.url),
).text();
const schemaSource = await Bun.file(
  new URL("../../schema/plan-review-admissions.ts", import.meta.url),
).text();
const migrationSource = await Bun.file(
  new URL("../../../migrations/0231_sturdy_kang.sql", import.meta.url),
).text();

describe("plan-review admission session binding", () => {
  test("locks and validates the exact active workspace/project/board session before admission", () => {
    expect(repositorySource).toContain("planningSessions");
    expect(repositorySource).toContain('eq(planningSessions.workspaceId, input.workspaceId)');
    expect(repositorySource).toContain('eq(planningSessions.projectId, input.projectId)');
    expect(repositorySource).toContain('eq(planningSessions.boardId, input.boardId)');
    expect(repositorySource).toContain('eq(planningSessions.status, "active")');
    expect(repositorySource).toContain('.for("update")');
  });

  test("scopes idempotency to workspace, planning session, and plan digest", () => {
    expect(schemaSource).toContain("planningSessionId: uuid(\"planning_session_id\")");
    expect(schemaSource).toContain("onDelete: \"cascade\"");
    expect(schemaSource).toContain(
      "uniqueIndex(\"plan_review_admissions_workspace_session_plan_uidx\").on(table.workspaceId, table.planningSessionId, table.planSha256)",
    );
    expect(migrationSource).toContain(
      'CREATE UNIQUE INDEX "plan_review_admissions_workspace_session_plan_uidx" ON "plan_review_admissions" USING btree ("workspace_id","planning_session_id","plan_sha256")',
    );
  });

  test("provides a workspace/session-scoped latest admission lookup", () => {
    expect(repositorySource).toContain("getLatestPlanReviewAdmissionBySession");
    expect(repositorySource).toContain("eq(planReviewAdmissions.planningSessionId, planningSessionId)");
    expect(repositorySource).toContain("orderBy(desc(planReviewAdmissions.updatedAt), desc(planReviewAdmissions.createdAt))");
  });
});
