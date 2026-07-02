import { afterAll, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";
import {
  createDatabaseMocks,
  createGithubServiceMock,
  createLoggerMock,
  createResponseMocks,
  createS3Mock,
  createWsMock,
  restoreRealModules,
} from "../../../test/mocks";
import { testWorkspace } from "../../../test/fixtures";

const state = {
  s3Downloads: [] as string[],
};

const existingJob = {
  id: "job-1",
  status: "running" as const,
  workerId: "worker-1",
  workItemId: "work-item-1",
  planningSessionId: null,
  jobType: "implementation" as const,
  createdByUserId: null,
  workspaceId: testWorkspace.id,
  config: {
    workspace: {
      kind: "uploaded_files",
      fileIds: ["attachment-1"],
    },
  },
};

const attachment = {
  id: "attachment-1",
  workItemId: "work-item-1",
  fileName: "input.txt",
  fileUrl: "https://s3.example.test/work-items/work-item-1/attachment-1-input.txt",
  fileSize: 5,
  mimeType: "text/plain",
  uploadedBy: "user-1",
  metadata: {
    storage: "s3",
    key: "work-items/work-item-1/attachment-1-input.txt",
    workspacePath: "docs/input.txt",
  },
  createdAt: new Date("2026-05-02T12:00:00.000Z"),
};

const dbMocks = createDatabaseMocks({
  validateApiKey: async () => ({
    id: "worker-api-key",
    workspaceId: "shared-runner-org",
    allowedIssuedPermissions: ["mcp:read", "mcp:write"],
  }),
  getJobById: async (id: string) => {
    if (id !== existingJob.id) return null;
    return {
      job: existingJob,
      workItem: null,
      project: null,
      board: null,
      planningSession: null,
      createdByUser: null,
    };
  },
  getAttachment: async (workspaceId: string, id: string) => {
    if (workspaceId !== testWorkspace.id || id !== attachment.id) return null;
    return attachment;
  },
});

mock.module("@almirant/database", () => dbMocks);
const loggerMocks = createLoggerMock();
mock.module("@almirant/config", () => ({
  ...loggerMocks,
  env: {
    ...loggerMocks.env,
    ENCRYPTION_KEY: "test-encryption-key",
  },
}));
mock.module("../../../shared/services/response", () => createResponseMocks());
mock.module("../../../shared/ws/ws-connection-manager", () => createWsMock());
mock.module("../../integrations/github/services/github-service", () => createGithubServiceMock({
  getInstallationAccessToken: async () => "gh-token",
  fetchFromGithub: async () => ({}),
}));
mock.module("../../../shared/services/s3-service", () => ({
  ...createS3Mock(),
  isS3Configured: () => true,
  downloadBufferFromS3: async (key: string) => {
    state.s3Downloads.push(key);
    return Buffer.from("hello");
  },
  extractKeyFromUrl: (url: string) => url.split(".test/")[1] ?? null,
}));
mock.module("../../../shared/services/local-attachments", () => ({
  resolveLocalAttachmentPath: (key: string) => `/tmp/${key}`,
  writeLocalAttachment: async () => {},
  deleteLocalAttachment: async () => {},
}));

const makeRequest = (path: string): Request =>
  new Request(`http://localhost${path}`, {
    method: "GET",
    headers: {
      authorization: "Bearer worker-secret",
    },
  });

describe("workersRoutes GET /workers/jobs/:jobId/workspace-files/:fileId", () => {
  it("downloads only files declared by the job uploaded_files workspace", async () => {
    state.s3Downloads = [];
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(
      makeRequest("/workers/jobs/job-1/workspace-files/attachment-1"),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        id: string;
        fileName: string;
        fileSize: number;
        mimeType: string;
        contentBase64: string;
        workspacePath?: string;
      };
    };

    expect(body.success).toBe(true);
    expect(body.data).toEqual({
      id: "attachment-1",
      fileName: "input.txt",
      fileSize: 5,
      mimeType: "text/plain",
      contentBase64: Buffer.from("hello").toString("base64"),
      workspacePath: "docs/input.txt",
    });
    expect(state.s3Downloads).toEqual(["work-items/work-item-1/attachment-1-input.txt"]);
  });

  it("rejects attachment IDs not listed in the job workspace", async () => {
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(
      makeRequest("/workers/jobs/job-1/workspace-files/attachment-2"),
    );

    expect(res.status).toBe(403);
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
});
