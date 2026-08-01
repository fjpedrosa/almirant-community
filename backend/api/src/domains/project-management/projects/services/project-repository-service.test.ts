import { beforeEach, describe, expect, it, mock } from "bun:test";
import { createProjectRepositoryService } from "./project-repository-service";

const state = { repositories: [] as Array<Record<string, unknown>> };
const deps = {
  attachRepositoryAtomically: mock(async (_workspaceId: string, projectId: string, data: Record<string, unknown>) => {
    const existing = state.repositories.find((repository) => repository.url === data.url);
    if (existing) return { repository: existing, created: false };
    const repository = { id: "repo-new", projectId, ...data };
    state.repositories.push(repository);
    return { repository, created: true };
  }),
  getActiveGithubConnectionsForWorkspace: mock(async () => [
    { id: "wrong", config: { installationId: 101 } },
    { id: "right", config: { installationId: 202 } },
  ]),
  fetchInstallationRepositories: mock(async (id: number, page: number = 1) => ({ total_count: 1, repositories: id === 202 && page === 1
    ? [{ full_name: "almirant-ai/almirant", default_branch: "develop" }]
    : [{ full_name: "other/repo", default_branch: "main" }] })),
  linkRepoToInstallation: mock(async (data: Record<string, unknown>) => data),
  getInstallationByRepoId: mock(async () => null as Record<string, unknown> | null),
};
const input = { workspaceId: "workspace-1", projectId: "project-1", name: "Almirant", url: "https://github.com/almirant-ai/almirant", provider: "github" as const, isMonorepo: true };

beforeEach(() => { state.repositories = []; for (const fn of Object.values(deps)) fn.mockClear(); });

