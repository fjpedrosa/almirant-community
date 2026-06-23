import type { AgentWorkspace } from "@almirant/shared";
import type { ClaimedJob } from "@almirant/remote-agent";

export type AgentWorkspaceSource = "explicit" | "legacy" | "project" | "implicit";

export type ResolvedGitRepoWorkspace = Extract<AgentWorkspace, { kind: "git_repo" }> & {
  kind: "git_repo";
  repoUrl: string;
  ref: string;
  source: AgentWorkspaceSource;
};

export type ResolvedEmptyWorkspace = Extract<AgentWorkspace, { kind: "empty_workspace" }> & {
  kind: "empty_workspace";
  source: AgentWorkspaceSource;
};

export type ResolvedUploadedFilesWorkspace = Extract<AgentWorkspace, { kind: "uploaded_files" }> & {
  source: AgentWorkspaceSource;
};

export type ResolvedMountedVolumeWorkspace = Extract<AgentWorkspace, { kind: "mounted_volume" }> & {
  source: AgentWorkspaceSource;
};

export type ResolvedMemoryOnlyWorkspace = Extract<AgentWorkspace, { kind: "memory_only" }> & {
  source: AgentWorkspaceSource;
};

export type ResolvedAgentWorkspace =
  | ResolvedGitRepoWorkspace
  | ResolvedEmptyWorkspace
  | ResolvedUploadedFilesWorkspace
  | ResolvedMountedVolumeWorkspace
  | ResolvedMemoryOnlyWorkspace;

type WithoutSource<T> = T extends { source: AgentWorkspaceSource } ? Omit<T, "source"> : never;

type ResolvedAgentWorkspaceWithoutSource = WithoutSource<ResolvedAgentWorkspace>;

export type RunnableAgentWorkspace =
  | ResolvedGitRepoWorkspace
  | ResolvedEmptyWorkspace
  | ResolvedUploadedFilesWorkspace;

export type RepositoryOverride = {
  id?: string;
  url?: string;
  branch?: string;
  depth?: number;
  workspaceKind?: RunnableAgentWorkspace["kind"];
};

export type ProjectRepository = {
  repositoryId?: string;
  url: string;
  branch?: string;
};

export type ResolveAgentWorkspaceInput = {
  job: ClaimedJob;
  jobConfig: Record<string, unknown>;
  projectRepository?: ProjectRepository;
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
};

const asString = (value: unknown): string | undefined => {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
};

const asStringArray = (value: unknown): string[] => {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
};

const asPositiveInteger = (value: unknown): number | undefined => {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
};

export const getExplicitWorkspaceKind = (jobConfig: Record<string, unknown>): string | undefined => {
  const workspace = asRecord(jobConfig.workspace);
  return asString(workspace?.kind);
};

const resolveExplicitWorkspace = (
  rawWorkspace: unknown,
  projectRepository?: ProjectRepository,
): ResolvedAgentWorkspaceWithoutSource | null => {
  const workspace = asRecord(rawWorkspace);
  if (!workspace) return null;

  const kind = asString(workspace.kind);
  switch (kind) {
    case "git_repo": {
      const repoUrl =
        asString(workspace.repoUrl) ??
        asString(workspace.repositoryUrl) ??
        projectRepository?.url;

      if (!repoUrl) {
        throw new Error(
          "Invalid workspace config: git_repo workspace requires repoUrl or a project repository",
        );
      }

      const repositoryId =
        asString(workspace.repositoryId) ?? projectRepository?.repositoryId;
      const ref =
        asString(workspace.ref) ??
        asString(workspace.branch) ??
        projectRepository?.branch ??
        "main";
      const depth = asPositiveInteger(workspace.depth);

      return {
        kind,
        repoUrl,
        ...(repositoryId ? { repositoryId } : {}),
        ref,
        ...(depth ? { depth } : {}),
      };
    }
    case "empty_workspace": {
      const templateId = asString(workspace.templateId) ?? asString(workspace.template);

      return {
        kind,
        ...(templateId ? { templateId } : {}),
      };
    }
    case "uploaded_files": {
      const fileIds = asStringArray(workspace.fileIds);
      if (fileIds.length === 0) {
        throw new Error("Invalid workspace config: uploaded_files workspace requires at least one fileId");
      }

      return {
        kind,
        fileIds,
        unpackMode: workspace.unpackMode === "preserve_paths" ? "preserve_paths" : "flat",
      };
    }
    case "mounted_volume": {
      const volumeId = asString(workspace.volumeId);
      const path = asString(workspace.path);
      const mountPath = asString(workspace.mountPath);

      return {
        kind,
        ...(volumeId ? { volumeId } : {}),
        ...(path ? { path } : {}),
        ...(mountPath ? { mountPath } : {}),
        readOnly: workspace.readOnly === true,
      };
    }
    case "memory_only": {
      return {
        kind,
        contextIds: asStringArray(workspace.contextIds),
      };
    }
    default:
      throw new Error(`Invalid workspace config: unsupported kind ${JSON.stringify(kind)}`);
  }
};

