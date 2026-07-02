import { describe, expect, it } from "bun:test";
import type { ClaimedJob } from "@almirant/remote-agent";
import {
  assertRunnableAgentWorkspace,
  resolveAgentWorkspace,
  toRepositoryOverride,
} from "./agent-workspace";

const baseJob = (overrides: Partial<ClaimedJob> = {}): ClaimedJob => ({
  id: "job-1",
  workItemId: null,
  projectId: "project-1",
  boardId: null,
  createdByUserId: "user-1",
  workspaceId: "org-1",
  jobType: "implementation",
  provider: "codex",
  priority: "medium",
  status: "queued",
  retryCount: 0,
  maxRetries: 2,
  availableAt: null,
  config: null,
  ...overrides,
});

describe("resolveAgentWorkspace", () => {
  it("uses explicit git_repo workspace before legacy repository fields", () => {
    const workspace = resolveAgentWorkspace({
      job: baseJob(),
      jobConfig: {
        repoUrl: "https://github.com/legacy/repo.git",
        repositoryId: "legacy-repo",
        baseBranch: "legacy-branch",
        workspace: {
          kind: "git_repo",
          repoUrl: "https://github.com/new/repo.git",
          repositoryId: "new-repo",
          ref: "feature/workspace",
          depth: 50,
        },
      },
    });

    expect(workspace).toEqual({
      kind: "git_repo",
      repoUrl: "https://github.com/new/repo.git",
      repositoryId: "new-repo",
      ref: "feature/workspace",
      depth: 50,
      source: "explicit",
    });
    expect(toRepositoryOverride(workspace)).toEqual({
      id: "new-repo",
      url: "https://github.com/new/repo.git",
      branch: "feature/workspace",
      depth: 50,
    });
  });

  it("accepts branch as a git_repo alias while normalizing to ref", () => {
    const workspace = resolveAgentWorkspace({
      job: baseJob(),
      jobConfig: {
        workspace: {
          kind: "git_repo",
          repoUrl: "https://github.com/org/repo.git",
          branch: "feature/branch-alias",
        },
      },
    });

    expect(workspace).toEqual({
      kind: "git_repo",
      repoUrl: "https://github.com/org/repo.git",
      ref: "feature/branch-alias",
      source: "explicit",
    });
  });

  it("lets an explicit git_repo workspace override the ref while using the project repository", () => {
    const workspace = resolveAgentWorkspace({
      job: baseJob(),
      jobConfig: {
        workspace: {
          kind: "git_repo",
          branch: "release/next",
        },
      },
      projectRepository: {
        repositoryId: "project-repo",
        url: "https://github.com/org/project.git",
        branch: "main",
      },
    });

    expect(workspace).toEqual({
      kind: "git_repo",
      repoUrl: "https://github.com/org/project.git",
      repositoryId: "project-repo",
      ref: "release/next",
      source: "explicit",
    });
  });

  it("lets an explicit git_repo workspace override the ref while using legacy repository fields", () => {
    const workspace = resolveAgentWorkspace({
      job: baseJob(),
      jobConfig: {
        repoUrl: "https://github.com/legacy/repo.git",
        repositoryId: "legacy-repo",
        baseBranch: "develop",
        workspace: {
          kind: "git_repo",
          branch: "release/legacy",
        },
      },
    });

    expect(workspace).toEqual({
      kind: "git_repo",
      repoUrl: "https://github.com/legacy/repo.git",
      repositoryId: "legacy-repo",
      ref: "release/legacy",
      source: "explicit",
    });
  });

  it("fails fast when an explicit git_repo workspace cannot resolve a repository URL", () => {
    expect(() =>
      resolveAgentWorkspace({
        job: baseJob(),
        jobConfig: {
          workspace: {
            kind: "git_repo",
            branch: "main",
          },
        },
      }),
    ).toThrow("git_repo workspace requires repoUrl or a project repository");
  });

  it("derives git_repo workspace from legacy repository config", () => {
    const workspace = resolveAgentWorkspace({
      job: baseJob(),
      jobConfig: {
        repoUrl: "https://github.com/org/repo.git",
        repositoryId: "repo-1",
        baseBranch: "develop",
      },
    });

    expect(workspace).toEqual({
      kind: "git_repo",
      repoUrl: "https://github.com/org/repo.git",
      repositoryId: "repo-1",
      ref: "develop",
      source: "legacy",
    });
  });

  it("uses dynamically resolved project repository only when config has no workspace", () => {
    const workspace = resolveAgentWorkspace({
      job: baseJob(),
      jobConfig: {},
      projectRepository: {
        repositoryId: "project-repo",
        url: "https://github.com/org/project.git",
        branch: "main",
      },
    });

    expect(workspace).toEqual({
      kind: "git_repo",
      repoUrl: "https://github.com/org/project.git",
      repositoryId: "project-repo",
      ref: "main",
      source: "project",
    });
  });

  it("resolves repo-less planning jobs to an explicit empty workspace", () => {
    const workspace = resolveAgentWorkspace({
      job: baseJob({
        jobType: "planning",
        interactive: true,
      }),
      jobConfig: {},
    });

    expect(workspace).toEqual({
      kind: "empty_workspace",
      source: "implicit",
    });
    expect(toRepositoryOverride(workspace)).toEqual({});
  });

  it("allows an explicit empty workspace for non-repository implementation jobs", () => {
    const workspace = resolveAgentWorkspace({
      job: baseJob(),
      jobConfig: {
        workspace: {
          kind: "empty_workspace",
          templateId: "blank-typescript",
        },
      },
    });

    expect(workspace).toEqual({
      kind: "empty_workspace",
      templateId: "blank-typescript",
      source: "explicit",
    });
  });

  it("accepts template as an empty_workspace alias while normalizing to templateId", () => {
    const workspace = resolveAgentWorkspace({
      job: baseJob(),
      jobConfig: {
        workspace: {
          kind: "empty_workspace",
          template: "blank-bun",
        },
      },
    });

    expect(workspace).toEqual({
      kind: "empty_workspace",
      templateId: "blank-bun",
      source: "explicit",
    });
  });

  it("keeps the existing fail-fast behavior for implicit implementation jobs without repo", () => {
    expect(() =>
      resolveAgentWorkspace({
        job: baseJob(),
        jobConfig: {},
      }),
    ).toThrow("No repository configured for project project-1");
  });

  it("rejects workspace kinds that the runner does not support yet", () => {
    const workspace = resolveAgentWorkspace({
      job: baseJob(),
      jobConfig: {
        workspace: {
          kind: "uploaded_files",
          fileIds: ["file-1"],
        },
      },
    });

    expect(assertRunnableAgentWorkspace(workspace)).toEqual({
      kind: "uploaded_files",
      fileIds: ["file-1"],
      unpackMode: "flat",
      source: "explicit",
    });
    expect(toRepositoryOverride(workspace)).toEqual({
      workspaceKind: "uploaded_files",
    });
  });

  it("rejects uploaded_files workspaces without file IDs", () => {
    expect(() =>
      resolveAgentWorkspace({
        job: baseJob(),
        jobConfig: {
          workspace: {
            kind: "uploaded_files",
            fileIds: [],
          },
        },
      }),
    ).toThrow("uploaded_files workspace requires at least one fileId");
  });
});
