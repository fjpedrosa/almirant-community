import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
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

const packageBytes = Buffer.from(
  JSON.stringify({
    schemaVersion: 1,
    kind: "portable_skill",
    files: [
      {
        type: "file",
        path: "SKILL.md",
        contentBase64: Buffer.from("# Private review").toString("base64"),
      },
    ],
  }),
);
const packageChecksum = createHash("sha256").update(packageBytes).digest("hex");
const nativePackageBytes = Buffer.from(
  JSON.stringify({
    schemaVersion: 1,
    kind: "claude_plugin",
    files: [
      {
        type: "file",
        path: ".claude-plugin/plugin.json",
        contentBase64: Buffer.from(
          JSON.stringify({ name: "native-review", version: "1.0.0" }),
        ).toString("base64"),
      },
    ],
  }),
);
const nativePackageChecksum = createHash("sha256")
  .update(nativePackageBytes)
  .digest("hex");

const state = {
  s3Downloads: [] as Array<{ key: string; bucket?: string }>,
  serviceAccountId: "runner-service-account" as string | null,
};

const runtimeReference = {
  id: "plugin-1",
  slug: "private-review",
  name: "Private review",
  kind: "portable_skill" as const,
  provider: "portable" as const,
  sourceType: "upload" as const,
  version: "1.2.3",
  checksumSha256: packageChecksum,
};
const nativeRuntimeReference = {
  id: "plugin-native",
  slug: "native-review",
  name: "Native review",
  kind: "claude_upload" as const,
  provider: "claude-code" as const,
  sourceType: "upload" as const,
  version: "1.0.0",
  pluginName: "native-review",
  checksumSha256: nativePackageChecksum,
};

const existingJob = {
  id: "job-1",
  status: "running" as const,
  workerId: "worker-1",
  workItemId: null,
  planningSessionId: null,
  jobType: "scheduled" as const,
  createdByUserId: "user-1",
  workspaceId: testWorkspace.id,
  config: {
    agentPlugins: [runtimeReference, nativeRuntimeReference],
  },
};

const plugin = {
  id: "plugin-1",
  workspaceId: testWorkspace.id,
  name: "Private review",
  slug: "private-review",
  description: null,
  instructions: "Use the private review workflow.",
  ownerUserId: "user-1",
  visibility: "user" as const,
  provider: "portable" as const,
  sourceType: "upload" as const,
  marketplaceId: null,
  externalId: null,
  sourceReference: null,
  version: "1.2.3",
  checksumSha256: packageChecksum,
  storageObjectId: "storage-1",
  manifest: { schemaVersion: 1, kind: "portable_skill" },
  enabled: true,
  archivedAt: null,
  createdByUserId: "user-1",
  createdAt: new Date("2026-07-10T10:00:00.000Z"),
  updatedAt: new Date("2026-07-10T10:00:00.000Z"),
};

const storageObject = {
  id: "storage-1",
  ownerUserId: "user-1",
  workspaceId: testWorkspace.id,
  objectKey: "users/hashed/plugins/storage-1.json",
  virtualPath: "plugins/private-review.bundle.json",
  fileName: "private-review.bundle.json",
  contentType: "application/vnd.almirant.agent-plugin+json",
  sizeBytes: packageBytes.byteLength,
  checksumSha256: packageChecksum,
  kind: "plugin_bundle" as const,
  status: "ready" as const,
  metadata: {},
  reservationExpiresAt: null,
  createdAt: new Date("2026-07-10T10:00:00.000Z"),
  updatedAt: new Date("2026-07-10T10:00:00.000Z"),
};

const nativePlugin = {
  ...plugin,
  id: "plugin-native",
  name: "Native review",
  slug: "native-review",
  provider: "claude-code" as const,
  externalId: "native-review",
  version: "1.0.0",
  checksumSha256: nativePackageChecksum,
  storageObjectId: "storage-native",
  manifest: { schemaVersion: 1, kind: "claude_plugin" },
};

const nativeStorageObject = {
  ...storageObject,
  id: "storage-native",
  objectKey: "users/hashed/plugins/storage-native.json",
  virtualPath: "plugins/native-review.bundle.json",
  fileName: "native-review.bundle.json",
  sizeBytes: nativePackageBytes.byteLength,
  checksumSha256: nativePackageChecksum,
};