const resolveLegacyGitWorkspace = (
  jobConfig: Record<string, unknown>,
): ResolvedGitRepoWorkspace | null => {
  const repoUrl = asString(jobConfig.repoUrl) ?? asString(jobConfig.repositoryUrl);
  if (!repoUrl) return null;

  const repositoryId = asString(jobConfig.repositoryId);

  return {
    kind: "git_repo",
    repoUrl,
    ...(repositoryId ? { repositoryId } : {}),
    ref: asString(jobConfig.baseBranch) ?? "main",
    source: "legacy",
  };
};

const resolveProjectGitWorkspace = (
  projectRepository: ProjectRepository | undefined,
): ResolvedGitRepoWorkspace | null => {
  if (!projectRepository?.url) return null;

  return {
    kind: "git_repo",
    repoUrl: projectRepository.url,
    ...(projectRepository.repositoryId ? { repositoryId: projectRepository.repositoryId } : {}),
    ref: projectRepository.branch || "main",
    source: "project",
  };
};

const isRepositoryOptional = (
  job: ClaimedJob,
  jobConfig: Record<string, unknown>,
): boolean => {
  const skillName = String(
    job.promptTemplate ??
      job.skillName ??
      asString(jobConfig.skillName) ??
      "",
  ).toLowerCase();

  return (
    job.interactive === true ||
    job.jobType === "planning" ||
    skillName.includes("plan") ||
    skillName.includes("ideate")
  );
};

export const resolveAgentWorkspace = ({
  job,
  jobConfig,
  projectRepository,
}: ResolveAgentWorkspaceInput): ResolvedAgentWorkspace => {
  const legacyWorkspace = resolveLegacyGitWorkspace(jobConfig);
  const explicitRepositoryFallback = legacyWorkspace
    ? {
        repositoryId: legacyWorkspace.repositoryId,
        url: legacyWorkspace.repoUrl,
        branch: legacyWorkspace.ref,
      }
    : projectRepository;

  const explicitWorkspace = resolveExplicitWorkspace(
    jobConfig.workspace,
    explicitRepositoryFallback,
  );
  if (explicitWorkspace) {
    return {
      ...explicitWorkspace,
      source: "explicit",
    } as ResolvedAgentWorkspace;
  }

  if (legacyWorkspace) return legacyWorkspace;

  const projectWorkspace = resolveProjectGitWorkspace(projectRepository);
  if (projectWorkspace) return projectWorkspace;

  if (isRepositoryOptional(job, jobConfig)) {
    return {
      kind: "empty_workspace",
      source: "implicit",
    };
  }

  throw new Error(
    `No repository configured for project ${job.projectId ?? "unknown"}. ` +
      "Ensure the project has a repository in project_repositories.",
  );
};

export const assertRunnableAgentWorkspace = (
  workspace: ResolvedAgentWorkspace,
): RunnableAgentWorkspace => {
  if (workspace.kind === "git_repo" || workspace.kind === "empty_workspace") {
    return workspace;
  }

  if (workspace.kind === "uploaded_files") {
    return workspace;
  }

  throw new Error(
    `Workspace kind "${workspace.kind}" is not supported by this runner yet`,
  );
};

export const toRepositoryOverride = (
  workspace: ResolvedAgentWorkspace | null | undefined,
): RepositoryOverride => {
  if (!workspace) return {};
  if (workspace.kind !== "git_repo") {
    return workspace.kind === "uploaded_files"
      ? { workspaceKind: "uploaded_files" }
      : {};
  }

  return {
    ...(workspace.repositoryId ? { id: workspace.repositoryId } : {}),
    ...(workspace.repoUrl ? { url: workspace.repoUrl } : {}),
    branch: workspace.ref,
    ...(workspace.depth ? { depth: workspace.depth } : {}),
  };
};

export const withGitWorkspaceRef = (
  workspace: RunnableAgentWorkspace,
  ref: string,
): RunnableAgentWorkspace => {
  if (workspace.kind !== "git_repo") return workspace;

  return {
    ...workspace,
    ref,
  };
};
