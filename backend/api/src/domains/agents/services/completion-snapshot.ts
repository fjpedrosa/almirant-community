type CompletionSnapshotJob = {
  skillName?: string | null;
  promptTemplate?: string | null;
  config?: { skillName?: string | null } | null;
};

type ExpectedWorkItemIdDeps = {
  getLeafTaskIdsUnder: (workspaceId: string, rootWorkItemId: string) => Promise<string[]>;
  getDodRemediationExpectedLeafTaskIdsUnder: (
    workspaceId: string,
    rootWorkItemId: string,
  ) => Promise<string[]>;
};

const normalizeTemplate = (value: unknown): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

export const isDodRemediationCompletionJob = (
  job: CompletionSnapshotJob,
): boolean => {
  const configSkillName = normalizeTemplate(job.config?.skillName);
  const template = normalizeTemplate(job.promptTemplate);
  const skillName = normalizeTemplate(job.skillName);

  return (
    template === "runner-fix-dod" ||
    skillName === "runner-fix-dod" ||
    configSkillName === "runner-fix-dod"
  );
};

export const resolveExpectedWorkItemIdsForCompletion = async (
  input: {
    rootWorkItemId: string | null;
    workspaceId: string | null;
    job: CompletionSnapshotJob;
  },
  deps: ExpectedWorkItemIdDeps,
): Promise<string[]> => {
  if (!input.rootWorkItemId || !input.workspaceId) {
    return [];
  }

  if (isDodRemediationCompletionJob(input.job)) {
    return deps.getDodRemediationExpectedLeafTaskIdsUnder(
      input.workspaceId,
      input.rootWorkItemId,
    );
  }

  return deps.getLeafTaskIdsUnder(input.workspaceId, input.rootWorkItemId);
};
