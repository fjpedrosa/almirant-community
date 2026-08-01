export type CliAuthWorkspace = {
  id: string;
  name: string;
  slug: string;
};

type WorkspaceResolution =
  | { status: "selected"; workspace: CliAuthWorkspace }
  | { status: "needs_selection" }
  | { status: "error"; message: string };

const normalizeWorkspaceToken = (value: string) => value.trim().toLowerCase();

export const resolveCliAuthWorkspace = (
  workspaces: CliAuthWorkspace[],
  workspaceHint: string | null | undefined,
  selectedWorkspaceId: string | null,
): WorkspaceResolution => {
  if (selectedWorkspaceId) {
    const selected = workspaces.find((workspace) => workspace.id === selectedWorkspaceId);
    if (selected) return { status: "selected", workspace: selected };
  }

  const hint = normalizeWorkspaceToken(workspaceHint ?? "");
  if (hint) {
    const matched = workspaces.find((workspace) =>
      [workspace.id, workspace.slug, workspace.name]
        .filter(Boolean)
        .some((candidate) => normalizeWorkspaceToken(candidate) === hint),
    );

    if (matched) return { status: "selected", workspace: matched };

    return {
      status: "error",
      message: `Workspace "${workspaceHint}" was not found for your user.`,
    };
  }

  if (workspaces.length === 1) {
    return { status: "selected", workspace: workspaces[0]! };
  }

  if (workspaces.length > 1) {
    return { status: "needs_selection" };
  }

  return {
    status: "error",
    message: "No workspace is available for your user.",
  };
};

export const buildCallbackUrl = (
  callback: string,
  params: Record<string, string>,
) => {
  const url = new URL(callback);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return url.toString();
};

export const buildCliAuthReturnPath = (
  callback: string,
  keyName: string,
  workspaceHint: string | null | undefined,
) => {
  const params = new URLSearchParams({
    callback,
    name: keyName,
  });

  const normalizedWorkspaceHint = workspaceHint?.trim();
  if (normalizedWorkspaceHint) {
    params.set("workspace", normalizedWorkspaceHint);
  }

  return `/cli-auth?${params.toString()}`;
};

export const buildCliAuthCallbackParams = (
  apiKey: { key: string; id?: string },
  workspace: CliAuthWorkspace,
): Record<string, string> => {
  const keyId = apiKey.id || "";

  return {
    apiKey: apiKey.key,
    // New CLI name. Keep keyId too for already-open older CLIs/screens.
    apiKeyId: keyId,
    keyId,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    workspaceSlug: workspace.slug,
  };
};
