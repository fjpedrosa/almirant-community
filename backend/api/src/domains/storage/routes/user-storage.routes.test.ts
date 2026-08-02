import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";
import type {
  UserStorageObjectDb,
  UserStorageUsageDb,
} from "@almirant/database";
import { testUser } from "../../../test/fixtures";
import { createUserStorageRoutes, MAX_USER_STORAGE_UPLOAD_BYTES } from "./user-storage.routes";
import type { UserStorageService } from "../services/user-storage-service";
import type { PutUserStorageObjectInput } from "../services/user-storage-service";

const makeObject = (
  overrides: Partial<UserStorageObjectDb> = {},
): UserStorageObjectDb => ({
  id: "6e9fa58b-3490-4e39-982f-444e5c697e55",
  ownerUserId: testUser.id,
  workspaceId: null,
  objectKey: "user-storage/opaque/private-key",
  virtualPath: "notes/report.txt",
  fileName: "report.txt",
  contentType: "text/plain",
  sizeBytes: 5,
  checksumSha256: "a".repeat(64),
  kind: "file",
  status: "ready",
  metadata: {},
  reservationExpiresAt: null,
  createdAt: new Date("2026-07-10T10:00:00.000Z"),
  updatedAt: new Date("2026-07-10T10:00:00.000Z"),
  ...overrides,
});

const makeUsage = (): UserStorageUsageDb => ({
  ownerUserId: testUser.id,
  quotaBytes: 1_073_741_824,
  usedBytes: 5,
  reservedBytes: 2,
  quotaObjects: 10_000,
  usedObjects: 3,
  reservedObjects: 1,
  createdAt: new Date("2026-07-10T10:00:00.000Z"),
  updatedAt: new Date("2026-07-10T10:00:00.000Z"),
});

const state = {
  object: makeObject(),
  bytes: new TextEncoder().encode("hello"),
};

const service = {
  put: mock(async (_input: PutUserStorageObjectInput) => state.object),
  get: mock(async () => state.object),
  list: mock(async () => [state.object]),
  usage: mock(async () => makeUsage()),
  read: mock(
    async (
      _ownerUserId: string,
      _objectId: string,
    ): Promise<{ object: UserStorageObjectDb; bytes: Uint8Array } | null> => ({
      object: state.object,
      bytes: state.bytes,
    }),
  ),
  remove: mock(async () => true),
  drainDeletionQueue: mock(async () => ({ completed: 0, failed: 0 })),
} satisfies UserStorageService;

const makeApp = () =>
  new Elysia()
    .derive(() => ({
      user: testUser,
      activeWorkspace: null,
      memberRole: null,
    }))
    .use(createUserStorageRoutes(service));

beforeEach(() => {
  state.object = makeObject();
  state.bytes = new TextEncoder().encode("hello");
  service.put.mockClear();
  service.get.mockClear();
  service.list.mockClear();
  service.usage.mockClear();
  service.read.mockClear();
  service.remove.mockClear();
});

