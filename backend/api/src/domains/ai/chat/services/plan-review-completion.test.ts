import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { restoreRealModules } from "../../../../test/mocks";
import {
  canonicalizePlanReviewPlan,
  createPlanReviewOpaqueReference,
  hashPlanReviewContent,
  planReviewJobSnapshotSchema,
  type PlanReviewOutput,
} from "@almirant/shared";

const getPlanReviewAdmissionByJobId = mock(async () => ({
  reviewJobId: "job-review",
  workspaceId: "workspace-1",
  projectId: "project-1",
  boardId: "board-1",
  boardColumnId: "column-1",
  snapshot: null,
  status: "queued",
  result: null,
}));
const claimPlanReviewAdmissionForApplication = mock(async () => ({
  leaseId: "lease-1",
  admission: {
    reviewJobId: "job-review",
    workspaceId: "workspace-1",
    projectId: "project-1",
    boardId: "board-1",
    boardColumnId: "column-1",
  },
}));
const finishPlanReviewAdmission = mock(async () => ({ id: "admission-1" }));
const terminalizeInvalidPlanReviewAdmission = mock(async () => ({ id: "admission-1" }));
const generateWorkItems = mock(async () => ({
  createdIds: ["work-item-1"],
  tempToRealIdMap: { "task-1": "work-item-1" },
  errors: [],
  dependenciesCreated: 1,
  dependencyErrors: [],
}));
const db = {
  transaction: mock(async <T>(callback: (tx: unknown) => Promise<T>) => callback({})),
};

mock.module("@almirant/database", () => ({
  claimPlanReviewAdmissionForApplication,
  db,
  finishPlanReviewAdmission,
  generateWorkItems,
  getPlanReviewAdmissionByJobId,
  terminalizeInvalidPlanReviewAdmission,
}));

const { applyPlanReviewTerminalJob } = await import("./plan-review-completion");
type CompletionDependencies = Parameters<typeof applyPlanReviewTerminalJob>[1];

const originalPlan = canonicalizePlanReviewPlan({
  projectId: "project-1",
  boardId: "board-1",
  boardColumnId: "column-1",
  items: [{ tempId: "task-1", type: "task", title: "Task", priority: "medium" }],
  dependencies: [],
});
const criticRef = createPlanReviewOpaqueReference({
  workspaceId: "workspace-1",
  userId: "user-1",
  reviewJobId: "job-review",
  provider: "openai",
  model: "gpt-5.4",
  runtime: "codex",
  criticIndex: 0,
});
const capabilityRef = (value: string): string => `prs1.${value.repeat(43).slice(0, 43)}`;
const snapshot = planReviewJobSnapshotSchema.parse({
  version: 2,
  intent: "plan-review",
  reviewJobId: "job-review",
  enabled: true,
  originalPlan,
  requestedCriticCount: 2,
  maxRevisions: 1,
  synthesizer: {
    connectionRef: capabilityRef("synth"),
    provider: "openai",
    model: "gpt-5.4",
    runtime: "opencode",
  },
  critics: [
    {
      correlationRef: criticRef,
      connectionRef: capabilityRef("critic-0"),
      provider: "openai",
      model: "gpt-5.4",
      runtime: "opencode",
      lens: "architecture_dependencies",
      isolated: true,
    },
    {
      correlationRef: createPlanReviewOpaqueReference({
        workspaceId: "workspace-1",
        userId: "user-1",
        reviewJobId: "job-review",
        provider: "openai",
        model: "gpt-5.4",
        runtime: "opencode",
        criticIndex: 1,
      }),
      connectionRef: capabilityRef("critic-1"),
      provider: "openai",
      model: "gpt-5.4",
      runtime: "opencode",
      lens: "reliability_tests_dod",
      isolated: true,
    },
  ],
  resolution: { status: "ready", degradation: { status: "none", reason: "ready" } },
});

const output = (outcome: PlanReviewOutput["outcome"]): PlanReviewOutput => ({
  outputVersion: 1,
  intent: "plan-review",
  reviewJobId: "job-review",
  originalPlanSha256: originalPlan.sha256,
  finalPlan: { ...originalPlan, sha256: hashPlanReviewContent(originalPlan.content) },
  findings: [],
  findingDecisions: [],
  outcome,
  rationale: outcome,
  revisionCount: 0,
});

const dependencies = {
  claimPlanReviewAdmissionForApplication,
  db,
  finishPlanReviewAdmission,
  generateWorkItems,
  getPlanReviewAdmissionByJobId,
  terminalizeInvalidPlanReviewAdmission,
} as unknown as NonNullable<CompletionDependencies>;

const job = (result: unknown, status = "completed") => ({
  id: "job-review",
  status,
  config: { planReview: snapshot },
  result,
});

describe("applyPlanReviewTerminalJob", () => {
  beforeEach(() => {
    getPlanReviewAdmissionByJobId.mockClear();
    claimPlanReviewAdmissionForApplication.mockClear();
    finishPlanReviewAdmission.mockClear();
    terminalizeInvalidPlanReviewAdmission.mockClear();
    generateWorkItems.mockClear();
    db.transaction.mockClear();
  });

  test("applies accepted output atomically and records generated IDs", async () => {
    await applyPlanReviewTerminalJob(job({ planReviewOutput: output("accept") }), dependencies);

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(generateWorkItems).toHaveBeenCalledWith(expect.objectContaining({ atomic: true }));
    expect(finishPlanReviewAdmission).toHaveBeenCalledWith("job-review", "lease-1", "completed", expect.objectContaining({ generated: expect.any(Object) }), expect.anything());
  });

  test("rejects without generating work items", async () => {
    await applyPlanReviewTerminalJob(job({ planReviewOutput: output("reject") }), dependencies);

    expect(generateWorkItems).not.toHaveBeenCalled();
    expect(finishPlanReviewAdmission).toHaveBeenCalledWith("job-review", "lease-1", "rejected", expect.any(Object));
  });

  test("terminalizes invalid output and replays only once when the lease is unavailable", async () => {
    await applyPlanReviewTerminalJob(job({ planReviewOutput: { invalid: true } }), dependencies);
    expect(finishPlanReviewAdmission).toHaveBeenCalledWith("job-review", "lease-1", "failed", expect.objectContaining({ outcome: "not_completed" }));

    claimPlanReviewAdmissionForApplication.mockImplementationOnce(async () => null as never);
    finishPlanReviewAdmission.mockClear();
    await applyPlanReviewTerminalJob(job({ planReviewOutput: output("accept") }), dependencies);
    expect(finishPlanReviewAdmission).not.toHaveBeenCalled();
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
});
