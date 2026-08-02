import { and, asc, desc, eq, ilike, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { db } from "../../client";
import {
  userStorageObjects,
  userStorageDeletions,
  userStorageUsage,
  type NewUserStorageObject,
  type UserStorageObjectDb,
  type UserStorageObjectKind,
  type UserStorageDeletionDb,
  type UserStorageUsageDb,
} from "../../schema";

export class UserStorageQuotaExceededError extends Error {
  readonly code = "USER_STORAGE_QUOTA_EXCEEDED";

  constructor(
    readonly quotaBytes: number,
    readonly usedBytes: number,
    readonly reservedBytes: number,
    readonly incomingBytes: number,
    readonly quotaObjects: number,
    readonly usedObjects: number,
    readonly reservedObjects: number,
    readonly incomingObjects: number,
  ) {
    super("User storage quota exceeded");
    this.name = "UserStorageQuotaExceededError";
  }
}

const ensureUsageRow = async (
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  ownerUserId: string,
) => {
  await tx
    .insert(userStorageUsage)
    .values({ ownerUserId })
    .onConflictDoNothing({ target: userStorageUsage.ownerUserId });
};

const lockUsageRow = async (
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  ownerUserId: string,
): Promise<UserStorageUsageDb> => {
  const [usage] = await tx
    .select()
    .from(userStorageUsage)
    .where(eq(userStorageUsage.ownerUserId, ownerUserId))
    .for("update");
  if (!usage) throw new Error("Failed to initialize user storage usage");
  return usage;
};

export type ReserveUserStorageObjectInput = Omit<
  NewUserStorageObject,
  "createdAt" | "updatedAt" | "status"
>;

export const reserveUserStorageObject = async (
  input: ReserveUserStorageObjectInput,
): Promise<UserStorageObjectDb> =>
  db.transaction(async (tx) => {
    await ensureUsageRow(tx, input.ownerUserId);
    const usage = await lockUsageRow(tx, input.ownerUserId);

    if (
      usage.usedBytes + usage.reservedBytes + input.sizeBytes > usage.quotaBytes ||
      usage.usedObjects + usage.reservedObjects + 1 > usage.quotaObjects
    ) {
      throw new UserStorageQuotaExceededError(
        usage.quotaBytes,
        usage.usedBytes,
        usage.reservedBytes,
        input.sizeBytes,
        usage.quotaObjects,
        usage.usedObjects,
        usage.reservedObjects,
        1,
      );
    }

    const [object] = await tx
      .insert(userStorageObjects)
      .values({ ...input, status: "pending" })
      .returning();
    if (!object) throw new Error("Failed to reserve user storage object");

    await tx
      .update(userStorageUsage)
      .set({
        reservedBytes: usage.reservedBytes + input.sizeBytes,
        reservedObjects: usage.reservedObjects + 1,
        updatedAt: new Date(),
      })
      .where(eq(userStorageUsage.ownerUserId, input.ownerUserId));

    return object;
  });

export const finalizeUserStorageObject = async (
  ownerUserId: string,
  objectId: string,
): Promise<{
  object: UserStorageObjectDb;
  replacedObject: UserStorageObjectDb | null;
}> =>
  db.transaction(async (tx) => {
    await ensureUsageRow(tx, ownerUserId);
    const usage = await lockUsageRow(tx, ownerUserId);
    const [pending] = await tx
      .select()
      .from(userStorageObjects)
      .where(
        and(
          eq(userStorageObjects.id, objectId),
          eq(userStorageObjects.ownerUserId, ownerUserId),
          eq(userStorageObjects.status, "pending"),
        ),
      )
      .for("update");
    if (!pending) throw new Error("Pending user storage object not found");

    const [replacedObject] = await tx
      .select()
      .from(userStorageObjects)
      .where(
        and(
          eq(userStorageObjects.ownerUserId, ownerUserId),
          eq(userStorageObjects.virtualPath, pending.virtualPath),
          eq(userStorageObjects.status, "ready"),
          ne(userStorageObjects.id, objectId),
        ),
      )
      .for("update");

    if (replacedObject) {
      await tx
        .delete(userStorageObjects)
        .where(eq(userStorageObjects.id, replacedObject.id));
    }

    const [object] = await tx
      .update(userStorageObjects)
      .set({ status: "ready", reservationExpiresAt: null, updatedAt: new Date() })
      .where(eq(userStorageObjects.id, objectId))
      .returning();
    if (!object) throw new Error("Failed to finalize user storage object");

    await tx
      .update(userStorageUsage)
      .set({
        usedBytes:
          usage.usedBytes - (replacedObject?.sizeBytes ?? 0) + pending.sizeBytes,
        reservedBytes: Math.max(0, usage.reservedBytes - pending.sizeBytes),
        usedObjects:
          usage.usedObjects - (replacedObject ? 1 : 0) + 1,
        reservedObjects: Math.max(0, usage.reservedObjects - 1),
        updatedAt: new Date(),
      })
      .where(eq(userStorageUsage.ownerUserId, ownerUserId));

    return { object, replacedObject: replacedObject ?? null };
  });

export const releaseUserStorageReservation = async (
  ownerUserId: string,
  objectId: string,
): Promise<void> => {
  await db.transaction(async (tx) => {
    await ensureUsageRow(tx, ownerUserId);
    const usage = await lockUsageRow(tx, ownerUserId);
    const [pending] = await tx
      .select()
      .from(userStorageObjects)
      .where(
        and(
          eq(userStorageObjects.id, objectId),
          eq(userStorageObjects.ownerUserId, ownerUserId),
          eq(userStorageObjects.status, "pending"),
        ),
      )
      .for("update");
    if (!pending) return;

    await tx.delete(userStorageObjects).where(eq(userStorageObjects.id, pending.id));
    await tx
      .update(userStorageUsage)
      .set({
        reservedBytes: Math.max(0, usage.reservedBytes - pending.sizeBytes),
        reservedObjects: Math.max(0, usage.reservedObjects - 1),
        updatedAt: new Date(),
      })
      .where(eq(userStorageUsage.ownerUserId, ownerUserId));
  });
};

export const deleteUserStorageObject = async (
  ownerUserId: string,
  objectId: string,
): Promise<UserStorageObjectDb | null> =>
  db.transaction(async (tx) => {
    await ensureUsageRow(tx, ownerUserId);
    const usage = await lockUsageRow(tx, ownerUserId);
    const [object] = await tx
      .select()
      .from(userStorageObjects)
      .where(
        and(
          eq(userStorageObjects.id, objectId),
          eq(userStorageObjects.ownerUserId, ownerUserId),
          eq(userStorageObjects.status, "ready"),
        ),
      )
      .for("update");
    if (!object) return null;

    await tx.delete(userStorageObjects).where(eq(userStorageObjects.id, objectId));
    await tx
      .update(userStorageUsage)
      .set({
        usedBytes: Math.max(0, usage.usedBytes - object.sizeBytes),
        usedObjects: Math.max(0, usage.usedObjects - 1),
        updatedAt: new Date(),
      })
      .where(eq(userStorageUsage.ownerUserId, ownerUserId));
    return object;
  });

export const getUserStorageUsage = async (
  ownerUserId: string,
): Promise<UserStorageUsageDb> => {
  await db
    .insert(userStorageUsage)
    .values({ ownerUserId })
    .onConflictDoNothing({ target: userStorageUsage.ownerUserId });
  const [usage] = await db
    .select()
    .from(userStorageUsage)
    .where(eq(userStorageUsage.ownerUserId, ownerUserId));
  if (!usage) throw new Error("Failed to load user storage usage");
  return usage;
};

export const getUserStorageObject = async (
  ownerUserId: string,
  objectId: string,
): Promise<UserStorageObjectDb | undefined> => {
  const [object] = await db
    .select()
    .from(userStorageObjects)
    .where(
      and(
        eq(userStorageObjects.id, objectId),
        eq(userStorageObjects.ownerUserId, ownerUserId),
        eq(userStorageObjects.status, "ready"),
      ),
    )
    .limit(1);
  return object;
};

export const getUserStorageObjectByPath = async (
  ownerUserId: string,
  virtualPath: string,
): Promise<UserStorageObjectDb | undefined> => {
  const [object] = await db
    .select()
    .from(userStorageObjects)
    .where(
      and(
        eq(userStorageObjects.ownerUserId, ownerUserId),
        eq(userStorageObjects.virtualPath, virtualPath),
        eq(userStorageObjects.status, "ready"),
      ),
    )
    .limit(1);
  return object;
};

export const listUserStorageObjects = async (
  ownerUserId: string,
  options: {
    kind?: UserStorageObjectKind;
    prefix?: string;
    search?: string;
    limit?: number;
  } = {},
): Promise<UserStorageObjectDb[]> => {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 200);
  const filters = [
    eq(userStorageObjects.ownerUserId, ownerUserId),
    eq(userStorageObjects.status, "ready"),
    options.kind ? eq(userStorageObjects.kind, options.kind) : undefined,
    options.prefix
      ? ilike(userStorageObjects.virtualPath, `${options.prefix.replace(/[%_]/g, "\\$&")}%`)
      : undefined,
    options.search
      ? ilike(userStorageObjects.virtualPath, `%${options.search.replace(/[%_]/g, "\\$&")}%`)
      : undefined,
  ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));

  return db
    .select()
    .from(userStorageObjects)
    .where(and(...filters))
    .orderBy(desc(userStorageObjects.updatedAt))
    .limit(limit);
};

