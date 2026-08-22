import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { restoreRealModules } from "../../../test/mocks";

const findExpiredPlanReviewApplicationLeases = mock(async () => [
  { reviewJobId: "job-terminal" },
  { reviewJobId: "job-active" },
  { reviewJobId: "job-missing" },
]);
const getJobById = mock(async (jobId: string) => {
  if (jobId === "job-missing") return null;
  return {
    job: {
      id: jobId,
      status: jobId === "job-active" ? "running" : "completed",
      config: { planReview: {} },
      result: { planReviewOutput: {} },
    },
  };
});
const terminalizeInvalidPlanReviewAdmission = mock(async () => null);
const applyPlanReviewTerminalJob = mock(async (_job: { id: string; status: string }) => undefined);

mock.module("@almirant/database", () => ({
  findExpiredPlanReviewApplicationLeases,
  getJobById,
  terminalizeInvalidPlanReviewAdmission,
}));
mock.module("@almirant/config", () => ({
  logger: { info: mock(() => undefined), error: mock(() => undefined) },
}));

const { recoverExpiredPlanReviewAdmissionsOnce } = await import("./plan-review-admission-recovery");
type RecoveryDependencies = Parameters<typeof recoverExpiredPlanReviewAdmissionsOnce>[1];
const dependencies = {
  findExpiredPlanReviewApplicationLeases,
  getJobById,
  terminalizeInvalidPlanReviewAdmission,
  applyPlanReviewTerminalJob,
} as unknown as NonNullable<RecoveryDependencies>;

describe("plan-review admission recovery", () => {
  beforeEach(() => {
    findExpiredPlanReviewApplicationLeases.mockClear();
    getJobById.mockClear();
    terminalizeInvalidPlanReviewAdmission.mockClear();
    applyPlanReviewTerminalJob.mockClear();
  });

  test("replays terminal leases, skips active jobs, and terminalizes missing jobs", async () => {
    const result = await recoverExpiredPlanReviewAdmissionsOnce({ batchSize: 10 }, dependencies);

    expect(result).toEqual({ scanned: 3, recovered: 2 });
    expect(applyPlanReviewTerminalJob).toHaveBeenCalledTimes(1);
    expect(applyPlanReviewTerminalJob.mock.calls[0]?.[0]).toMatchObject({ id: "job-terminal", status: "completed" });
    expect(terminalizeInvalidPlanReviewAdmission).toHaveBeenCalledTimes(1);
    expect(terminalizeInvalidPlanReviewAdmission).toHaveBeenCalledWith("job-missing", expect.any(Object));
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
});
