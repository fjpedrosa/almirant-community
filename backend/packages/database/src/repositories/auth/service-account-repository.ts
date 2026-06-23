import { createHash, randomBytes } from "crypto";
import { db } from "../../client";
import { serviceAccounts, apiKeys } from "../../schema";
import { eq, and, desc } from "drizzle-orm";
import type { ServiceAccount } from "../../schema/service-accounts";
import { SA_KEY_PREFIX } from "./api-key-repository";

const hashKey = (raw: string): string => {
  return createHash("sha256").update(raw).digest("hex");
};

// ---------------------------------------------------------------------------
// Create a service account (without an API key)
// ---------------------------------------------------------------------------
export const createServiceAccount = async (
  organizationId: string,
  name: string,
  type: "runner" | "integration"
): Promise<ServiceAccount> => {
  const [created] = await db
    .insert(serviceAccounts)
    .values({ organizationId, name, type })
    .returning();

  if (!created) throw new Error("Failed to create service account");

  return created;
};

// ---------------------------------------------------------------------------
// List all active service accounts for an organization (with active key prefix)
// ---------------------------------------------------------------------------
export const getServiceAccountsByOrg = async (
  organizationId: string
): Promise<(ServiceAccount & { keyPrefix: string | null })[]> => {
  const rows = await db
    .select({
      id: serviceAccounts.id,
      organizationId: serviceAccounts.organizationId,
      name: serviceAccounts.name,
      type: serviceAccounts.type,
      isActive: serviceAccounts.isActive,
      createdAt: serviceAccounts.createdAt,
      updatedAt: serviceAccounts.updatedAt,
      keyPrefix: apiKeys.keyPrefix,
    })
    .from(serviceAccounts)
    .leftJoin(
      apiKeys,
      and(
        eq(apiKeys.serviceAccountId, serviceAccounts.id),
        eq(apiKeys.isActive, true)
      )
    )
    .where(
      and(
        eq(serviceAccounts.organizationId, organizationId),
        eq(serviceAccounts.isActive, true)
      )
    )
    .orderBy(desc(serviceAccounts.createdAt));

  return rows;
};

// ---------------------------------------------------------------------------
// Get a single service account by ID (with org ownership check)
// ---------------------------------------------------------------------------
export const getServiceAccountById = async (
  organizationId: string,
  id: string
): Promise<ServiceAccount | null> => {
  const [row] = await db
    .select()
    .from(serviceAccounts)
    .where(
      and(
        eq(serviceAccounts.id, id),
        eq(serviceAccounts.organizationId, organizationId)
      )
    )
    .limit(1);

  return row ?? null;
};

// ---------------------------------------------------------------------------
// Deactivate a service account and revoke all its active API keys
// ---------------------------------------------------------------------------
export const deactivateServiceAccount = async (
  organizationId: string,
  id: string
): Promise<boolean> => {
  return db.transaction(async (tx) => {
    // Deactivate the service account
    const [updated] = await tx
      .update(serviceAccounts)
      .set({ isActive: false, updatedAt: new Date() })
      .where(
        and(
          eq(serviceAccounts.id, id),
          eq(serviceAccounts.organizationId, organizationId)
        )
      )
      .returning();

    if (!updated) return false;

    // Revoke all active API keys belonging to this service account
    await tx
      .update(apiKeys)
      .set({ isActive: false })
      .where(
        and(
          eq(apiKeys.serviceAccountId, id),
          eq(apiKeys.isActive, true)
        )
      );

    return true;
  });
};

// ---------------------------------------------------------------------------
// Create a service account with its first API key (transactional)
// Returns the plaintext key (shown only once)
// ---------------------------------------------------------------------------
export const createServiceAccountWithKey = async (
  organizationId: string,
  name: string,
  type: "runner" | "integration"
): Promise<{ serviceAccount: ServiceAccount; key: string }> => {
  return db.transaction(async (tx) => {
    // Create the service account
    const [sa] = await tx
      .insert(serviceAccounts)
      .values({ organizationId, name, type })
      .returning();

    if (!sa) throw new Error("Failed to create service account");

    // Create an API key linked to the service account within the same
    // transaction to ensure atomicity (SA + key created together)
    const rawHex = randomBytes(32).toString("hex");
    const plaintextKey = `${SA_KEY_PREFIX}${rawHex}`;
    const keyHash = hashKey(rawHex);
    const keyPrefix = `${SA_KEY_PREFIX}${rawHex.slice(0, 8)}`;

    await tx.insert(apiKeys).values({
      name: `${name} API Key`,
      keyHash,
      keyPrefix,
      organizationId,
      serviceAccountId: sa.id,
    });

    return { serviceAccount: sa, key: plaintextKey };
  });
};

// ---------------------------------------------------------------------------
// Provision the default "runner" service account for an organization.
// Idempotent: returns null if a runner SA already exists.
// ---------------------------------------------------------------------------
export const provisionDefaultServiceAccount = async (
  organizationId: string
): Promise<{ serviceAccount: ServiceAccount; key: string } | null> => {
  const existing = await db
    .select()
    .from(serviceAccounts)
    .where(
      and(
        eq(serviceAccounts.organizationId, organizationId),
        eq(serviceAccounts.type, "runner"),
        eq(serviceAccounts.isActive, true)
      )
    )
    .limit(1);

  if (existing.length > 0) return null; // Already provisioned

  return createServiceAccountWithKey(organizationId, "Default Runner", "runner");
};

// ---------------------------------------------------------------------------
// Rotate the API key for a service account: revoke all existing keys, create
// a new one. Returns the new plaintext key (shown only once).
// ---------------------------------------------------------------------------
export const rotateServiceAccountKey = async (
  organizationId: string,
  serviceAccountId: string
): Promise<{ key: string; keyPrefix: string }> => {
  // Verify the service account exists and belongs to the org
  const sa = await getServiceAccountById(organizationId, serviceAccountId);
  if (!sa) throw new Error("Service account not found");
  if (!sa.isActive) throw new Error("Service account is deactivated");

  // Revoke all active keys for this SA, then create a new one
  return db.transaction(async (tx) => {
    await tx
      .update(apiKeys)
      .set({ isActive: false })
      .where(
        and(
          eq(apiKeys.serviceAccountId, serviceAccountId),
          eq(apiKeys.isActive, true)
        )
      );

    const rawHex = randomBytes(32).toString("hex");
    const plaintextKey = `${SA_KEY_PREFIX}${rawHex}`;
    const keyHash = hashKey(rawHex);
    const keyPrefix = `${SA_KEY_PREFIX}${rawHex.slice(0, 8)}`;

    await tx.insert(apiKeys).values({
      name: `${sa.name} API Key`,
      keyHash,
      keyPrefix,
      organizationId,
      serviceAccountId,
    });

    return { key: plaintextKey, keyPrefix };
  });
};
