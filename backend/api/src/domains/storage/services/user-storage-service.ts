import { createHash, randomUUID } from "node:crypto";
import type {
  UserStorageDeletionDb,
  UserStorageObjectDb,
  UserStorageObjectKind,
  UserStorageUsageDb,
} from "@almirant/database";
import {
  buildUserStorageObjectKey,
  normalizeUserStoragePath,
} from "./user-storage-policy";

export interface UserStorageRepositoryPort {
  reserveObject(input: {
    id: string;
    ownerUserId: string;
    workspaceId: string | null;
    objectKey: string;
    virtualPath: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    checksumSha256: string;
    kind: UserStorageObjectKind;
    metadata: Record<string, unknown>;
    reservationExpiresAt: Date;
  }): Promise<UserStorageObjectDb>;
  finalizeObject(
    ownerUserId: string,
    objectId: string,
  ): Promise<{ object: UserStorageObjectDb; replacedObject: UserStorageObjectDb | null }>;
  releaseReservation(ownerUserId: string, objectId: string): Promise<void>;
  releaseExpiredReservations(ownerUserId: string): Promise<UserStorageObjectDb[]>;
  deleteObject(ownerUserId: string, objectId: string): Promise<UserStorageObjectDb | null>;
  getObject(ownerUserId: string, objectId: string): Promise<UserStorageObjectDb | undefined>;
  listObjects(
    ownerUserId: string,
    options?: { kind?: UserStorageObjectKind; prefix?: string; search?: string; limit?: number },
  ): Promise<UserStorageObjectDb[]>;
  getUsage(ownerUserId: string): Promise<UserStorageUsageDb>;
  claimDeletions(options?: {
    limit?: number;
    leaseMs?: number;
    now?: Date;
  }): Promise<UserStorageDeletionDb[]>;
  completeDeletion(objectKey: string): Promise<void>;
  failDeletion(
    objectKey: string,
    attempts: number,
    lastError: string,
  ): Promise<void>;
}

export interface UserStorageObjectStorePort {
  put(input: {
    key: string;
    bytes: Uint8Array;
    contentType: string;
  }): Promise<unknown>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<unknown>;
}

export interface PutUserStorageObjectInput {
  ownerUserId: string;
  workspaceId: string | null;
  virtualPath: string;
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
  kind: UserStorageObjectKind;
  metadata?: Record<string, unknown>;
}

const RESERVATION_TTL_MS = 15 * 60 * 1000;

export const createUserStorageService = ({
  repository,
  objectStore,
}: {
  repository: UserStorageRepositoryPort;
  objectStore: UserStorageObjectStorePort;
}) => {
  const drainDeletionQueue = async (limit = 50): Promise<{
    completed: number;
    failed: number;
  }> => {
    const deletions = await repository.claimDeletions({ limit });
    let completed = 0;
    let failed = 0;
    for (const deletion of deletions) {
      try {
        await objectStore.delete(deletion.objectKey);
        await repository.completeDeletion(deletion.objectKey);
        completed += 1;
      } catch (error) {
        failed += 1;
        await repository.failDeletion(
          deletion.objectKey,
          deletion.attempts,
          error instanceof Error ? error.message : "Object storage deletion failed",
        );
      }
    }
    return { completed, failed };
  };

  const cleanupExpiredReservations = async (ownerUserId: string): Promise<void> => {
    await repository.releaseExpiredReservations(ownerUserId);
    await drainDeletionQueue();
  };

  return {
    put: async (input: PutUserStorageObjectInput): Promise<UserStorageObjectDb> => {
      await cleanupExpiredReservations(input.ownerUserId);
      const id = randomUUID();
      const virtualPath = normalizeUserStoragePath(input.virtualPath);
      const checksumSha256 = createHash("sha256")
        .update(input.bytes)
        .digest("hex");
      const objectKey = buildUserStorageObjectKey({
        ownerUserId: input.ownerUserId,
        objectId: id,
        fileName: input.fileName,
      });

      const reserved = await repository.reserveObject({
        id,
        ownerUserId: input.ownerUserId,
        workspaceId: input.workspaceId,
        objectKey,
        virtualPath,
        fileName: input.fileName.slice(0, 255),
        contentType:
          input.contentType.slice(0, 255) || "application/octet-stream",
        sizeBytes: input.bytes.byteLength,
        checksumSha256,
        kind: input.kind,
        metadata: input.metadata ?? {},
        reservationExpiresAt: new Date(Date.now() + RESERVATION_TTL_MS),
      });

      let uploaded = false;
      try {
        await objectStore.put({
          key: reserved.objectKey,
          bytes: input.bytes,
          contentType: reserved.contentType,
        });
        uploaded = true;
        const finalized = await repository.finalizeObject(input.ownerUserId, reserved.id);
        await drainDeletionQueue();
        return finalized.object;
      } catch (error) {
        if (uploaded) {
          const committed = await repository
            .getObject(input.ownerUserId, reserved.id)
            .catch(() => undefined);
          if (committed) {
            await drainDeletionQueue();
            return committed;
          }
        }
        await repository
          .releaseReservation(input.ownerUserId, reserved.id)
          .catch(() => undefined);
        await drainDeletionQueue().catch(() => undefined);
        throw error;
      }
    },

    get: (ownerUserId: string, objectId: string) =>
      repository.getObject(ownerUserId, objectId),

    list: (
      ownerUserId: string,
      options?: {
        kind?: UserStorageObjectKind;
        prefix?: string;
        search?: string;
        limit?: number;
      },
    ) => repository.listObjects(ownerUserId, options),

    usage: async (ownerUserId: string) => {
      await cleanupExpiredReservations(ownerUserId);
      return repository.getUsage(ownerUserId);
    },

    read: async (ownerUserId: string, objectId: string) => {
      const object = await repository.getObject(ownerUserId, objectId);
      if (!object) return null;
      return { object, bytes: await objectStore.get(object.objectKey) };
    },

    remove: async (ownerUserId: string, objectId: string): Promise<boolean> => {
      const object = await repository.deleteObject(ownerUserId, objectId);
      if (!object) return false;
      await drainDeletionQueue();
      return true;
    },

    drainDeletionQueue,
  };
};

export type UserStorageService = ReturnType<typeof createUserStorageService>;