/** Releases database reservations that never reached S3 finalization. */
export const releaseExpiredUserStorageReservations = async (
  ownerUserId: string,
  now: Date = new Date(),
): Promise<UserStorageObjectDb[]> =>
  db.transaction(async (tx) => {
    await ensureUsageRow(tx, ownerUserId);
    const usage = await lockUsageRow(tx, ownerUserId);
    const expired = await tx
      .select()
      .from(userStorageObjects)
      .where(
        and(
          eq(userStorageObjects.ownerUserId, ownerUserId),
          eq(userStorageObjects.status, "pending"),
          lte(userStorageObjects.reservationExpiresAt, now),
        ),
      )
      .for("update");
    if (expired.length === 0) return [];

    const expiredBytes = expired.reduce((total, object) => total + object.sizeBytes, 0);
    await tx
      .delete(userStorageObjects)
      .where(
        and(
          eq(userStorageObjects.ownerUserId, ownerUserId),
          eq(userStorageObjects.status, "pending"),
          lte(userStorageObjects.reservationExpiresAt, now),
        ),
      );
    await tx
      .update(userStorageUsage)
      .set({
        reservedBytes: Math.max(0, usage.reservedBytes - expiredBytes),
        reservedObjects: Math.max(0, usage.reservedObjects - expired.length),
        updatedAt: now,
      })
      .where(eq(userStorageUsage.ownerUserId, ownerUserId));
    return expired;
  });

