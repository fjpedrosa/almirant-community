/**
 * Real-DB regression tests for the per-user storage repository (Agents v2
 * storage port, community issue #69). Cloud (almirant-cloud) never gained a
 * dedicated unit-test file for this repository — its only coverage lived in
 * the API-layer storage domain, which is out of scope for this schema/repo
 * batch. These tests were written fresh for the community port to cover the
 * invariants the repository itself is responsible for: atomic quota
 * accounting, the reserve/finalize/replace-at-path lifecycle, and the
 * deletion-outbox lease/backoff cycle.
 *
 * Gated behind DATABASE_URL, mirroring the other DB-adjacent suites in this
 * package (see agent-job-repository.claim-gating.db.test.ts). Auto-skips
 * with no DATABASE_URL set.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("user-storage-repository (real DB)", () => {
  let db: typeof import("../../client").db;
  let sql: typeof import("drizzle-orm").sql;
  let reserveUserStorageObject: typeof import("./user-storage-repository").reserveUserStorageObject;
  let finalizeUserStorageObject: typeof import("./user-storage-repository").finalizeUserStorageObject;
  let releaseUserStorageReservation: typeof import("./user-storage-repository").releaseUserStorageReservation;
  let deleteUserStorageObject: typeof import("./user-storage-repository").deleteUserStorageObject;
  let getUserStorageUsage: typeof import("./user-storage-repository").getUserStorageUsage;
  let getUserStorageObject: typeof import("./user-storage-repository").getUserStorageObject;
  let releaseExpiredUserStorageReservations: typeof import("./user-storage-repository").releaseExpiredUserStorageReservations;
  let claimUserStorageDeletions: typeof import("./user-storage-repository").claimUserStorageDeletions;
  let completeUserStorageDeletion: typeof import("./user-storage-repository").completeUserStorageDeletion;
  let failUserStorageDeletion: typeof import("./user-storage-repository").failUserStorageDeletion;
  let UserStorageQuotaExceededError: typeof import("./user-storage-repository").UserStorageQuotaExceededError;

  const suffix = randomUUID().slice(0, 8);
  const createdUserIds: string[] = [];
  const createdObjectKeys: string[] = [];

  const createUser = async (label: string): Promise<string> => {
    const id = `storage-test-user-${label}-${suffix}`;
    await db.execute(sql`
      INSERT INTO "user" (id, name, email, created_at, updated_at)
      VALUES (${id}, ${`Storage Test ${label}`}, ${`storage-test-${label}-${suffix}@example.test`}, NOW(), NOW())
      ON CONFLICT (id) DO NOTHING
    `);
    createdUserIds.push(id);
    return id;
  };

  beforeAll(async () => {
    if (!hasDb) return;
    ({ db, sql } = await import("../../client"));
    ({
      reserveUserStorageObject,
      finalizeUserStorageObject,
      releaseUserStorageReservation,
      deleteUserStorageObject,
      getUserStorageUsage,
      getUserStorageObject,
      releaseExpiredUserStorageReservations,
      claimUserStorageDeletions,
      completeUserStorageDeletion,
      failUserStorageDeletion,
      UserStorageQuotaExceededError,
    } = await import("./user-storage-repository"));
  });

  afterAll(async () => {
    if (!hasDb) return;
    for (const key of createdObjectKeys) {
      await db.execute(sql`DELETE FROM user_storage_objects WHERE object_key = ${key}`);
      await db.execute(sql`DELETE FROM user_storage_deletions WHERE object_key = ${key}`);
    }
    for (const id of createdUserIds) {
      await db.execute(sql`DELETE FROM user_storage_usage WHERE owner_user_id = ${id}`);
      await db.execute(sql`DELETE FROM "user" WHERE id = ${id}`);
    }
  });

  const reserveInput = (ownerUserId: string, overrides: Partial<{
    objectKey: string;
    virtualPath: string;
    fileName: string;
    sizeBytes: number;
    checksumSha256: string;
  }> = {}) => {
    const key = overrides.objectKey ?? `${ownerUserId}/${randomUUID()}`;
    createdObjectKeys.push(key);
    return {
      ownerUserId,
      objectKey: key,
      virtualPath: overrides.virtualPath ?? `/files/${randomUUID()}.txt`,
      fileName: overrides.fileName ?? "file.txt",
      sizeBytes: overrides.sizeBytes ?? 1024,
      checksumSha256: overrides.checksumSha256 ?? "a".repeat(64),
    };
  };

  test("getUserStorageUsage lazily creates a usage row with the 1 GiB / 10k object defaults", async () => {
    const ownerUserId = await createUser("defaults");

    const usage = await getUserStorageUsage(ownerUserId);

    expect(usage.quotaBytes).toBe(1_073_741_824);
    expect(usage.quotaObjects).toBe(10_000);
    expect(usage.usedBytes).toBe(0);
    expect(usage.reservedBytes).toBe(0);
  });

  test("reserveUserStorageObject increments reserved bytes/objects without touching used counters", async () => {
    const ownerUserId = await createUser("reserve");
    await getUserStorageUsage(ownerUserId);

    const object = await reserveUserStorageObject(reserveInput(ownerUserId, { sizeBytes: 2048 }));
    expect(object.status).toBe("pending");

    const usage = await getUserStorageUsage(ownerUserId);
    expect(usage.reservedBytes).toBe(2048);
    expect(usage.reservedObjects).toBe(1);
    expect(usage.usedBytes).toBe(0);
  });

  test("reserveUserStorageObject fails closed once the byte quota would be exceeded", async () => {
    const ownerUserId = await createUser("quota-bytes");
    await db.execute(sql`
      INSERT INTO user_storage_usage (owner_user_id, quota_bytes, quota_objects)
      VALUES (${ownerUserId}, 1000, 10_000)
      ON CONFLICT (owner_user_id) DO UPDATE SET quota_bytes = 1000
    `);

    await expect(
      reserveUserStorageObject(reserveInput(ownerUserId, { sizeBytes: 1001 })),
    ).rejects.toBeInstanceOf(UserStorageQuotaExceededError);
  });

  test("reserveUserStorageObject fails closed once the object-count quota would be exceeded", async () => {
    const ownerUserId = await createUser("quota-objects");
    await db.execute(sql`
      INSERT INTO user_storage_usage (owner_user_id, quota_bytes, quota_objects)
      VALUES (${ownerUserId}, 1_073_741_824, 1)
      ON CONFLICT (owner_user_id) DO UPDATE SET quota_objects = 1
    `);

    await reserveUserStorageObject(reserveInput(ownerUserId, { sizeBytes: 10 }));

    await expect(
      reserveUserStorageObject(reserveInput(ownerUserId, { sizeBytes: 10 })),
    ).rejects.toBeInstanceOf(UserStorageQuotaExceededError);
  });

  test("finalizeUserStorageObject moves pending -> ready and moves bytes from reserved to used", async () => {
    const ownerUserId = await createUser("finalize");
    const reserved = await reserveUserStorageObject(reserveInput(ownerUserId, { sizeBytes: 500 }));

    const { object, replacedObject } = await finalizeUserStorageObject(ownerUserId, reserved.id);

    expect(object.status).toBe("ready");
    expect(replacedObject).toBeNull();
    const usage = await getUserStorageUsage(ownerUserId);
    expect(usage.usedBytes).toBe(500);
    expect(usage.reservedBytes).toBe(0);
    expect(usage.usedObjects).toBe(1);
  });

  test("finalizeUserStorageObject at an occupied virtualPath atomically replaces the previous ready object", async () => {
    const ownerUserId = await createUser("replace");
    const virtualPath = `/notes/${randomUUID()}.md`;

    const first = await reserveUserStorageObject(
      reserveInput(ownerUserId, { virtualPath, sizeBytes: 300 }),
    );
    await finalizeUserStorageObject(ownerUserId, first.id);

    const second = await reserveUserStorageObject(
      reserveInput(ownerUserId, { virtualPath, sizeBytes: 700 }),
    );
    const { replacedObject } = await finalizeUserStorageObject(ownerUserId, second.id);

    expect(replacedObject?.id).toBe(first.id);
    expect(await getUserStorageObject(ownerUserId, first.id)).toBeUndefined();
    const current = await getUserStorageObject(ownerUserId, second.id);
    expect(current?.virtualPath).toBe(virtualPath);

    // Only the winning object's bytes remain accounted for — not both.
    const usage = await getUserStorageUsage(ownerUserId);
    expect(usage.usedBytes).toBe(700);
    expect(usage.usedObjects).toBe(1);
  });

  test("releaseUserStorageReservation discards a pending object and frees its reservation", async () => {
    const ownerUserId = await createUser("release");
    const reserved = await reserveUserStorageObject(reserveInput(ownerUserId, { sizeBytes: 900 }));

    await releaseUserStorageReservation(ownerUserId, reserved.id);

    const usage = await getUserStorageUsage(ownerUserId);
    expect(usage.reservedBytes).toBe(0);
    expect(usage.reservedObjects).toBe(0);
    expect(usage.usedBytes).toBe(0);
  });

  test("deleteUserStorageObject removes a ready object and decrements used counters", async () => {
    const ownerUserId = await createUser("delete");
    const reserved = await reserveUserStorageObject(reserveInput(ownerUserId, { sizeBytes: 400 }));
    await finalizeUserStorageObject(ownerUserId, reserved.id);

    const deleted = await deleteUserStorageObject(ownerUserId, reserved.id);

    expect(deleted?.id).toBe(reserved.id);
    const usage = await getUserStorageUsage(ownerUserId);
    expect(usage.usedBytes).toBe(0);
    expect(usage.usedObjects).toBe(0);
  });

  test("deleteUserStorageObject returns null for an object that is not in ready state", async () => {
    const ownerUserId = await createUser("delete-pending");
    const reserved = await reserveUserStorageObject(reserveInput(ownerUserId, { sizeBytes: 10 }));

    const deleted = await deleteUserStorageObject(ownerUserId, reserved.id);

    expect(deleted).toBeNull();
  });

  test("releaseExpiredUserStorageReservations sweeps only reservations past their expiry", async () => {
    const ownerUserId = await createUser("expired");
    const expired = await reserveUserStorageObject(reserveInput(ownerUserId, { sizeBytes: 111 }));
    await db.execute(sql`
      UPDATE user_storage_objects
      SET reservation_expires_at = NOW() - INTERVAL '1 hour'
      WHERE id = ${expired.id}
    `);
    const fresh = await reserveUserStorageObject(reserveInput(ownerUserId, { sizeBytes: 222 }));
    await db.execute(sql`
      UPDATE user_storage_objects
      SET reservation_expires_at = NOW() + INTERVAL '1 hour'
      WHERE id = ${fresh.id}
    `);

    const swept = await releaseExpiredUserStorageReservations(ownerUserId);

    expect(swept.map((o) => o.id)).toEqual([expired.id]);
    expect(await getUserStorageObject(ownerUserId, fresh.id)).toBeUndefined(); // still pending, not "ready"
    const usage = await getUserStorageUsage(ownerUserId);
    expect(usage.reservedBytes).toBe(222);
  });

  test("deletion outbox: claim leases candidates, complete removes them, fail reschedules with backoff", async () => {
    const objectKey = `outbox-${randomUUID()}`;
    createdObjectKeys.push(objectKey);
    const ownerUserId = await createUser("outbox");
    await db.execute(sql`
      INSERT INTO user_storage_deletions (object_key, owner_user_id, next_attempt_at)
      VALUES (${objectKey}, ${ownerUserId}, NOW() - INTERVAL '1 minute')
    `);

    const claimed = await claimUserStorageDeletions({ limit: 10 });
    const ours = claimed.find((row) => row.objectKey === objectKey);
    expect(ours).toBeDefined();
    expect(ours!.attempts).toBe(1);
    expect(ours!.leaseExpiresAt).not.toBeNull();

    // Leased row must not be reclaimed by a second, immediate claim.
    const reclaimed = await claimUserStorageDeletions({ limit: 10 });
    expect(reclaimed.some((row) => row.objectKey === objectKey)).toBe(false);

    await failUserStorageDeletion(objectKey, ours!.attempts, "s3 timeout");
    const [afterFail] = await db.execute(
      sql`SELECT lease_expires_at, next_attempt_at, last_error FROM user_storage_deletions WHERE object_key = ${objectKey}`,
    ) as unknown as Array<{ lease_expires_at: Date | null; next_attempt_at: Date; last_error: string }>;
    expect(afterFail.lease_expires_at).toBeNull();
    expect(new Date(afterFail.next_attempt_at).getTime()).toBeGreaterThan(Date.now());
    expect(afterFail.last_error).toBe("s3 timeout");

    await completeUserStorageDeletion(objectKey);
    const remaining = await db.execute(
      sql`SELECT 1 FROM user_storage_deletions WHERE object_key = ${objectKey}`,
    );
    expect((remaining as unknown as unknown[]).length).toBe(0);
  });
});
