export interface ScheduledAgentProjectContext {
  projectId: string | null;
  repositoryId: string | null;
  repoUrl: string | null;
}

/**
 * Resolve the project used by scheduled/webhook execution.
 *
 * A config without an explicit project resolves to no project and no
 * repository. It used to resolve to the workspace's primary repository — the
 * first one by `order`, which with several tied at 0 is an arbitrary pick. That
 * silently pointed an agent at a repository nobody chose: it would clone it,
 * branch it and open a pull request against it. Running with an empty workspace
 * is a supported mode, so an unspecified project now means exactly that.
 *
 * CREATE/PATCH validation calls this too, so validation and execution keep
 * resolving the same project defaults.
 */
export const resolveScheduledAgentProjectContext = async (
  _workspaceId: string,
  projectId: string | null | undefined,
): Promise<ScheduledAgentProjectContext> => {
  if (projectId) {
    return {
      projectId,
      repositoryId: null,
      repoUrl: null,
    };
  }

  return {
    projectId: null,
    repositoryId: null,
    repoUrl: null,
  };
};
