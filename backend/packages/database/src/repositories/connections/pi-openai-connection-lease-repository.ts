import { and, eq } from "drizzle-orm";
import type { Database } from "../../client";
import { piOpenaiConnectionLeases } from "../../schema/pi-openai-connection-leases";

type LeaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type PiOpenAiConnectionLeaseOwnership = Readonly<{
  connectionId: string;
  jobId: string;
  workerId: string;
  claimAttemptId: string;
  credentialVersion: string;
}>;
export type PiOpenAiConnectionLeaseRequireResult = Readonly<{
  outcome: "invalid" | "missing" | "conflict" | "expired" | "valid";
}>;
export type PiOpenAiConnectionLeaseReleaseResult = Readonly<{
  outcome: "invalid" | "conflict" | "released";
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const validId = (value: unknown): boolean => typeof value === "string" && UUID.test(value);
const exactString = (value: unknown, max: number): boolean =>
  typeof value === "string" && value.length > 0 && value.length <= max && value.trim() === value;
const canonicalVersion = (value: unknown): boolean => {
  if (typeof value !== "string" || value.length > 64) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
};
const validOwnership = (owner: PiOpenAiConnectionLeaseOwnership): boolean =>
  owner !== null && typeof owner === "object" && !Array.isArray(owner) &&
  validId(owner.connectionId) && validId(owner.jobId) &&
  exactString(owner.workerId, 255) && exactString(owner.claimAttemptId, 100) &&
  canonicalVersion(owner.credentialVersion);
const validNow = (now: number): boolean =>
  Number.isSafeInteger(now) && now > 0 &&
  Number.isFinite(new Date(now).getTime()) &&
  Number.isFinite(new Date(now + 6 * 60 * 60 * 1000).getTime());

const lockedLease = async (transaction: LeaseTransaction, connectionId: string) => {
  const [lease] = await transaction.select().from(piOpenaiConnectionLeases)
    .where(eq(piOpenaiConnectionLeases.connectionId, connectionId))
    .for("update").limit(1);
  return lease;
};
const exactOwner = (
  lease: typeof piOpenaiConnectionLeases.$inferSelect,
  owner: PiOpenAiConnectionLeaseOwnership,
): boolean =>
  lease.connectionId === owner.connectionId && lease.jobId === owner.jobId &&
  lease.workerId === owner.workerId && lease.claimAttemptId === owner.claimAttemptId &&
  lease.credentialVersion.getTime() === new Date(owner.credentialVersion).getTime();

/** Metadata-only check inside the caller's transaction; mismatches precede expiry. */
export const requirePiOpenAiConnectionLeaseWith = async (
  transaction: LeaseTransaction,
  ownership: PiOpenAiConnectionLeaseOwnership,
  now: number,
): Promise<PiOpenAiConnectionLeaseRequireResult> => {
  if (!validOwnership(ownership) || !validNow(now)) return { outcome: "invalid" };
  const lease = await lockedLease(transaction, ownership.connectionId);
  if (!lease) return { outcome: "missing" };
  if (!exactOwner(lease, ownership)) return { outcome: "conflict" };
  return { outcome: lease.expiresAt.getTime() <= now ? "expired" : "valid" };
};

/** Exact-owner release ignores expiry; absence is an idempotent successful replay. */
export const releasePiOpenAiConnectionLeaseWith = async (
  transaction: LeaseTransaction,
  ownership: PiOpenAiConnectionLeaseOwnership,
): Promise<PiOpenAiConnectionLeaseReleaseResult> => {
  if (!validOwnership(ownership)) return { outcome: "invalid" };
  const lease = await lockedLease(transaction, ownership.connectionId);
  if (!lease) return { outcome: "released" };
  if (!exactOwner(lease, ownership)) return { outcome: "conflict" };
  await transaction.delete(piOpenaiConnectionLeases).where(and(
    eq(piOpenaiConnectionLeases.connectionId, ownership.connectionId),
    eq(piOpenaiConnectionLeases.jobId, ownership.jobId),
    eq(piOpenaiConnectionLeases.workerId, ownership.workerId),
    eq(piOpenaiConnectionLeases.claimAttemptId, ownership.claimAttemptId),
    eq(piOpenaiConnectionLeases.credentialVersion, new Date(ownership.credentialVersion)),
  ));
  return { outcome: "released" };
};
