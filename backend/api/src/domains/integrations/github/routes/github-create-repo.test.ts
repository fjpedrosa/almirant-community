import { afterAll, describe, expect, it, mock, beforeEach } from "bun:test";
import {
  createDatabaseMocks,
  createResponseMocks,
  createLoggerMock,
  createGithubServiceMock,
  restoreRealModules,
  withTestOrg,
} from "../../../../test/mocks";

// ── Spies for GitHub service functions ──────────────────────────────────────

const createRepositorySpy = mock(async () => ({
  id: 12345,
  name: "my-repo",
  full_name: "test-org/my-repo",
  html_url: "https://github.com/test-org/my-repo",
  default_branch: "main",
  private: true,
  description: "A test repository",
}));

const createRepositoryWithUserTokenSpy = mock(async () => ({
  id: 67890,
  name: "my-repo",
  full_name: "test-user/my-repo",
  html_url: "https://github.com/test-user/my-repo",
  default_branch: "main",
  private: true,
  description: "A test repository",
}));

// ── Connection fixtures ─────────────────────────────────────────────────────

const orgConnection = {
  id: "conn-org-1",
  provider: "github",
  accountIdentifier: "test-org",
  config: { installationId: 111, accountType: "organization" },
};

const userConnection = {
  id: "conn-user-1",
  provider: "github",
  accountIdentifier: "test-user",
  config: { installationId: 222, accountType: "user" },
};

const oauthConnection = {
  id: "oauth-1",
  provider: "github",
  scope: "user",
  userId: "user-test-1",
};

// ── Module mocks ────────────────────────────────────────────────────────────

mock.module("@almirant/database", () =>
  createDatabaseMocks({
    getInstallationByGithubId: async (ghId: number) => {
      if (ghId === 111) return orgConnection;
      if (ghId === 222) return userConnection;
      return null;
    },
    findActiveConnection: async (_provider: string, _scope: string, userId: string) => {
      if (userId === "user-test-1") return oauthConnection;
      return null;
    },
    decryptCredentials: () => ({ apiKey: "ghp_test_oauth_token" }),
  })
);

mock.module("../services/github-service", () => createGithubServiceMock({
  createRepository: createRepositorySpy,
  createRepositoryWithUserToken: createRepositoryWithUserTokenSpy,
}));

mock.module("../services/github-sync", () => ({
  syncProjectGithubData: async () => {},
}));

mock.module("../../../../shared/services/response", () => createResponseMocks());

const loggerMock = createLoggerMock();
mock.module("@almirant/config", () => ({
  ...loggerMock,
  env: {
    ...loggerMock.env,
    ENCRYPTION_KEY: "test-encryption-key-32-chars-long!",
  },
}));

mock.module("../../../../shared/ws/ws-connection-manager", () => ({
  wsConnectionManager: {
    broadcastToOrganization: () => {},
    sendToUser: () => {},
  },
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

const makeApp = async () => {
  const { Elysia } = await import("elysia");
  const { githubRoutes } = await import("./github.routes");
  return new Elysia().use(withTestOrg).use(githubRoutes);
};

const postJson = (path: string, data: unknown): Request =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });

// ── Tests ───────────────────────────────────────────────────────────────────

describe("POST /github/installations/:installationId/repos", () => {
  beforeEach(() => {
    createRepositorySpy.mockClear();
    createRepositoryWithUserTokenSpy.mockClear();
  });

  it("uses installation token for organization accounts", async () => {
    const app = await makeApp();
    const res = await app.handle(
      postJson("/github/installations/111/repos", {
        name: "my-repo",
        description: "A test repository",
        isPrivate: true,
      })
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.data.full_name).toBe("test-org/my-repo");

    expect(createRepositorySpy).toHaveBeenCalledTimes(1);
    expect(createRepositoryWithUserTokenSpy).toHaveBeenCalledTimes(0);
  });

  it("tries installation token first for personal accounts", async () => {
    const app = await makeApp();
    const res = await app.handle(
      postJson("/github/installations/222/repos", {
        name: "my-repo",
        description: "A test repository",
        isPrivate: true,
      })
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);

    // Should try installation token first (same as org accounts)
    expect(createRepositorySpy).toHaveBeenCalledTimes(1);
    expect(createRepositoryWithUserTokenSpy).toHaveBeenCalledTimes(0);
  });

  it("falls back to OAuth when installation token gets 403 on personal account", async () => {
    // Make installation token fail with 403
    createRepositorySpy.mockImplementationOnce(async () => {
      throw new Error('GitHub API 403 on POST /user/repos: {"message":"Resource not accessible by integration"}');
    });

    const app = await makeApp();
    const res = await app.handle(
      postJson("/github/installations/222/repos", {
        name: "my-repo",
        isPrivate: true,
      })
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.data.full_name).toBe("test-user/my-repo");

    // Installation token tried first, then OAuth fallback
    expect(createRepositorySpy).toHaveBeenCalledTimes(1);
    expect(createRepositoryWithUserTokenSpy).toHaveBeenCalledTimes(1);
  });

  it("does not fall back to OAuth for org accounts on 403", async () => {
    createRepositorySpy.mockImplementationOnce(async () => {
      throw new Error('GitHub API 403: {"message":"Resource not accessible by integration"}');
    });

    const app = await makeApp();
    const res = await app.handle(
      postJson("/github/installations/111/repos", {
        name: "my-repo",
      })
    );

    // Org accounts should NOT fall back to OAuth — just report the error
    expect(res.status).toBe(500);
    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
    expect(body.error).toContain("403");

    expect(createRepositorySpy).toHaveBeenCalledTimes(1);
    expect(createRepositoryWithUserTokenSpy).toHaveBeenCalledTimes(0);
  });

  it("returns 404 when installation is not found", async () => {
    const app = await makeApp();
    const res = await app.handle(
      postJson("/github/installations/999/repos", { name: "my-repo" })
    );

    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
    expect(body.error).toContain("not found");
  });

  it("returns 400 for invalid repo names", async () => {
    const app = await makeApp();
    const res = await app.handle(
      postJson("/github/installations/111/repos", { name: "invalid repo name!" })
    );

    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
    expect(body.error).toContain("Invalid repository name");
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
});