const dbMocks = createDatabaseMocks({
  validateApiKey: async () => ({
    id: "worker-api-key",
    workspaceId: "shared-runner-org",
    serviceAccountId: state.serviceAccountId,
    allowedIssuedPermissions: ["mcp:read", "mcp:write", "mcp:internal"],
  }),
  getJobById: async (id: string) =>
    id === existingJob.id
      ? {
          job: existingJob,
          workItem: null,
          project: null,
          board: null,
          planningSession: null,
          createdByUser: null,
        }
      : null,
  getAgentPluginById: async (id: string, workspaceId: string, ownerUserId: string) => {
    if (workspaceId !== testWorkspace.id || ownerUserId !== "user-1") return undefined;
    if (id === plugin.id) return plugin;
    if (id === nativePlugin.id) return nativePlugin;
    return undefined;
  },
  getUserStorageObject: async (ownerUserId: string, id: string) =>
    ownerUserId !== storageObject.ownerUserId
      ? undefined
      : id === storageObject.id
        ? storageObject
        : id === nativeStorageObject.id
          ? nativeStorageObject
          : undefined,
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
mock.module(
  "../../integrations/github/services/github-service",
  () =>
    createGithubServiceMock({
      getInstallationAccessToken: async () => "gh-token",
      fetchFromGithub: async () => ({}),
    }),
);
mock.module("../../../shared/services/s3-service", () => ({
  ...createS3Mock(),
  isS3Configured: () => true,
  getEditorUploadsBucket: () => "private-bucket",
  downloadBufferFromS3: async (key: string, bucket?: string) => {
    state.s3Downloads.push({ key, bucket });
    return key === nativeStorageObject.objectKey ? nativePackageBytes : packageBytes;
  },
}));
mock.module("../../../shared/services/local-attachments", () => ({
  resolveLocalAttachmentPath: (key: string) => `/tmp/${key}`,
  writeLocalAttachment: async () => {},
  deleteLocalAttachment: async () => {},
}));

const makeRequest = (pluginId: string): Request =>
  new Request(
    `http://localhost/workers/jobs/job-1/agent-plugins/${pluginId}/bundle`,
    {
      method: "GET",
      headers: { authorization: "Bearer worker-secret" },
    },
  );

describe("workersRoutes GET /workers/jobs/:jobId/agent-plugins/:pluginId/bundle", () => {
  beforeEach(() => {
    state.s3Downloads = [];
    state.serviceAccountId = "runner-service-account";
  });
  it("returns only a validated portable descriptor pinned in the job config", async () => {
    state.s3Downloads = [];
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(makeRequest("plugin-1"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        schemaVersion: number;
        pluginId: string;
        slug: string;
        kind: string;
        checksumSha256: string;
        files: Array<{ type: string; path: string; contentBase64: string }>;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data).toEqual({
      schemaVersion: 1,
      pluginId: "plugin-1",
      slug: "private-review",
      kind: "portable_skill",
      checksumSha256: packageChecksum,
      files: [
        {
          type: "file",
          path: "SKILL.md",
          contentBase64: Buffer.from("# Private review").toString("base64"),
        },
      ],
    });
    expect(state.s3Downloads).toEqual([
      { key: storageObject.objectKey, bucket: "private-bucket" },
    ]);
  });

  it("rejects plugin IDs that are not pinned in the job config", async () => {
    state.s3Downloads = [];
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(makeRequest("plugin-2"));

    expect(res.status).toBe(403);
    expect(state.s3Downloads).toEqual([]);
  });

  it("rejects ordinary user API keys before reading a private plugin bundle", async () => {
    state.s3Downloads = [];
    state.serviceAccountId = null;
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(makeRequest("plugin-1"));

    expect(res.status).toBe(403);
    expect(state.s3Downloads).toEqual([]);
    state.serviceAccountId = "runner-service-account";
  });

  it("returns a validated native Claude descriptor pinned in the job config", async () => {
    state.s3Downloads = [];
    const { workersRoutes } = await import("./workers.routes");
    const app = new Elysia().use(workersRoutes);

    const res = await app.handle(makeRequest("plugin-native"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({
      schemaVersion: 1,
      pluginId: "plugin-native",
      slug: "native-review",
      kind: "claude_plugin",
      checksumSha256: nativePackageChecksum,
    });
    expect(state.s3Downloads).toEqual([
      { key: nativeStorageObject.objectKey, bucket: "private-bucket" },
    ]);
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
});