describe("project repository service", () => {
  it("normalizes URLs and makes duplicate project URLs idempotent", async () => {
    const service = createProjectRepositoryService(deps as never);
    await service.attach({ ...input, url: "https://github.com/Almirant-AI/Almirant.git/" });
    const duplicate = await service.attach(input);
    expect(deps.attachRepositoryAtomically).toHaveBeenCalledTimes(2);
    expect(state.repositories[0]!.url).toBe(input.url);
    expect(duplicate).toMatchObject({ created: false, githubInstallationLinked: true, repository: { id: "repo-new" } });
  });

  it("rejects malformed GitHub URLs before persistence", async () => {
    const service = createProjectRepositoryService(deps as never);
    expect(service.attach({ ...input, url: "https://example.com/nope" })).rejects.toThrow("valid GitHub repository URL");
    expect(deps.attachRepositoryAtomically).not.toHaveBeenCalled();
  });

  it.each([
    "http://example.com/acme/repo",
    "https://user:secret@example.com/acme/repo",
    "https://example.com/acme/repo?token=secret",
    "https://example.com/acme/repo#fragment",
    "https://localhost/acme/repo",
    "https://127.0.0.1/acme/repo",
    "https://10.1.2.3/acme/repo",
    "https://172.16.2.3/acme/repo",
    "https://192.168.2.3/acme/repo",
    "https://169.254.2.3/acme/repo",
    "https://[::1]/acme/repo",
    "https://[fc00::1]/acme/repo",
    "https://example.com:444/acme/repo",
  ])("rejects unsafe repository URL %s", async (url) => {
    const service = createProjectRepositoryService(deps as never);
    expect(service.attach({ ...input, provider: "other", url })).rejects.toThrow("URL must");
    expect(deps.attachRepositoryAtomically).not.toHaveBeenCalled();
  });

  it.each([
    "https://user:secret@github.com/acme/repo",
    "https://github.com/acme/repo?token=secret",
    "https://github.com/acme/repo#fragment",
    "https://github.com:444/acme/repo",
    "https://github.com/acme/repo/issues",
    "https://github.com/acme/.git",
  ])("rejects unsafe or non-repository GitHub URL %s", async (url) => {
    const service = createProjectRepositoryService(deps as never);
    expect(service.attach({ ...input, url })).rejects.toThrow("valid GitHub repository URL");
    expect(deps.attachRepositoryAtomically).not.toHaveBeenCalled();
  });

  it("preserves the requested REST order in persistence", async () => {
    await createProjectRepositoryService(deps as never).attach({ ...input, order: 7 });
    expect(deps.attachRepositoryAtomically.mock.calls[0]![2]).toMatchObject({ order: 7 });
  });

  it("selects the installation that exposes the repository, not the first account", async () => {
    const service = createProjectRepositoryService(deps as never);
    const result = await service.attach(input);
    expect(deps.linkRepoToInstallation.mock.calls[0]![0]).toMatchObject({ installationId: "right", repoId: "repo-new", defaultBranch: "develop" });
    expect(result.githubInstallationLinked).toBe(true);
  });

  it("searches a bounded second installation page before deciding no match", async () => {
    deps.fetchInstallationRepositories.mockImplementation(async (id: number, page: number = 1) => ({
      total_count: 101,
      repositories: id === 202 && page === 2
        ? [{ full_name: "almirant-ai/almirant", default_branch: "develop" }]
        : Array.from({ length: 100 }, (_, index) => ({ full_name: `other/repo-${index}`, default_branch: "main" })),
    }) as never);
    const result = await createProjectRepositoryService(deps as never).attach(input);
    expect(deps.fetchInstallationRepositories).toHaveBeenCalledWith(202, 2, 100);
    expect(result.githubInstallationLinked).toBe(true);
  });

  it("does not link an unrelated account when none exposes the repository", async () => {
    deps.getActiveGithubConnectionsForWorkspace.mockImplementationOnce(async () => [{ id: "wrong", config: { installationId: 101 } }] as never);
    await createProjectRepositoryService(deps as never).attach(input);
    expect(deps.linkRepoToInstallation).not.toHaveBeenCalled();
  });

  it("reports an existing repository installation link as linked", async () => {
    state.repositories = [{ id: "repo-existing", ...input }];
    deps.getInstallationByRepoId.mockImplementationOnce(async () => ({ installationId: 202 }));
    const result = await createProjectRepositoryService(deps as never).attach(input);
    expect(result).toMatchObject({ created: false, githubInstallationLinked: true });
    expect(deps.fetchInstallationRepositories).not.toHaveBeenCalled();
    expect(deps.linkRepoToInstallation).not.toHaveBeenCalled();
  });

  it("repairs an existing repository that was persisted without an installation link", async () => {
    state.repositories = [{ id: "repo-existing", ...input }];
    const result = await createProjectRepositoryService(deps as never).attach(input);
    expect(result).toMatchObject({ created: false, githubInstallationLinked: true });
    expect(deps.linkRepoToInstallation.mock.calls[0]![0]).toMatchObject({ repoId: "repo-existing", installationId: "right" });
  });

  it("continues to another installation when one GitHub lookup fails", async () => {
    deps.fetchInstallationRepositories.mockImplementation(async (id: number) => {
      if (id === 101) throw new Error("sensitive upstream failure");
      return { total_count: 1, repositories: [{ full_name: "almirant-ai/almirant", default_branch: "develop" }] } as never;
    });
    const result = await createProjectRepositoryService(deps as never).attach(input);
    expect(result.githubInstallationLinked).toBe(true);
    expect(deps.linkRepoToInstallation.mock.calls[0]![0]).toMatchObject({ installationId: "right" });
  });

  it("uses the atomic persistence result as the source of created status", async () => {
    deps.attachRepositoryAtomically.mockImplementationOnce(async () => ({
      repository: { id: "repo-concurrent", ...input },
      created: false,
    }) as never);
    const result = await createProjectRepositoryService(deps as never).attach(input);
    expect(result.created).toBe(false);
    expect(result.repository.id).toBe("repo-concurrent");
  });
});
