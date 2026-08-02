import { describe, expect, it, mock } from "bun:test";
import type {
  UserStorageDeletionDb,
  UserStorageObjectDb,
  UserStorageUsageDb,
} from "@almirant/database";
import {
  createUserStorageService,
  type UserStorageRepositoryPort,
} from "./user-storage-service";

const input = {
  ownerUserId: "user-1",
  workspaceId: "workspace-1",
  virtualPath: "notes/result.txt",
  fileName: "result.txt",
  contentType: "text/plain",
  bytes: new TextEncoder().encode("hello"),
  kind: "file" as const,
  metadata: {},
};

const makeObject = (
  overrides: Partial<UserStorageObjectDb> = {},
): UserStorageObjectDb => ({
  id: "object-1",
  ownerUserId: input.ownerUserId,
  workspaceId: input.workspaceId,
  objectKey: "user-storage/key",
  virtualPath: input.virtualPath,
  fileName: input.fileName,
  contentType: input.contentType,
  sizeBytes: input.bytes.byteLength,
  checksumSha256: "hash",
  kind: "file",
  status: "ready",
  metadata: {},
  reservationExpiresAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeUsage = (
  overrides: Partial<UserStorageUsageDb> = {},
): UserStorageUsageDb => ({
  ownerUserId: input.ownerUserId,
  quotaBytes: 100,
  usedBytes: 0,
  reservedBytes: 0,
  quotaObjects: 10_000,
  usedObjects: 0,
  reservedObjects: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const noDeletionQueue = () => ({
  claimDeletions: mock(async () => []),
  completeDeletion: mock(async () => undefined),
  failDeletion: mock(async () => undefined),
});

const makeDeletion = (
  objectKey: string,
  overrides: Partial<UserStorageDeletionDb> = {},
): UserStorageDeletionDb => ({
  objectKey,
  ownerUserId: input.ownerUserId,
  attempts: 1,
  nextAttemptAt: new Date(),
  leaseExpiresAt: new Date(Date.now() + 60_000),
  lastError: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe("user storage service", () => {
  it("reserves quota before S3 and finalizes only after a successful upload", async () => {
    const calls: string[] = [];
    const repository = {
      ...noDeletionQueue(),
      reserveObject: mock(async (data) => {
        calls.push("reserve");
        return makeObject({ ...data, status: "pending" });
      }),
      finalizeObject: mock(async (ownerUserId: string, objectId: string) => {
        calls.push("finalize");
        return {
          object: makeObject({ id: objectId, ownerUserId }),
          replacedObject: null,
        };
      }),
      releaseReservation: mock(async () => undefined),
      releaseExpiredReservations: mock(async () => []),
      deleteObject: mock(async () => null),
      getObject: mock(async () => undefined),
      listObjects: mock(async () => []),
      getUsage: mock(async () => makeUsage({ usedBytes: 5 })),
    } satisfies UserStorageRepositoryPort;
    const objectStore = {
      put: mock(async () => calls.push("put")),
      get: mock(async () => input.bytes),
      delete: mock(async () => undefined),
    };

    const service = createUserStorageService({ repository, objectStore });
    const result = await service.put(input);

    expect(calls).toEqual(["reserve", "put", "finalize"]);
    expect(result.status).toBe("ready");
    expect(repository.releaseReservation).not.toHaveBeenCalled();
  });

  it("releases reserved quota if S3 upload fails", async () => {
    const repository = {
      ...noDeletionQueue(),
      reserveObject: mock(async (data) => makeObject({ ...data, status: "pending" })),
      finalizeObject: mock(async () => {
        throw new Error("must not finalize");
      }),
      releaseReservation: mock(async () => undefined),
      releaseExpiredReservations: mock(async () => []),
      deleteObject: mock(async () => null),
      getObject: mock(async () => undefined),
      listObjects: mock(async () => []),
      getUsage: mock(async () => makeUsage()),
    } satisfies UserStorageRepositoryPort;
    const objectStore = {
      put: mock(async () => {
        throw new Error("S3 unavailable");
      }),
      get: mock(async () => input.bytes),
      delete: mock(async () => undefined),
    };

    const service = createUserStorageService({ repository, objectStore });
    await expect(service.put(input)).rejects.toThrow("S3 unavailable");
    expect(repository.releaseReservation).toHaveBeenCalledTimes(1);
    expect(repository.finalizeObject).not.toHaveBeenCalled();
  });

  it("removes an uploaded S3 object if database finalization fails", async () => {
    const reserved = makeObject({ status: "pending" });
    let queued = false;
    let claimed = false;
    const repository = {
      ...noDeletionQueue(),
      reserveObject: mock(async () => reserved),
      finalizeObject: mock(async () => {
        throw new Error("database unavailable");
      }),
      releaseReservation: mock(async () => {
        queued = true;
      }),
      claimDeletions: mock(async () => {
        if (!queued || claimed) return [];
        claimed = true;
        return [makeDeletion(reserved.objectKey)];
      }),
      completeDeletion: mock(async () => undefined),
      releaseExpiredReservations: mock(async () => []),
      deleteObject: mock(async () => null),
      getObject: mock(async () => undefined),
      listObjects: mock(async () => []),
      getUsage: mock(async () => makeUsage()),
    } satisfies UserStorageRepositoryPort;
    const objectStore = {
      put: mock(async () => undefined),
      get: mock(async () => input.bytes),
      delete: mock(async () => undefined),
    };

    const service = createUserStorageService({ repository, objectStore });
    await expect(service.put(input)).rejects.toThrow("database unavailable");

    expect(objectStore.delete).toHaveBeenCalledWith(reserved.objectKey);
    expect(repository.completeDeletion).toHaveBeenCalledWith(reserved.objectKey);
    expect(repository.releaseReservation).toHaveBeenCalledTimes(1);
  });

  it("cleans expired reservations and their possible S3 objects before reserving", async () => {
    const calls: string[] = [];
    const expired = makeObject({ id: "expired", objectKey: "user-storage/expired", status: "pending" });
    const reserved = makeObject({ id: "fresh", status: "pending" });
    let queued = false;
    let claimed = false;
    const repository = {
      ...noDeletionQueue(),
      reserveObject: mock(async () => {
        calls.push("reserve");
        return reserved;
      }),
      finalizeObject: mock(async () => ({
        object: makeObject({ id: reserved.id }),
        replacedObject: null,
      })),
      releaseReservation: mock(async () => undefined),
      releaseExpiredReservations: mock(async () => {
        calls.push("release-expired");
        queued = true;
        return [expired];
      }),
      claimDeletions: mock(async () => {
        if (!queued || claimed) return [];
        claimed = true;
        return [makeDeletion(expired.objectKey)];
      }),
      deleteObject: mock(async () => null),
      getObject: mock(async () => undefined),
      listObjects: mock(async () => []),
      getUsage: mock(async () => makeUsage()),
    } satisfies UserStorageRepositoryPort;
    const objectStore = {
      put: mock(async () => calls.push("put")),
      get: mock(async () => input.bytes),
      delete: mock(async (key: string) => calls.push(`delete:${key}`)),
    };

    await createUserStorageService({ repository, objectStore }).put(input);

    expect(calls).toEqual([
      "release-expired",
      `delete:${expired.objectKey}`,
      "reserve",
      "put",
    ]);
  });

  it("releases database quota first and drains the durable S3 deletion queue", async () => {
    const object = makeObject();
    const calls: string[] = [];
    let queued = false;
    let claimed = false;
    const repository = {
      ...noDeletionQueue(),
      reserveObject: mock(async () => object),
      finalizeObject: mock(async () => ({ object, replacedObject: null })),
      releaseReservation: mock(async () => undefined),
      releaseExpiredReservations: mock(async () => []),
      deleteObject: mock(async () => {
        calls.push("database");
        queued = true;
        return object;
      }),
      claimDeletions: mock(async () => {
        if (!queued || claimed) return [];
        claimed = true;
        return [makeDeletion(object.objectKey)];
      }),
      getObject: mock(async () => object),
      listObjects: mock(async () => [object]),
      getUsage: mock(async () => makeUsage({ usedBytes: 5 })),
    } satisfies UserStorageRepositoryPort;
    const objectStore = {
      put: mock(async () => undefined),
      get: mock(async () => input.bytes),
      delete: mock(async () => calls.push("s3")),
    };

    const service = createUserStorageService({ repository, objectStore });
    expect(await service.remove("user-1", "object-1")).toBe(true);
    expect(calls).toEqual(["database", "s3"]);
    expect(repository.completeDeletion).toHaveBeenCalledWith(object.objectKey);
  });

  it("recovers an ambiguous finalize response without deleting a committed object", async () => {
    const committed = makeObject();
    const repository = {
      ...noDeletionQueue(),
      reserveObject: mock(async () => makeObject({ status: "pending" })),
      finalizeObject: mock(async () => {
        throw new Error("connection lost after commit");
      }),
      releaseReservation: mock(async () => undefined),
      releaseExpiredReservations: mock(async () => []),
      deleteObject: mock(async () => null),
      getObject: mock(async () => committed),
      listObjects: mock(async () => []),
      getUsage: mock(async () => makeUsage()),
    } satisfies UserStorageRepositoryPort;
    const objectStore = {
      put: mock(async () => undefined),
      get: mock(async () => input.bytes),
      delete: mock(async () => undefined),
    };

    const result = await createUserStorageService({ repository, objectStore }).put(input);

    expect(result).toBe(committed);
    expect(repository.releaseReservation).not.toHaveBeenCalled();
    expect(objectStore.delete).not.toHaveBeenCalled();
  });

  it("keeps failed physical deletions queued for retry", async () => {
    const object = makeObject();
    const repository = {
      ...noDeletionQueue(),
      reserveObject: mock(async () => object),
      finalizeObject: mock(async () => ({ object, replacedObject: null })),
      releaseReservation: mock(async () => undefined),
      releaseExpiredReservations: mock(async () => []),
      deleteObject: mock(async () => object),
      getObject: mock(async () => object),
      listObjects: mock(async () => [object]),
      getUsage: mock(async () => makeUsage()),
      claimDeletions: mock(async () => [makeDeletion(object.objectKey, { attempts: 3 })]),
      failDeletion: mock(async () => undefined),
    } satisfies UserStorageRepositoryPort;
    const objectStore = {
      put: mock(async () => undefined),
      get: mock(async () => input.bytes),
      delete: mock(async () => {
        throw new Error("S3 unavailable");
      }),
    };

    expect(
      await createUserStorageService({ repository, objectStore }).remove(
        input.ownerUserId,
        object.id,
      ),
    ).toBe(true);
    expect(repository.failDeletion).toHaveBeenCalledWith(
      object.objectKey,
      3,
      "S3 unavailable",
    );
    expect(repository.completeDeletion).not.toHaveBeenCalled();
  });
});
