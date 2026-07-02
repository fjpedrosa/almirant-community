import { describe, expect, it, mock } from "bun:test";
import { resolveExpectedWorkItemIdsForCompletion } from "./completion-snapshot";

describe("completion snapshot expected work items", () => {
  it("uses the DoD-remediation scope for runner-fix-dod jobs", async () => {
    const getLeafTaskIdsUnder = mock(async () => ["all-leaf"]);
    const getDodRemediationExpectedLeafTaskIdsUnder = mock(async () => ["dod-leaf"]);

    await expect(
      resolveExpectedWorkItemIdsForCompletion(
        {
          rootWorkItemId: "root-1",
          workspaceId: "org-1",
          job: {
            skillName: "runner-fix-dod",
            promptTemplate: "runner-fix-dod",
            config: { skillName: "runner-fix-dod" },
          },
        },
        {
          getLeafTaskIdsUnder,
          getDodRemediationExpectedLeafTaskIdsUnder,
        },
      ),
    ).resolves.toEqual(["dod-leaf"]);

    expect(getDodRemediationExpectedLeafTaskIdsUnder).toHaveBeenCalledWith("org-1", "root-1");
    expect(getLeafTaskIdsUnder).not.toHaveBeenCalled();
  });

  it("keeps normal leaf scope for non-DoD runner jobs", async () => {
    const getLeafTaskIdsUnder = mock(async () => ["all-leaf"]);
    const getDodRemediationExpectedLeafTaskIdsUnder = mock(async () => ["dod-leaf"]);

    await expect(
      resolveExpectedWorkItemIdsForCompletion(
        {
          rootWorkItemId: "root-1",
          workspaceId: "org-1",
          job: {
            skillName: "runner-implement",
            promptTemplate: "runner-implement",
            config: { skillName: "runner-implement" },
          },
        },
        {
          getLeafTaskIdsUnder,
          getDodRemediationExpectedLeafTaskIdsUnder,
        },
      ),
    ).resolves.toEqual(["all-leaf"]);
  });

  it("returns an empty expected set when the job has no scoped root", async () => {
    const getLeafTaskIdsUnder = mock(async () => ["all-leaf"]);
    const getDodRemediationExpectedLeafTaskIdsUnder = mock(async () => ["dod-leaf"]);

    await expect(
      resolveExpectedWorkItemIdsForCompletion(
        {
          rootWorkItemId: null,
          workspaceId: "org-1",
          job: {
            skillName: "runner-fix-dod",
            promptTemplate: "runner-fix-dod",
            config: { skillName: "runner-fix-dod" },
          },
        },
        {
          getLeafTaskIdsUnder,
          getDodRemediationExpectedLeafTaskIdsUnder,
        },
      ),
    ).resolves.toEqual([]);
  });
});
