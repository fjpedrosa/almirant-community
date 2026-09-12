import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { Database } from "../../client";
import { piOpenaiConnectionLeases } from "../../schema/pi-openai-connection-leases";
import { agentJobs } from "../../schema/agent-jobs";
import { providerConnections } from "../../schema/provider-connections";

export const PI_OPENAI_CONNECTION_LEASE_TTL_MS = 6 * 60 * 60 * 1000;

type LeaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type PiOpenAiConnectionLeaseOwnership = Readonly<{
  connectionId: string;
  jobId: string;
  workerId: string;
  claimAttemptId: string;
  credentialVersion: string;
}>;
type TimedLeaseOwnership = PiOpenAiConnectionLeaseOwnership & Readonly<{ now: number }>;
export type PiOpenAiConnectionLeaseAcquireResult = Readonly<{
  outcome: "invalid" | "connection_ineligible" | "credential_version_conflict" |
    "conflict" | "acquired" | "idempotent";
}>;
export type PiOpenAiConnectionLeaseRenewResult = Readonly<{
  outcome: "invalid" | "connection_ineligible" | "credential_version_conflict" |
    "missing" | "conflict" | "expired" | "renewed";
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

const timestamp = (milliseconds: number) => {
  const date = new Date(milliseconds);
  // PostgreSQL accepts extended positive years without JavaScript's leading '+'.
  return date.getUTCFullYear() > 9999 ? sql`${date.toISOString().slice(1)}::timestamptz` : date;
};

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

/** Dormant acquisition inside the caller's transaction, locking job -> connection -> lease. */
export const acquirePiOpenAiConnectionLeaseWith = async (
  transaction: LeaseTransaction,
  input: TimedLeaseOwnership,
): Promise<PiOpenAiConnectionLeaseAcquireResult> => {
  if (!validOwnership(input) || !validNow(input.now)) return { outcome: "invalid" };
  const credentialVersion = new Date(input.credentialVersion);
  const [job] = await transaction.select({ id: agentJobs.id }).from(agentJobs)
    .where(eq(agentJobs.id, input.jobId)).for("update").limit(1);
  if (!job) return { outcome: "invalid" };

  const [connection] = await transaction.select({
    provider: providerConnections.provider, category: providerConnections.category,
    isActive: providerConnections.isActive, suspendedAt: providerConnections.suspendedAt,
    scope: providerConnections.scope, scopeId: providerConnections.scopeId,
    config: providerConnections.config, updatedAt: providerConnections.updatedAt,
  }).from(providerConnections).where(eq(providerConnections.id, input.connectionId))
    .for("update").limit(1);
  const config = connection?.config;
  if (!connection || connection.provider !== "openai" || connection.category !== "ai" ||
    connection.isActive !== true || connection.suspendedAt !== null ||
    !config || typeof config !== "object" || Array.isArray(config) ||
    !("authMethod" in config) || (config.authMethod !== "subscription" && config.authMethod !== "oauth")) {
    return { outcome: "connection_ineligible" };
  }
  if (connection.updatedAt.getTime() !== credentialVersion.getTime()) {
    return { outcome: "credential_version_conflict" };
  }
  if (connection.scope !== "organization" && connection.scope !== "user") {
    return { outcome: "connection_ineligible" };
  }

  // Fence earlier generic subscription selection while holding the connection lock.
  // Once provider/auth match, missing or malformed coding agents still conflict; only exact Pi is exempt.
  const [genericJob] = await transaction.select({ id: agentJobs.id }).from(agentJobs)
    .where(and(
      ne(agentJobs.id, input.jobId),
      inArray(agentJobs.status, ["running", "finalizing", "waiting_for_input"]),
      connection.scope === "organization"
        ? eq(agentJobs.workspaceId, connection.scopeId)
        : eq(agentJobs.createdByUserId, connection.scopeId),
      sql`${agentJobs.resolvedRuntimeSelection} ->> 'aiProvider' = 'openai'`,
      sql`${agentJobs.resolvedRuntimeSelection} ->> 'authClass' = 'subscription'`,
      sql`${agentJobs.resolvedRuntimeSelection} ->> 'codingAgent' IS DISTINCT FROM 'pi'`,
    )).limit(1);
  if (genericJob) return { outcome: "conflict" };

  const lease = await lockedLease(transaction, input.connectionId);
  const now = timestamp(input.now);
  const expiresAt = timestamp(input.now + PI_OPENAI_CONNECTION_LEASE_TTL_MS);
  if (lease && exactOwner(lease, input)) {
    await transaction.update(piOpenaiConnectionLeases).set({ expiresAt, updatedAt: now })
      .where(and(
        eq(piOpenaiConnectionLeases.connectionId, input.connectionId),
        eq(piOpenaiConnectionLeases.jobId, input.jobId),
        eq(piOpenaiConnectionLeases.workerId, input.workerId),
        eq(piOpenaiConnectionLeases.claimAttemptId, input.claimAttemptId),
        eq(piOpenaiConnectionLeases.credentialVersion, credentialVersion),
      ));
    return { outcome: "idempotent" };
  }
  if (lease && lease.expiresAt.getTime() > input.now) return { outcome: "conflict" };
  if (lease) {
    await transaction.delete(piOpenaiConnectionLeases)
      .where(eq(piOpenaiConnectionLeases.connectionId, input.connectionId));
  }
  const [inserted] = await transaction.insert(piOpenaiConnectionLeases).values({
    connectionId: input.connectionId, jobId: input.jobId,
    workerId: input.workerId, claimAttemptId: input.claimAttemptId,
    credentialVersion, expiresAt, createdAt: now, updatedAt: now,
  }).onConflictDoNothing().returning({ connectionId: piOpenaiConnectionLeases.connectionId });
  return { outcome: inserted ? "acquired" : "conflict" };
};

/** Extend only an exact active owner, locking job -> connection -> lease. */
export const renewPiOpenAiConnectionLeaseWith = async (
  transaction: LeaseTransaction,
  input: TimedLeaseOwnership,
): Promise<PiOpenAiConnectionLeaseRenewResult> => {
  if (!validOwnership(input) || !validNow(input.now)) return { outcome: "invalid" };
  const credentialVersion = new Date(input.credentialVersion);
  const [job] = await transaction.select({ id: agentJobs.id }).from(agentJobs)
    .where(eq(agentJobs.id, input.jobId)).for("update").limit(1);
  if (!job) return { outcome: "invalid" };

  const [connection] = await transaction.select({
    provider: providerConnections.provider, category: providerConnections.category,
    isActive: providerConnections.isActive, suspendedAt: providerConnections.suspendedAt,
    config: providerConnections.config, updatedAt: providerConnections.updatedAt,
  }).from(providerConnections).where(eq(providerConnections.id, input.connectionId))
    .for("update").limit(1);
  const config = connection?.config;
  if (!connection || connection.provider !== "openai" || connection.category !== "ai" ||
    connection.isActive !== true || connection.suspendedAt !== null ||
    !config || typeof config !== "object" || Array.isArray(config) ||
    !("authMethod" in config) || (config.authMethod !== "subscription" && config.authMethod !== "oauth")) {
    return { outcome: "connection_ineligible" };
  }
  if (connection.updatedAt.getTime() !== credentialVersion.getTime()) {
    return { outcome: "credential_version_conflict" };
  }

  const lease = await lockedLease(transaction, input.connectionId);
  if (!lease) return { outcome: "missing" };
  if (!exactOwner(lease, input)) return { outcome: "conflict" };
  if (lease.expiresAt.getTime() <= input.now) return { outcome: "expired" };
  await transaction.update(piOpenaiConnectionLeases).set({
    expiresAt: timestamp(input.now + PI_OPENAI_CONNECTION_LEASE_TTL_MS), updatedAt: timestamp(input.now),
  }).where(and(
    eq(piOpenaiConnectionLeases.connectionId, input.connectionId),
    eq(piOpenaiConnectionLeases.jobId, input.jobId),
    eq(piOpenaiConnectionLeases.workerId, input.workerId),
    eq(piOpenaiConnectionLeases.claimAttemptId, input.claimAttemptId),
    eq(piOpenaiConnectionLeases.credentialVersion, credentialVersion),
  ));
  return { outcome: "renewed" };
};

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