export const claimUserStorageDeletions = async (
  options: { limit?: number; leaseMs?: number; now?: Date } = {},
): Promise<UserStorageDeletionDb[]> => {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const leaseMs = Math.min(Math.max(options.leaseMs ?? 5 * 60_000, 10_000), 30 * 60_000);
  const now = options.now ?? new Date();
  const leaseExpiresAt = new Date(now.getTime() + leaseMs);

  return db.transaction(async (tx) => {
    const candidates = await tx
      .select()
      .from(userStorageDeletions)
      .where(
        and(
          lte(userStorageDeletions.nextAttemptAt, now),
          or(
            isNull(userStorageDeletions.leaseExpiresAt),
            lte(userStorageDeletions.leaseExpiresAt, now),
          ),
        ),
      )
      .orderBy(asc(userStorageDeletions.nextAttemptAt))
      .limit(limit)
      .for("update", { skipLocked: true });
    if (candidates.length === 0) return [];

    return tx
      .update(userStorageDeletions)
      .set({
        attempts: sql`${userStorageDeletions.attempts} + 1`,
        leaseExpiresAt,
        updatedAt: now,
      })
      .where(
        inArray(
          userStorageDeletions.objectKey,
          candidates.map((candidate) => candidate.objectKey),
        ),
      )
      .returning();
  });
};

export const completeUserStorageDeletion = async (
  objectKey: string,
): Promise<void> => {
  await db
    .delete(userStorageDeletions)
    .where(eq(userStorageDeletions.objectKey, objectKey));
};

export const failUserStorageDeletion = async (
  objectKey: string,
  attempts: number,
  lastError: string,
  now: Date = new Date(),
): Promise<void> => {
  const backoffMs = Math.min(60 * 60_000, 2 ** Math.min(Math.max(attempts, 1), 12) * 1_000);
  await db
    .update(userStorageDeletions)
    .set({
      leaseExpiresAt: null,
      nextAttemptAt: new Date(now.getTime() + backoffMs),
      lastError: lastError.replace(/[\r\n]/g, " ").slice(0, 500),
      updatedAt: now,
    })
    .where(eq(userStorageDeletions.objectKey, objectKey));
};
