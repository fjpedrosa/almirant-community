import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { restoreRealModules } from "../../../../test/mocks";

type StoredAdmission = {
  reviewJobId: string;
  snapshot: unknown;
  status: string;
  result: Record<string, unknown> | null;
};

let persistedAdmission: StoredAdmission | null = null;
let inFlightAdmission: Promise<StoredAdmission> | null = null;

const generateWorkItems = mock(async () => ({
  createdIds: ["work-item-1"],
  tempToRealIdMap: { "task-1": "work-item-1" },
  errors: [],
  dependenciesCreated: 0,
  dependencyErrors: [],
}));

const admitPlanReviewWithJob = mock(async (input: {
  reviewJobId: string;
  snapshot: unknown;
  onCreated?: (tx: unknown, admission: unknown) => Promise<{ status: "completed"; result: Record<string, unknown> }>;
}) => {
  if (persistedAdmission) return { admission: persistedAdmission, created: false };
  const creator = !inFlightAdmission;
  if (creator) {
    inFlightAdmission = (async () => {
      const provisional: StoredAdmission = {
        reviewJobId: input.reviewJobId,
        snapshot: input.snapshot,
        status: "queued",
        result: null,
      };
      const terminal = input.onCreated ? await input.onCreated({}, provisional) : null;
      return terminal ? { ...provisional, status: terminal.status, result: terminal.result } : provisional;
    })();
  }
  try {
    const admission = await inFlightAdmission;
    if (!admission) throw new Error("missing mock admission");
    if (!persistedAdmission) persistedAdmission = admission;
    return { admission, created: creator };
  } finally {
    inFlightAdmission = null;
  }
});

const listConnections = mock(async () => []);

mock.module("@almirant/database", () => ({ admitPlanReviewWithJob, listConnections }));

const { admitPlanReviewJob } = await import("./plan-review-admission");
type PlanReviewAdmissionDependencies = Parameters<typeof admitPlanReviewJob>[1];
const dependencies = {
  admitPlanReviewWithJob,
  listConnections,
  generateWorkItems,
} as unknown as NonNullable<PlanReviewAdmissionDependencies>;

const validPlan = () => ({
  projectId: "project-1",
  boardId: "board-1",
  boardColumnId: "column-1",
  items: [{ tempId: "task-1", type: "task" as const, title: "Task 1", priority: "medium" as const }],
  dependencies: [],
});

describe("admitPlanReviewJob", () => {
  beforeEach(() => {
    admitPlanReviewWithJob.mockClear();
    listConnections.mockClear();
    generateWorkItems.mockClear();
    persistedAdmission = null;
    inFlightAdmission = null;
  });

  test("creates a terminal skipped admission when independent critics are unavailable", async () => {
    const admission = await admitPlanReviewJob({
      workspaceId: "workspace-1",
      userId: "user-1",
      planningSessionId: "session-1",
      plan: validPlan(),
      policy: { enabled: true, requestedCriticCount: 2 },
    }, dependencies);

    expect(admission?.status).toBe("completed");
    expect(admission?.resolution.status).toBe("skipped");
    expect(generateWorkItems).toHaveBeenCalledTimes(1);
  });

  test("replays the same durable admission for duplicate submissions", async () => {
    const request = () => admitPlanReviewJob({
      workspaceId: "workspace-1",
      userId: "user-1",
      planningSessionId: "session-1",
      plan: validPlan(),
      policy: { enabled: true, requestedCriticCount: 2 },
    }, dependencies);
    const first = await request();
    const second = await request();
    expect(first?.jobId).toBe(second?.jobId);
    expect(second?.created).toBe(false);
    expect(generateWorkItems).toHaveBeenCalledTimes(1);
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
});