describe("user storage REST routes", () => {
  it("loads account usage from the authenticated user without requiring a workspace", async () => {
    const response = await makeApp().handle(new Request("http://localhost/storage/usage"));

    expect(response.status).toBe(200);
    expect(service.usage).toHaveBeenCalledWith(testUser.id);
    expect(await response.json()).toEqual({
      success: true,
      data: {
        quotaBytes: 1_073_741_824,
        usedBytes: 5,
        reservedBytes: 2,
        availableBytes: 1_073_741_817,
        quotaObjects: 10_000,
        usedObjects: 3,
        reservedObjects: 1,
        availableObjects: 9_996,
      },
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("lists only public metadata and never returns raw object keys or owner ids", async () => {
    const response = await makeApp().handle(
      new Request("http://localhost/storage/files?prefix=notes&limit=10"),
    );
    const body = await response.json() as { data: Array<Record<string, unknown>> };

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(service.list).toHaveBeenCalledWith(testUser.id, {
      prefix: "notes",
      search: undefined,
      limit: 10,
    });
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.virtualPath).toBe("notes/report.txt");
    expect(body.data[0]).not.toHaveProperty("objectKey");
    expect(body.data[0]).not.toHaveProperty("ownerUserId");
    expect(JSON.stringify(body)).not.toContain("opaque/private-key");
  });

  it("uploads multipart data under the authenticated user with no workspace scope", async () => {
    const form = new FormData();
    form.set("file", new File(["hello"], "report.txt", { type: "text/plain" }));
    form.set("path", "notes/report.txt");

    const response = await makeApp().handle(
      new Request("http://localhost/storage/files", { method: "POST", body: form }),
    );

    expect(response.status).toBe(201);
    expect(service.put).toHaveBeenCalledTimes(1);
    const putInput = service.put.mock.calls[0]![0];
    expect(putInput.ownerUserId).toBe(testUser.id);
    expect(putInput.workspaceId).toBeNull();
    expect(putInput.virtualPath).toBe("notes/report.txt");
    expect(putInput.fileName).toBe("report.txt");
    expect(putInput.contentType).toStartWith("text/plain");
    expect(new TextDecoder().decode(putInput.bytes)).toBe("hello");

    const body = await response.json() as { data: Record<string, unknown> };
    expect(body.data).not.toHaveProperty("objectKey");
    expect(body.data).not.toHaveProperty("ownerUserId");
  });

  it("rejects unsafe virtual paths before invoking storage", async () => {
    const form = new FormData();
    form.set("file", new File(["hello"], "report.txt", { type: "text/plain" }));
    form.set("path", "../secret.txt");

    const response = await makeApp().handle(
      new Request("http://localhost/storage/files", { method: "POST", body: form }),
    );

    expect(response.status).toBe(400);
    expect(service.put).not.toHaveBeenCalled();
  });

  it("rejects uploads larger than 25 MiB before invoking storage", async () => {
    const form = new FormData();
    form.set(
      "file",
      new File([new Uint8Array(MAX_USER_STORAGE_UPLOAD_BYTES + 1)], "large.bin", {
        type: "application/octet-stream",
      }),
    );

    const response = await makeApp().handle(
      new Request("http://localhost/storage/files", { method: "POST", body: form }),
    );

    expect(response.status).toBe(422);
    expect(service.put).not.toHaveBeenCalled();
  });

  it("downloads privately with safe attachment and nosniff headers", async () => {
    state.object = makeObject({
      fileName: "report\"\r\nX-Evil: injected.txt",
      contentType: "text/plain; charset=\"utf-8\r\nX-Evil: injected\"",
    });

    const response = await makeApp().handle(
      new Request(`http://localhost/storage/files/${state.object.id}`),
    );

    expect(response.status).toBe(200);
    expect(service.read).toHaveBeenCalledWith(testUser.id, state.object.id);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toContain("attachment;");
    expect(response.headers.get("content-disposition")).not.toContain("\r");
    expect(response.headers.get("content-disposition")).not.toContain("\n");
    expect(response.headers.get("x-evil")).toBeNull();
    expect(await response.text()).toBe("hello");
  });

  it("returns 404 for another user's or missing object without leaking its existence", async () => {
    service.read.mockImplementationOnce(async () => null);

    const response = await makeApp().handle(
      new Request("http://localhost/storage/files/6e9fa58b-3490-4e39-982f-444e5c697e55"),
    );

    expect(response.status).toBe(404);
  });

  it("deletes only through the authenticated user's scope", async () => {
    const response = await makeApp().handle(
      new Request(`http://localhost/storage/files/${state.object.id}`, { method: "DELETE" }),
    );

    expect(response.status).toBe(200);
    expect(service.remove).toHaveBeenCalledWith(testUser.id, state.object.id);
  });
});
