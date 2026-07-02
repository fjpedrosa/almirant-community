import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  createDatabaseMocks,
  createGithubServiceMock,
  createLoggerMock,
  createResponseMocks,
  restoreRealModules,
  withTestOrg,
} from "../../../../test/mocks";

const syncInstallationsFromGithubSpy = mock(async () => [
  {
    id: 999,
    account: {
      login: "cuenta-ajena",
      type: "Organization",
      avatar_url: "https://example.com/avatar.png",
    },
    permissions: {},
    repository_selection: "all",
  },
]);

const upsertInstallationSpy = mock(async () => ({
  id: "conn-1",
  installationId: 999,
  accountLogin: "cuenta-ajena",
  accountType: "organization",
}));

let githubConfigured = true;

mock.module("@almirant/database", () =>
  createDatabaseMocks({
    getInstallations: async () => [],
    getLinkedReposByInstallation: async () => [],
    upsertInstallation: upsertInstallationSpy,
    getUnlinkedGithubReposForWorkspace: async () => [],
  }),
);

mock.module("../services/github-service", () =>
  createGithubServiceMock({
    isGithubConfigured: () => githubConfigured,
    isGithubConfiguredAsync: async () => githubConfigured,
    syncInstallationsFromGithub: syncInstallationsFromGithubSpy,
  }),
);

mock.module("../services/github-sync", () => ({
  syncProjectGithubData: async () => {},
}));

mock.module("../../../../shared/services/response", () => createResponseMocks());

const loggerMock = createLoggerMock();
mock.module("@almirant/config", () => loggerMock);

mock.module("../../../../shared/ws/ws-connection-manager", () => ({
  wsConnectionManager: {
    broadcastToWorkspace: () => {},
    sendToUser: () => {},
  },
}));

const makeApp = async () => {
  const { Elysia } = await import("elysia");
  const { githubRoutes } = await import("./github.routes");
  return new Elysia().use(withTestOrg).use(githubRoutes);
};

describe("GET /github/status", () => {
  beforeEach(() => {
    githubConfigured = true;
    syncInstallationsFromGithubSpy.mockClear();
    upsertInstallationSpy.mockClear();
  });

  it("no expone ni persiste instalaciones globales cuando el workspace no tiene conexiones GitHub", async () => {
    const app = await makeApp();
    const res = await app.handle(new Request("http://localhost/github/status"));

    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      success: boolean;
      data: {
        configured: boolean;
        installations: Array<{ installationId: number; accountLogin: string }>;
      };
    };

    expect(body.success).toBe(true);
    expect(body.data.configured).toBe(true);
    expect(body.data.installations).toEqual([]);
    expect(syncInstallationsFromGithubSpy).not.toHaveBeenCalled();
    expect(upsertInstallationSpy).not.toHaveBeenCalled();
  });
});

describe("GET /github/installations", () => {
  beforeEach(() => {
    githubConfigured = true;
    syncInstallationsFromGithubSpy.mockClear();
    upsertInstallationSpy.mockClear();
  });

  it("lista solo instalaciones conectadas del workspace actual", async () => {
    const app = await makeApp();
    const res = await app.handle(new Request("http://localhost/github/installations"));

    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      success: boolean;
      data: Array<{ installationId: number; accountLogin: string }>;
    };

    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
    expect(syncInstallationsFromGithubSpy).not.toHaveBeenCalled();
    expect(upsertInstallationSpy).not.toHaveBeenCalled();
  });
});


describe("GET /github/available-installations", () => {
  beforeEach(() => {
    githubConfigured = true;
    syncInstallationsFromGithubSpy.mockClear();
    upsertInstallationSpy.mockClear();
  });

  it("rechaza con mensaje de setup cuando la GitHub App de instancia no está configurada", async () => {
    githubConfigured = false;
    const app = await makeApp();
    const res = await app.handle(new Request("http://localhost/github/available-installations"));

    expect(res.status).toBe(400);

    const body = (await res.json()) as { success: boolean; error: string };

    expect(body.success).toBe(false);
    expect(body.error).toContain("/settings/github");
    expect(syncInstallationsFromGithubSpy).not.toHaveBeenCalled();
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
});
