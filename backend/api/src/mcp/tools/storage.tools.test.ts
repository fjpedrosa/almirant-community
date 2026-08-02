import { beforeEach, describe, expect, it, mock } from "bun:test";
import type {
  UserStorageObjectDb,
  UserStorageUsageDb,
} from "@almirant/database";
import type { UserStorageService } from "../../domains/storage/services/user-storage-service";
import type { PutUserStorageObjectInput } from "../../domains/storage/services/user-storage-service";
import {
  MAX_MCP_STORAGE_PAYLOAD_BYTES,
  registerStorageTools,
} from "./storage.tools";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

type ToolHandler = (
  params: Record<string, unknown>,
  extra: Record<string, unknown>,
) => Promise<ToolResult>;

const object = {
  id: "6e9fa58b-3490-4e39-982f-444e5c697e55",
  ownerUserId: "owner-user",
  workspaceId: null,
  objectKey: "user-storage/opaque/private-key",
  virtualPath: "notes/result.txt",
  fileName: "result.txt",
  contentType: "text/plain",
  sizeBytes: 5,
  checksumSha256: "a".repeat(64),
  kind: "file",
  status: "ready",
  metadata: {},
  reservationExpiresAt: null,
  createdAt: new Date("2026-07-10T10:00:00.000Z"),
  updatedAt: new Date("2026-07-10T10:00:00.000Z"),
} satisfies UserStorageObjectDb;

const usage = {
  ownerUserId: "owner-user",
  quotaBytes: 1_073_741_824,
  usedBytes: 5,
  reservedBytes: 0,
  quotaObjects: 10_000,
  usedObjects: 1,
  reservedObjects: 0,
  createdAt: new Date("2026-07-10T10:00:00.000Z"),
  updatedAt: new Date("2026-07-10T10:00:00.000Z"),
} satisfies UserStorageUsageDb;

const service = {
  put: mock(async (_input: PutUserStorageObjectInput) => object),
  get: mock(async () => object),
  list: mock(async () => [object]),
  usage: mock(async () => usage),
  read: mock(async () => ({ object, bytes: new TextEncoder().encode("hello") })),
  remove: mock(async () => true),
  drainDeletionQueue: mock(async () => ({ completed: 0, failed: 0 })),
} satisfies UserStorageService;

const buildRegistry = () => {
  const tools = new Map<string, ToolHandler>();
  const server = {
    tool: (
      name: string,
      _description: string,
      _schema: unknown,
      handler: ToolHandler,
    ) => {
      tools.set(name, handler);
      return undefined;
    },
  };
  registerStorageTools(server as never, service);
  return tools;
};

const withActor = {
  authInfo: {
    extra: {
      userId: "owner-user",
      workspaceId: "workspace-that-must-not-scope-storage",
      permissions: ["mcp:read", "mcp:write"],
    },
  },
};

beforeEach(() => {
  service.put.mockClear();
  service.get.mockClear();
  service.list.mockClear();
  service.usage.mockClear();
  service.read.mockClear();
  service.remove.mockClear();
});

describe("user storage MCP tools", () => {
  it("registers the fixed storage tool surface", () => {
    expect([...buildRegistry().keys()]).toEqual([
      "storage_usage",
      "storage_list",
      "storage_read",
      "storage_write",
      "storage_delete",
    ]);
  });

  it("derives account ownership exclusively from the authenticated MCP actor", async () => {
    const tools = buildRegistry();
    const result = await tools.get("storage_usage")!({}, withActor);

    expect(result.isError).toBeUndefined();
    expect(service.usage).toHaveBeenCalledWith("owner-user");
    expect(result.content[0]!.text).not.toContain("ownerUserId");
  });

  it("rejects storage access when the authenticated token has no user actor", async () => {
    const tools = buildRegistry();
    const result = await tools.get("storage_list")!(
      {},
      { authInfo: { extra: { permissions: ["mcp:read"] } } },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("authenticated user");
    expect(service.list).not.toHaveBeenCalled();
  });

  it("writes bounded text as UTF-8 without accepting owner or workspace scope from params", async () => {
    const tools = buildRegistry();
    const result = await tools.get("storage_write")!(
      {
        path: "notes/result.txt",
        content: "hello",
        contentType: "text/plain",
        ownerUserId: "attacker",
        workspaceId: "attacker-workspace",
      },
      withActor,
    );

    expect(result.isError).toBeUndefined();
    const input = service.put.mock.calls[0]![0];
    expect(input.ownerUserId).toBe("owner-user");
    expect(input.workspaceId).toBeNull();
    expect(input.virtualPath).toBe("notes/result.txt");
    expect(new TextDecoder().decode(input.bytes)).toBe("hello");
    expect(result.content[0]!.text).not.toContain("opaque/private-key");
  });

  it("rejects oversized and malformed encoded write payloads before storage", async () => {
    const tools = buildRegistry();
    const oversized = await tools.get("storage_write")!(
      {
        path: "large.txt",
        content: "a".repeat(MAX_MCP_STORAGE_PAYLOAD_BYTES + 1),
      },
      withActor,
    );
    const malformed = await tools.get("storage_write")!(
      { path: "bad.bin", base64: "not valid base64***" },
      withActor,
    );

    expect(oversized.isError).toBe(true);
    expect(malformed.isError).toBe(true);
    expect(service.put).not.toHaveBeenCalled();
  });

  it("rejects control characters in MCP content types before S3 metadata is created", async () => {
    const tools = buildRegistry();
    const result = await tools.get("storage_write")!(
      {
        path: "notes/result.txt",
        content: "hello",
        contentType: "text/plain; charset=\"utf-8\r\nX-Evil: injected\"",
      },
      withActor,
    );

    expect(result.isError).toBe(true);
    expect(service.put).not.toHaveBeenCalled();
  });

  it("refuses to load an oversized object into an MCP response", async () => {
    service.get.mockImplementationOnce(async () => ({
      ...object,
      sizeBytes: MAX_MCP_STORAGE_PAYLOAD_BYTES + 1,
    }));
    const tools = buildRegistry();
    const result = await tools.get("storage_read")!(
      { id: object.id, encoding: "base64" },
      withActor,
    );

    expect(result.isError).toBe(true);
    expect(service.read).not.toHaveBeenCalled();
  });

  it("reads bounded binary data as base64 without leaking its private object key", async () => {
    const binary = new Uint8Array([0, 255, 1]);
    service.read.mockImplementationOnce(async () => ({ object, bytes: binary }));
    const tools = buildRegistry();
    const result = await tools.get("storage_read")!(
      { id: object.id, encoding: "base64" },
      withActor,
    );

    expect(result.isError).toBeUndefined();
    expect(service.get).toHaveBeenCalledWith("owner-user", object.id);
    expect(service.read).toHaveBeenCalledWith("owner-user", object.id);
    const payload = JSON.parse(result.content[0]!.text) as Record<string, unknown>;
    expect(payload.encoding).toBe("base64");
    expect(payload.content).toBe(Buffer.from(binary).toString("base64"));
    expect(result.content[0]!.text).not.toContain("opaque/private-key");
  });

  it("requires write permission before deleting user storage", async () => {
    const tools = buildRegistry();
    const result = await tools.get("storage_delete")!(
      { id: object.id },
      {
        authInfo: {
          extra: { userId: "owner-user", permissions: ["mcp:read"] },
        },
      },
    );

    expect(result.isError).toBe(true);
    expect(service.remove).not.toHaveBeenCalled();
  });
});
