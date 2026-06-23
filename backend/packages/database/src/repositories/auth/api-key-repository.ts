import { createHash, randomBytes } from "crypto";
import { db } from "../../client";
import { apiKeys } from "../../schema";
import { eq, and, desc } from "drizzle-orm";
import type { ApiKey } from "../../schema/api-keys";

const KEY_PREFIX = "alm_k1_";
const LEGACY_KEY_PREFIX = "crm_k1_";
export const SA_KEY_PREFIX = "alm_sa_";

const hashKey = (raw: string): string => {
  return createHash("sha256").update(raw).digest("hex");
};

// Create a new API key — returns the plaintext key (shown only once)
export const createApiKey = async (
  organizationId: string,
  name: string,
  opts?: { userId?: string; serviceAccountId?: string; keyPrefix?: string; allowedIssuedPermissions?: string[] }
): Promise<{
  id: string;
  name: string;
  keyPrefix: string;
  key: string;
  createdAt: Date;
}> => {
  const prefix = opts?.keyPrefix ?? KEY_PREFIX;
  const rawHex = randomBytes(32).toString("hex");
  const plaintextKey = `${prefix}${rawHex}`;
  const keyHash = hashKey(rawHex);
  const keyPrefix = `${prefix}${rawHex.slice(0, 8)}`;

  const [created] = await db
    .insert(apiKeys)
    .values({
      name,
      keyHash,
      keyPrefix,
      organizationId,
      ...(opts?.userId ? { userId: opts.userId } : {}),
      ...(opts?.serviceAccountId ? { serviceAccountId: opts.serviceAccountId } : {}),
      ...(opts?.allowedIssuedPermissions ? { allowedIssuedPermissions: opts.allowedIssuedPermissions } : {}),
    })
    .returning();

  if (!created) throw new Error("Failed to create API key");

  return {
    id: created.id,
    name: created.name,
    keyPrefix: created.keyPrefix,
    key: plaintextKey,
    createdAt: created.createdAt,
  };
};

// Find an active API key by its hash
export const getApiKeyByHash = async (
  keyHash: string
): Promise<ApiKey | null> => {
  const [row] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, keyHash), eq(apiKeys.isActive, true)))
    .limit(1);

  return row || null;
};

// Validate a raw API key string — updates lastUsedAt on success
export const validateApiKey = async (
  rawKey: string
): Promise<ApiKey | null> => {
  const stripped = rawKey.startsWith(KEY_PREFIX)
    ? rawKey.slice(KEY_PREFIX.length)
    : rawKey.startsWith(SA_KEY_PREFIX)
      ? rawKey.slice(SA_KEY_PREFIX.length)
      : rawKey.startsWith(LEGACY_KEY_PREFIX)
        ? rawKey.slice(LEGACY_KEY_PREFIX.length)
        : rawKey;

  const keyHash = hashKey(stripped);
  const row = await getApiKeyByHash(keyHash);

  if (!row) {
    return null;
  }

  await updateLastUsed(row.id);
  return row;
};

// List all API keys (never exposes keyHash)
export const listApiKeys = async (
  organizationId: string,
  userId?: string
): Promise<
  Omit<ApiKey, "keyHash">[]
> => {
  const conditions = [
    eq(apiKeys.organizationId, organizationId),
    eq(apiKeys.isActive, true),
  ];
  if (userId) {
    conditions.push(eq(apiKeys.userId, userId));
  }

  const rows = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      isActive: apiKeys.isActive,
      userId: apiKeys.userId,
      serviceAccountId: apiKeys.serviceAccountId,
      organizationId: apiKeys.organizationId,
      allowedIssuedPermissions: apiKeys.allowedIssuedPermissions,
      lastUsedAt: apiKeys.lastUsedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(and(...conditions))
    .orderBy(desc(apiKeys.createdAt));

  return rows;
};

// Revoke an API key (soft-delete by setting isActive = false)
export const revokeApiKey = async (organizationId: string, id: string): Promise<boolean> => {
  const [updated] = await db
    .update(apiKeys)
    .set({ isActive: false })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.organizationId, organizationId)))
    .returning();

  return !!updated;
};

// Update the lastUsedAt timestamp
export const updateLastUsed = async (id: string): Promise<void> => {
  await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, id));
};
