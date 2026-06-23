import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";
import {
  createDatabaseMocks,
  createResponseMocks,
  restoreRealModules,
} from "../../../test/mocks";
import { AUTOMATION_BOT_USER_ID } from "../../../shared/services/session-token";

type Job = {
  id: string;
  organizationId: string;
  projectId: string;
  createdByUserId: string | null;
  promptTemplate: string | null;
  skillName?: string | null;
  jobType?: string | null;
};

const state = {
  projectsBelongToOrg: true,
  apiKey: {
    allowedIssuedPermissions: ["mcp:read", "mcp:write", "mcp:internal"] as string[] | null,
  },
  jobs: {} as Record<string, Job>,
};

const dbMocks = createDatabaseMocks({
  validateApiKey: async () => state.apiKey,
  getJobById: async (id: string) => {
    const job = state.jobs[id];
    return job ? { job } : null;
  },
});

mock.module("@almirant/database", () => ({
  ...dbMocks,
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (state.projectsBelongToOrg ? [{ id: "project-1" }] : []),
        }),
      }),
    }),
  },
  projects: {},
  eq: (...args: unknown[]) => args,
  and: (...args: unknown[]) => args,
}));
mock.module("../../../shared/services/response", () => createResponseMocks());
mock.module("@almirant/config", () => ({
  env: { ENCRYPTION_KEY: "0".repeat(64) },
}));

const makeRequest = (body: unknown): Request =>
  new Request("http://localhost/workers/session-token", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer test-key",
    },
    body: JSON.stringify(body),
  });

describe("POST /workers/session-token — mcp:internal guard", () => {
  beforeEach(() => {
    state.projectsBelongToOrg = true;
    state.apiKey = {
      allowedIssuedPermissions: ["mcp:read", "mcp:write", "mcp:internal"],
    };
    state.jobs = {};
  });

  it("rejects mcp:internal when no jobId is supplied", async () => {
    const { workerSessionTokenRoutes } = await import("./worker-session-token.routes");
    const app = new Elysia().use(workerSessionTokenRoutes);

    const res = await app.handle(
      makeRequest({
        projectId: "project-1",
        organizationId: "org-1",
        permissions: ["mcp:read", "mcp:write", "mcp:internal"],
      })
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as { success: boolean; error?: string };
    expect(body.error).toMatch(/system-initiated internal job/i);
  });

  it("rejects mcp:internal when the job was created by a human user", async () => {
    state.jobs["job-user"] = {
      id: "job-user",
      organizationId: "org-1",
      projectId: "project-1",
      createdByUserId: "user-abc", // real human
      promptTemplate: "feedback-triage", // internal skill
    };
    const { workerSessionTokenRoutes } = await import("./worker-session-token.routes");
    const app = new Elysia().use(workerSessionTokenRoutes);

    const res = await app.handle(
      makeRequest({
        projectId: "project-1",
        organizationId: "org-1",
        jobId: "job-user",
        permissions: ["mcp:read", "mcp:write", "mcp:internal"],
      })
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as { success: boolean; error?: string };
    expect(body.error).toMatch(/system-initiated jobs bound to an internal skill/i);
  });

  it("rejects mcp:internal when the job is system-owned but skill is not internal", async () => {
    state.jobs["job-sys-public"] = {
      id: "job-sys-public",
      organizationId: "org-1",
      projectId: "project-1",
      createdByUserId: null, // system
      promptTemplate: "implement", // public skill
    };
    const { workerSessionTokenRoutes } = await import("./worker-session-token.routes");
    const app = new Elysia().use(workerSessionTokenRoutes);

    const res = await app.handle(
      makeRequest({
        projectId: "project-1",
        organizationId: "org-1",
        jobId: "job-sys-public",
        permissions: ["mcp:read", "mcp:write", "mcp:internal"],
      })
    );

    expect(res.status).toBe(403);
  });

  it("allows mcp:internal for a system-owned job bound to an internal skill", async () => {
    state.jobs["job-sys-internal"] = {
      id: "job-sys-internal",
      organizationId: "org-1",
      projectId: "project-1",
      createdByUserId: null,
      promptTemplate: "feedback-triage",
    };
    const { workerSessionTokenRoutes } = await import("./worker-session-token.routes");
    const app = new Elysia().use(workerSessionTokenRoutes);

    const res = await app.handle(
      makeRequest({
        projectId: "project-1",
        organizationId: "org-1",
        jobId: "job-sys-internal",
        permissions: ["mcp:read", "mcp:write", "mcp:internal"],
      })
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { token: string; expiresAt: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.token).toMatch(/^st_/);
  });

  it("allows mcp:internal for a job created by the automation bot", async () => {
    state.jobs["job-bot"] = {
      id: "job-bot",
      organizationId: "org-1",
      projectId: "project-1",
      createdByUserId: AUTOMATION_BOT_USER_ID,
      promptTemplate: "feedback-bug-fix",
    };
    const { workerSessionTokenRoutes } = await import("./worker-session-token.routes");
    const app = new Elysia().use(workerSessionTokenRoutes);

    const res = await app.handle(
      makeRequest({
        projectId: "project-1",
        organizationId: "org-1",
        jobId: "job-bot",
        permissions: ["mcp:read", "mcp:write", "mcp:internal"],
      })
    );

    expect(res.status).toBe(200);
  });

  it("does not affect the happy path for standard permissions", async () => {
    state.jobs["job-regular"] = {
      id: "job-regular",
      organizationId: "org-1",
      projectId: "project-1",
      createdByUserId: "user-abc",
      promptTemplate: "implement",
    };
    const { workerSessionTokenRoutes } = await import("./worker-session-token.routes");
    const app = new Elysia().use(workerSessionTokenRoutes);

    const res = await app.handle(
      makeRequest({
        projectId: "project-1",
        organizationId: "org-1",
        jobId: "job-regular",
        permissions: ["mcp:read", "mcp:write"],
      })
    );

    expect(res.status).toBe(200);
  });

  it("embeds body.jobId into the signed session token so INV-4 can match ai_sessions.agent_job_id", async () => {
    state.jobs["job-inv4"] = {
      id: "job-inv4",
      organizationId: "org-1",
      projectId: "project-1",
      createdByUserId: "user-abc",
      promptTemplate: "runner-implement",
    };
    const { workerSessionTokenRoutes } = await import("./worker-session-token.routes");
    const { verifySessionToken } = await import(
      "../../../shared/services/session-token"
    );
    const app = new Elysia().use(workerSessionTokenRoutes);

    const res = await app.handle(
      makeRequest({
        projectId: "project-1",
        organizationId: "org-1",
        jobId: "job-inv4",
        permissions: ["mcp:read", "mcp:write"],
      })
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { token: string };
    };
    const payload = verifySessionToken(body.data.token, "0".repeat(64));
    expect(payload?.jobId).toBe("job-inv4");
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
});
