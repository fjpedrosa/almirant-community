import type { ActiveWorkspace } from "../../../shared/middleware/session-auth.middleware";

export class ApiKeyWorkspaceError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiKeyWorkspaceError";
  }
}

type ResolveApiKeyWorkspaceArgs = {
  activeWorkspace: ActiveWorkspace | null;
  requestedWorkspaceId?: string | null;
  userId: string;
  isWorkspaceMember: (userId: string, workspaceId: string) => Promise<boolean>;
};

/**
 * Resolves which workspace a browser-created CLI API key should belong to.
 *
 * Security invariant: a requested workspace is never trusted just because it
 * came from the browser/CLI. If it differs from the already-authenticated
 * active workspace, the user membership is checked explicitly before issuing
 * the key.
 */
export async function resolveApiKeyWorkspaceId({
  activeWorkspace,
  requestedWorkspaceId,
  userId,
  isWorkspaceMember,
}: ResolveApiKeyWorkspaceArgs): Promise<string> {
  if (!activeWorkspace?.id) {
    throw new ApiKeyWorkspaceError("No active workspace", 403);
  }

  const requested = requestedWorkspaceId?.trim() || "";
  if (!requested || requested === activeWorkspace.id) {
    return activeWorkspace.id;
  }

  const isMember = await isWorkspaceMember(userId, requested);
  if (!isMember) {
    throw new ApiKeyWorkspaceError("Workspace not found or not accessible", 403);
  }

  return requested;
}
