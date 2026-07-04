import { afterAll, describe, expect, it, mock } from "bun:test";
import {
  createDatabaseMocks,
  createGithubServiceMock,
  createLoggerMock,
  createResponseMocks,
  restoreRealModules,
  withTestOrg,
} from "../../../../test/mocks";

// Projects that belong to the active test workspace.
const AUTHORIZED_IDS = ["proj-1", "proj-2"];

// Reuses the SAME per-project logic (getGithubSummaryForProject) the single
// endpoint uses; the batch route just iterates it. Mock returns a distinct
// summary per id so we can assert the map is keyed correctly.
mock.module("@almirant/database", () =>
  createDatabaseMocks({
    getProjectById: async (_orgId: string, id: string) =>
      AUTHORIZED_IDS.includes(id) ? { id, name: `Project ${id}` } : null,
    getGithubSummaryForProject: async (id: string) => ({
      openPrs: id === "proj-1" ? 3 : 1,
      latestCommitDate: null,
      latestWorkflowConclusion: null,
      totalCommits: id === "proj-1" ? 10 : 5,
      totalContributors: 2,
    }),
  }),
);

mock.module("../services/github-service", () =>
  createGithubServiceMock({
    isGithubConfigured: () => true,
    isGithubConfiguredAsync: async () => true,
  }),
);

mock.module("../services/github-sync", () => ({
  syncProjectGithubData: async () => {},
}));

mock.module("../../../../shared/services/response", () => createResponseMocks());
mock.module("@almirant/config", () => createLoggerMock());
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

const postJson = (path: string, data: unknown) =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });

describe("POST /github/projects/summaries", () => {
  it("returns a summary map keyed by every requested projectId in a single call", async () => {
    const app = await makeApp();
    const res = await app.handle(
      postJson("/github/projects/summaries", {
        projectIds: ["proj-1", "proj-2"],
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: Record<string, { openPrs: number; totalCommits: number }>;
    };

    expect(body.success).toBe(true);
    expect(Object.keys(body.data).sort()).toEqual(["proj-1", "proj-2"]);
    expect(body.data["proj-1"]!.openPrs).toBe(3);
    expect(body.data["proj-1"]!.totalCommits).toBe(10);
    expect(body.data["proj-2"]!.openPrs).toBe(1);
  });

  it("omits projects that do not belong to the active workspace", async () => {
    const app = await makeApp();
    const res = await app.handle(
      postJson("/github/projects/summaries", {
        projectIds: ["proj-1", "proj-foreign"],
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: Record<string, unknown>;
    };

    expect(body.success).toBe(true);
    expect(Object.keys(body.data)).toEqual(["proj-1"]);
    expect(body.data["proj-foreign"]).toBeUndefined();
  });

  it("returns an empty map when no projectIds are provided", async () => {
    const app = await makeApp();
    const res = await app.handle(
      postJson("/github/projects/summaries", { projectIds: [] }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: Record<string, unknown>;
    };
    expect(body.success).toBe(true);
    expect(body.data).toEqual({});
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
});
