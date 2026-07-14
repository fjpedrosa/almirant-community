import { getOrgPrimaryRepository } from "@almirant/database";

export interface ScheduledAgentProjectContext {
  projectId: string | null;
  repositoryId: string | null;
  repoUrl: string | null;
}

/**
 * Resolve the implicit project used by scheduled/webhook execution.
 *
 * Configs without an explicit project historically execute against the
 * organization's primary repository. CREATE/PATCH validation must therefore
 * use that repository's project as well, otherwise validation and execution
 * can resolve different project defaults without any configuration change.
 */
export const resolveScheduledAgentProjectContext = async (
  workspaceId: string,
  projectId: string | null | undefined,
): Promise<ScheduledAgentProjectContext> => {
  if (projectId) {
    return {
      projectId,
      repositoryId: null,
      repoUrl: null,
    };
  }

  try {
    const repository = await getOrgPrimaryRepository(workspaceId);
    return {
      projectId: repository?.projectId ?? null,
      repositoryId: repository?.id ?? null,
      repoUrl: repository?.url ?? null,
    };
  } catch {
    // Preserve the existing non-fatal repository fallback. Runtime validation
    // still fails closed if no model can be resolved without a project.
    return {
      projectId: null,
      repositoryId: null,
      repoUrl: null,
    };
  }
};
