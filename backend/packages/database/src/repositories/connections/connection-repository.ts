import { db } from "../../client";
import { providerConnections, workspaceSettings, member } from "../../schema";
import { eq, and, asc, desc, sql, isNull, inArray, type SQL } from "drizzle-orm";
import type {
  ProviderConnection,
  NewProviderConnection,
} from "../../schema/provider-connections";
import type {
  WorkspaceSettings,
  NewWorkspaceSettings,
} from "../../schema/workspace-settings";
import { logger } from "@almirant/config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ConnectionCategory = ProviderConnection["category"];
type ConnectionScope = ProviderConnection["scope"];

/** Optional scope filter for verifying ownership when fetching/updating by ID. */
export interface ScopeFilter {
  scope: ConnectionScope;
  scopeId: string;
}

/** Fields returned in listings (no encrypted credential data). */
type ConnectionMetadata = Omit<
  ProviderConnection,
  "encryptedCredentials" | "credentialsIv" | "credentialsAuthTag"
>;

interface ListConnectionsFilters {
  scope?: ConnectionScope;
  scopeId?: string;
  scopeIds?: string[];
  provider?: ProviderConnection["provider"];
  category?: ConnectionCategory;
  isActive?: boolean;
}

/** Input data for creating a connection. Credentials are provided as a plain
 *  JSON object and will be encrypted internally if `encryptionKey` is passed. */
type CreateConnectionInput = Omit<
  NewProviderConnection,
  | "id"
  | "createdAt"
  | "updatedAt"
  | "encryptedCredentials"
  | "credentialsIv"
  | "credentialsAuthTag"
> & {
  credentials?: Record<string, unknown>;
};

/** Input data for updating a connection. */
type UpdateConnectionInput = Partial<
  Omit<
    NewProviderConnection,
    | "id"
    | "createdAt"
    | "updatedAt"
    | "encryptedCredentials"
    | "credentialsIv"
    | "credentialsAuthTag"
  > & {
    credentials?: Record<string, unknown>;
  }
>;

// ---------------------------------------------------------------------------
// Encryption helpers (re-implement locally to avoid cross-package dependency
// on the api layer; uses the same AES-256-GCM algorithm)
// ---------------------------------------------------------------------------

import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

/**
 * Encrypt a credentials object with AES-256-GCM.
 * Returns the three components needed for storage.
 */
export const encryptCredentials = (
  credentials: Record<string, unknown>,
  encryptionKey: string,
): {
  encryptedCredentials: string;
  credentialsIv: string;
  credentialsAuthTag: string;
} => {
  const plaintext = JSON.stringify(credentials);
  const key = Buffer.from(encryptionKey, "hex");
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");
  const authTag = cipher.getAuthTag().toString("base64");

  return {
    encryptedCredentials: encrypted,
    credentialsIv: iv.toString("base64"),
    credentialsAuthTag: authTag,
  };
};

/**
 * Decrypt credentials stored on a ProviderConnection row.
 * Returns the parsed JSON object. Throws if the row has no encrypted data.
 */
export const decryptCredentials = (
  connection: Pick<
    ProviderConnection,
    "encryptedCredentials" | "credentialsIv" | "credentialsAuthTag"
  >,
  encryptionKey: string,
): Record<string, unknown> => {
  const { encryptedCredentials, credentialsIv, credentialsAuthTag } =
    connection;
  if (!encryptedCredentials || !credentialsIv || !credentialsAuthTag) {
    throw new Error(
      "Connection has no encrypted credentials to decrypt",
    );
  }

  const key = Buffer.from(encryptionKey, "hex");
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(credentialsIv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(credentialsAuthTag, "base64"));

  let decrypted = decipher.update(encryptedCredentials, "base64", "utf8");
  decrypted += decipher.final("utf8");

  return JSON.parse(decrypted) as Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Scope-category validation
// ---------------------------------------------------------------------------

/**
 * Validates that the given scope is allowed for the given category.
 *
 * Rules:
 *  - code       -> user or workspace (user = personal GitHub account)
 *  - ai         -> user or workspace
 *  - deployment -> workspace only
 *  - monitoring -> workspace only
 */
export const validateScopeForCategory = (
  scope: ConnectionScope,
  category: ConnectionCategory,
): boolean => {
  switch (category) {
    case "code":
    case "ai":
      return scope === "user" || scope === "organization";
    case "deployment":
    case "monitoring":
      return scope === "organization";
    default:
      return false;
  }
};

// ---------------------------------------------------------------------------
// Metadata column selection (excludes encrypted credential fields)
// ---------------------------------------------------------------------------

const metadataColumns = {
  id: providerConnections.id,
  provider: providerConnections.provider,
  category: providerConnections.category,
  scope: providerConnections.scope,
  scopeId: providerConnections.scopeId,
  createdByUserId: providerConnections.createdByUserId,
  name: providerConnections.name,
  accountIdentifier: providerConnections.accountIdentifier,
  isActive: providerConnections.isActive,
  isDefault: providerConnections.isDefault,
  orchestrationEnabled: providerConnections.orchestrationEnabled,
  priority: providerConnections.priority,
  lastUsedAt: providerConnections.lastUsedAt,
  suspendedAt: providerConnections.suspendedAt,
  tokenExpiresAt: providerConnections.tokenExpiresAt,
  lastValidatedAt: providerConnections.lastValidatedAt,
  lastValidationStatus: providerConnections.lastValidationStatus,
  lastValidationError: providerConnections.lastValidationError,
  config: providerConnections.config,
  createdAt: providerConnections.createdAt,
  updatedAt: providerConnections.updatedAt,
} as const;

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * Create a new provider connection.
 *
 * - Validates scope/category rules before inserting.
 * - If `credentials` + `encryptionKey` are provided, encrypts them automatically.
 * - Auto-sets `is_default = true` when creating first connection for provider+scope.
 */
export const createConnection = async (
  data: CreateConnectionInput,
  encryptionKey?: string,
): Promise<ConnectionMetadata> => {
  if (!validateScopeForCategory(data.scope, data.category)) {
    throw new Error(
      `Invalid scope "${data.scope}" for category "${data.category}". ` +
        `Code and deployment connections must be workspace-scoped.`,
    );
  }

  const { credentials, ...rest } = data;

  let encryptedFields: {
    encryptedCredentials?: string;
    credentialsIv?: string;
    credentialsAuthTag?: string;
  } = {};

  if (credentials && encryptionKey) {
    encryptedFields = encryptCredentials(credentials, encryptionKey);
  }

  return await db.transaction(async (tx) => {
    // If isDefault is explicitly set to true, clear existing defaults
    if (data.isDefault === true) {
      await tx
        .update(providerConnections)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(
          and(
            eq(providerConnections.provider, data.provider),
            eq(providerConnections.scope, data.scope),
            eq(providerConnections.scopeId, data.scopeId),
            eq(providerConnections.isActive, true),
            eq(providerConnections.isDefault, true),
          ),
        );
    }

    // If isDefault is not specified, check if this is the first connection
    let shouldSetDefault = data.isDefault === true;
    const existingConnections = await tx
      .select({ id: providerConnections.id })
      .from(providerConnections)
      .where(
        and(
          eq(providerConnections.provider, data.provider),
          eq(providerConnections.scope, data.scope),
          eq(providerConnections.scopeId, data.scopeId),
          eq(providerConnections.isActive, true),
        ),
      );

    if (data.isDefault === undefined) {
      shouldSetDefault = existingConnections.length === 0;
    }

    // Auto-assign priority: use explicit value if provided, otherwise next available
    const priority = data.priority ?? existingConnections.length;

    const [created] = await tx
      .insert(providerConnections)
      .values({
        ...rest,
        ...encryptedFields,
        isDefault: shouldSetDefault,
        priority,
      })
      .returning(metadataColumns);

    if (!created) throw new Error("Failed to create provider connection");

    return created;
  });
};

/**
 * Get a connection by ID.
 *
 * - If `encryptionKey` is provided, returns the full row (caller can decrypt).
 * - Otherwise returns metadata only (no encrypted fields).
 */
export const getConnectionById = async (
  id: string,
  encryptionKey?: string,
  scopeFilter?: ScopeFilter,
): Promise<(ProviderConnection & { credentials?: Record<string, unknown> }) | null> => {
  const scopeConditions: SQL[] = [];
  if (scopeFilter) {
    scopeConditions.push(eq(providerConnections.scope, scopeFilter.scope));
    scopeConditions.push(eq(providerConnections.scopeId, scopeFilter.scopeId));
  }

  if (encryptionKey) {
    const [row] = await db
      .select()
      .from(providerConnections)
      .where(and(eq(providerConnections.id, id), ...scopeConditions))
      .limit(1);

    if (!row) return null;

    let credentials: Record<string, unknown> | undefined;
    if (row.encryptedCredentials && row.credentialsIv && row.credentialsAuthTag) {
      credentials = decryptCredentials(row, encryptionKey);
    }

    return { ...row, credentials };
  }

  // No encryption key: return metadata only, pad encrypted fields as null
  const [row] = await db
    .select(metadataColumns)
    .from(providerConnections)
    .where(and(eq(providerConnections.id, id), ...scopeConditions))
    .limit(1);

  if (!row) return null;

  return {
    ...row,
    encryptedCredentials: null,
    credentialsIv: null,
    credentialsAuthTag: null,
  };
};

/**
 * Get all workspace IDs a user belongs to.
 */
export const getWorkspaceIdsForUser = async (
  userId: string,
): Promise<string[]> => {
  const rows = await db
    .select({ workspaceId: member.workspaceId })
    .from(member)
    .where(eq(member.userId, userId));
  return rows.map((r) => r.workspaceId);
};

/**
 * List connections with optional filters.
 * Never returns encrypted credential data.
 */
export const listConnections = async (
  filters: ListConnectionsFilters = {},
): Promise<ConnectionMetadata[]> => {
  const conditions: SQL[] = [];

  if (filters.scope) {
    conditions.push(eq(providerConnections.scope, filters.scope));
  }
  if (filters.scopeIds && filters.scopeIds.length > 0) {
    conditions.push(inArray(providerConnections.scopeId, filters.scopeIds));
  } else if (filters.scopeId) {
    conditions.push(eq(providerConnections.scopeId, filters.scopeId));
  }
  if (filters.provider) {
    conditions.push(eq(providerConnections.provider, filters.provider));
  }
  if (filters.category) {
    conditions.push(eq(providerConnections.category, filters.category));
  }
  if (filters.isActive !== undefined) {
    conditions.push(eq(providerConnections.isActive, filters.isActive));
  }

  const query = db.select(metadataColumns).from(providerConnections);

  if (conditions.length > 0) {
    return query
      .where(and(...conditions))
      .orderBy(asc(providerConnections.priority), desc(providerConnections.isDefault), desc(providerConnections.updatedAt));
  }

  return query.orderBy(asc(providerConnections.priority), desc(providerConnections.isDefault), desc(providerConnections.updatedAt));
};

/**
 * Update an existing connection.
 *
 * - Validates scope/category rules if either field changes.
 * - If `credentials` + `encryptionKey` are provided, encrypts the new credentials.
 * - Handles `isDefault` updates with proper transaction logic.
 */
export const updateConnection = async (
  id: string,
  data: UpdateConnectionInput,
  encryptionKey?: string,
  scopeFilter?: ScopeFilter,
): Promise<ConnectionMetadata | null> => {
  return await db.transaction(async (tx) => {
    // Get current connection data for validation
    const scopeConditions: SQL[] = [eq(providerConnections.id, id)];
    if (scopeFilter) {
      scopeConditions.push(eq(providerConnections.scope, scopeFilter.scope));
      scopeConditions.push(eq(providerConnections.scopeId, scopeFilter.scopeId));
    }

    const [current] = await tx
      .select({
        scope: providerConnections.scope,
        category: providerConnections.category,
        provider: providerConnections.provider,
        scopeId: providerConnections.scopeId,
        isActive: providerConnections.isActive,
      })
      .from(providerConnections)
      .where(and(...scopeConditions))
      .limit(1);

    if (!current) return null;

    // Validate scope/category if being changed
    if (data.scope || data.category) {
      const finalScope = data.scope ?? current.scope;
      const finalCategory = data.category ?? current.category;

      if (!validateScopeForCategory(finalScope, finalCategory)) {
        throw new Error(
          `Invalid scope "${finalScope}" for category "${finalCategory}". ` +
            `Code and deployment connections must be workspace-scoped.`,
        );
      }
    }

    const { credentials, isDefault, ...rest } = data;

    let encryptedFields: {
      encryptedCredentials?: string;
      credentialsIv?: string;
      credentialsAuthTag?: string;
    } = {};

    if (credentials && encryptionKey) {
      encryptedFields = encryptCredentials(credentials, encryptionKey);
    }

    // Handle isDefault updates
    if (isDefault === true) {
      // Clear existing default for this provider+scope combination
      await tx
        .update(providerConnections)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(
          and(
            eq(providerConnections.provider, current.provider),
            eq(providerConnections.scope, current.scope),
            eq(providerConnections.scopeId, current.scopeId),
            eq(providerConnections.isActive, true),
            eq(providerConnections.isDefault, true),
          ),
        );
    }

    const [updated] = await tx
      .update(providerConnections)
      .set({ 
        ...rest, 
        ...encryptedFields,
        ...(isDefault !== undefined && { isDefault }),
        updatedAt: new Date(),
      })
      .where(eq(providerConnections.id, id))
      .returning(metadataColumns);

    return updated ?? null;
  });
};

/**
 * Soft-deactivate a connection (set isActive=false).
 * If the connection being deleted was the default, promotes the next most recent to default.
 */
export const deactivateConnection = async (
  id: string,
  scopeFilter?: ScopeFilter,
): Promise<boolean> => {
  return await db.transaction(async (tx) => {
    // Get the connection being deactivated
    const scopeConditions: SQL[] = [eq(providerConnections.id, id)];
    if (scopeFilter) {
      scopeConditions.push(eq(providerConnections.scope, scopeFilter.scope));
      scopeConditions.push(eq(providerConnections.scopeId, scopeFilter.scopeId));
    }

    const [connectionToDelete] = await tx
      .select({
        id: providerConnections.id,
        provider: providerConnections.provider,
        scope: providerConnections.scope,
        scopeId: providerConnections.scopeId,
        isDefault: providerConnections.isDefault,
      })
      .from(providerConnections)
      .where(and(...scopeConditions))
      .limit(1);

    if (!connectionToDelete) return false;

    // Deactivate the connection
    const [updated] = await tx
      .update(providerConnections)
      .set({ isActive: false, isDefault: false, updatedAt: new Date() })
      .where(eq(providerConnections.id, id))
      .returning({ id: providerConnections.id });

    if (!updated) return false;

    // If the deleted connection was the default, promote the next most recent
    if (connectionToDelete.isDefault) {
      const [nextConnection] = await tx
        .select({ id: providerConnections.id })
        .from(providerConnections)
        .where(
          and(
            eq(providerConnections.provider, connectionToDelete.provider),
            eq(providerConnections.scope, connectionToDelete.scope),
            eq(providerConnections.scopeId, connectionToDelete.scopeId),
            eq(providerConnections.isActive, true),
            eq(providerConnections.isDefault, false),
          ),
        )
        .orderBy(asc(providerConnections.priority), desc(providerConnections.updatedAt))
        .limit(1);

      if (nextConnection) {
        await tx
          .update(providerConnections)
          .set({ isDefault: true, updatedAt: new Date() })
          .where(eq(providerConnections.id, nextConnection.id));
      }
    }

    return true;
  });
};

/**
 * Set a connection as the default for its provider+scope combination.
 * Clears the existing default atomically.
 */
export const setConnectionAsDefault = async (
  id: string,
  scopeFilter?: ScopeFilter,
): Promise<ConnectionMetadata | null> => {
  return await db.transaction(async (tx) => {
    // Get the connection to be set as default
    const scopeConditions: SQL[] = [eq(providerConnections.id, id)];
    if (scopeFilter) {
      scopeConditions.push(eq(providerConnections.scope, scopeFilter.scope));
      scopeConditions.push(eq(providerConnections.scopeId, scopeFilter.scopeId));
    }

    const [connectionToUpdate] = await tx
      .select({
        id: providerConnections.id,
        provider: providerConnections.provider,
        scope: providerConnections.scope,
        scopeId: providerConnections.scopeId,
        isActive: providerConnections.isActive,
      })
      .from(providerConnections)
      .where(and(...scopeConditions))
      .limit(1);

    if (!connectionToUpdate || !connectionToUpdate.isActive) {
      return null;
    }

    // Clear existing default for this provider+scope combination
    await tx
      .update(providerConnections)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(
        and(
          eq(providerConnections.provider, connectionToUpdate.provider),
          eq(providerConnections.scope, connectionToUpdate.scope),
          eq(providerConnections.scopeId, connectionToUpdate.scopeId),
          eq(providerConnections.isActive, true),
          eq(providerConnections.isDefault, true),
        ),
      );

    // Set the new default
    const [updated] = await tx
      .update(providerConnections)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(eq(providerConnections.id, id))
      .returning(metadataColumns);

    return updated ?? null;
  });
};

/**
 * Find the first active connection matching the given criteria.
 * Returns the full row including encrypted fields so the caller can decrypt
 * after the fact using `decryptCredentials`.
 *
 * Prioritizes default connection first, then falls back to most-recently-updated.
 */
export const findActiveConnection = async (
  provider: ProviderConnection["provider"],
  scope: ConnectionScope,
  scopeId: string,
): Promise<ProviderConnection | null> => {
  const [row] = await db
    .select()
    .from(providerConnections)
    .where(
      and(
        eq(providerConnections.provider, provider),
        eq(providerConnections.scope, scope),
        eq(providerConnections.scopeId, scopeId),
        eq(providerConnections.isActive, true),
        isNull(providerConnections.suspendedAt),
      ),
    )
    .orderBy(asc(providerConnections.priority), desc(providerConnections.isDefault), desc(providerConnections.updatedAt))
    .limit(1);

  return row ?? null;
};

/**
 * Find ALL active, non-suspended connections for a given provider+scope,
 * ordered by priority (ascending). This enables fallback mechanisms where
 * the caller can try connections in priority order.
 */
export const findActiveConnections = async (
  provider: ProviderConnection["provider"],
  scope: ConnectionScope,
  scopeId: string,
): Promise<ProviderConnection[]> => {
  return db
    .select()
    .from(providerConnections)
    .where(
      and(
        eq(providerConnections.provider, provider),
        eq(providerConnections.scope, scope),
        eq(providerConnections.scopeId, scopeId),
        eq(providerConnections.isActive, true),
        isNull(providerConnections.suspendedAt),
      ),
    )
    .orderBy(asc(providerConnections.priority), desc(providerConnections.isDefault), desc(providerConnections.updatedAt));
};

/**
 * Update the priority of a single connection.
 * Lower number = higher priority (0 is highest).
 */
export const updateConnectionPriority = async (
  id: string,
  priority: number,
  scopeFilter?: ScopeFilter,
): Promise<ConnectionMetadata | null> => {
  const scopeConditions: SQL[] = [eq(providerConnections.id, id)];
  if (scopeFilter) {
    scopeConditions.push(eq(providerConnections.scope, scopeFilter.scope));
    scopeConditions.push(eq(providerConnections.scopeId, scopeFilter.scopeId));
  }

  const [updated] = await db
    .update(providerConnections)
    .set({ priority, updatedAt: new Date() })
    .where(and(...scopeConditions))
    .returning(metadataColumns);

  return updated ?? null;
};

// ---------------------------------------------------------------------------
// Convenience helpers for AI provider keys (backward-compatible shims)
// ---------------------------------------------------------------------------

/**
 * Map AI provider name to the provider_type enum value used in provider_connections.
 * Legacy "openai-compatible" and "openai_compatible" values are mapped to "zai".
 */
export const mapAiProviderToConnectionProvider = (
  provider: string,
): ProviderConnection["provider"] => {
  if (provider === "openai-compatible") return "zai";
  if (provider === "openai_compatible") return "zai";
  return provider as ProviderConnection["provider"];
};

/**
 * Map provider_type enum back to the ai_provider format.
 */
export const mapConnectionProviderToAiProvider = (
  provider: ProviderConnection["provider"],
): string => {
  return provider;
};

/**
 * Create an AI provider key as a provider_connection.
 *
 * Accepts the same shape that provider-keys.routes.ts used to pass to
 * createProviderApiKey, plus an encryptionKey.
 */
export const createAiProviderKey = async (
  data: {
    userId: string;
    name: string;
    provider: string;
    apiKey: string;
    keyPrefix: string;
    baseUrl?: string | null;
    authMethod?: string;
    refreshToken?: string | null;
    tokenExpiresAt?: Date | null;
    oauthScopes?: string | null;
  },
  encryptionKey: string,
): Promise<ConnectionMetadata> => {
  const credBlob: Record<string, unknown> = { apiKey: data.apiKey };
  if (data.refreshToken) credBlob.refreshToken = data.refreshToken;
  if (data.baseUrl) credBlob.baseUrl = data.baseUrl;
  if (data.authMethod) credBlob.authMethod = data.authMethod;
  if (data.oauthScopes) credBlob.oauthScopes = data.oauthScopes;

  const encryptedFields = encryptCredentials(credBlob, encryptionKey);

  const config: Record<string, unknown> = {
    keyPrefix: data.keyPrefix,
    baseUrl: data.baseUrl ?? null,
    authMethod: data.authMethod ?? "api_key",
  };
  if (data.oauthScopes) config.oauthScopes = data.oauthScopes;

  const [created] = await db
    .insert(providerConnections)
    .values({
      provider: mapAiProviderToConnectionProvider(data.provider),
      category: "ai",
      scope: "user",
      scopeId: data.userId,
      createdByUserId: data.userId,
      name: data.name,
      accountIdentifier: data.keyPrefix,
      isActive: true,
      tokenExpiresAt: data.tokenExpiresAt ?? null,
      ...encryptedFields,
      config,
    })
    .returning(metadataColumns);

  if (!created) throw new Error("Failed to create AI provider key connection");
  return created;
};

/**
 * List AI provider keys for a user (returns metadata, no encrypted data).
 */
export const getAiProviderKeysByUserId = async (
  userId: string,
): Promise<ConnectionMetadata[]> => {
  return listConnections({
    scope: "user",
    scopeId: userId,
    category: "ai",
  });
};

/**
 * Get a single AI provider key by ID, including encrypted credential fields
 * so the caller can decrypt.
 *
 * Returns a shape that is compatible with the legacy provider_api_keys row,
 * with fields mapped from provider_connections columns + config JSONB.
 */
export const getAiProviderKeyById = async (
  id: string,
  scopeFilter?: ScopeFilter,
): Promise<ProviderConnection | null> => {
  const conditions: SQL[] = [
    eq(providerConnections.id, id),
    eq(providerConnections.isActive, true),
    isNull(providerConnections.suspendedAt),
  ];

  if (scopeFilter) {
    conditions.push(eq(providerConnections.scope, scopeFilter.scope));
    conditions.push(eq(providerConnections.scopeId, scopeFilter.scopeId));
  }

  const [row] = await db
    .select()
    .from(providerConnections)
    .where(and(...conditions))
    .limit(1);

  return row ?? null;
};

/**
 * Soft-delete an AI provider key (set isActive=false), scoped to user.
 */
export const deleteAiProviderKey = async (
  id: string,
  userId: string,
): Promise<boolean> => {
  const [updated] = await db
    .update(providerConnections)
    .set({ isActive: false, updatedAt: new Date() })
    .where(
      and(
        eq(providerConnections.id, id),
        eq(providerConnections.scopeId, userId),
      ),
    )
    .returning({ id: providerConnections.id });

  return !!updated;
};

/**
 * Touch lastUsedAt for a connection.
 */
export const updateConnectionLastUsedAt = async (
  id: string,
  scopeFilter?: ScopeFilter,
): Promise<void> => {
  const scopeConditions: SQL[] = [eq(providerConnections.id, id)];
  if (scopeFilter) {
    scopeConditions.push(eq(providerConnections.scope, scopeFilter.scope));
    scopeConditions.push(eq(providerConnections.scopeId, scopeFilter.scopeId));
  }

  await db
    .update(providerConnections)
    .set({ lastUsedAt: new Date(), updatedAt: new Date() })
    .where(and(...scopeConditions));
};

/**
 * Suspend a connection due to quota exhaustion or rate limiting.
 * Sets `suspendedAt` to now so that `findActiveConnections` filters it out.
 * The reason is stored in `lastValidationError` for observability.
 */
export const suspendConnection = async (
  id: string,
  reason: string,
  scopeFilter?: ScopeFilter,
): Promise<void> => {
  const scopeConditions: SQL[] = [eq(providerConnections.id, id)];
  if (scopeFilter) {
    scopeConditions.push(eq(providerConnections.scope, scopeFilter.scope));
    scopeConditions.push(eq(providerConnections.scopeId, scopeFilter.scopeId));
  }

  const now = new Date();
  await db
    .update(providerConnections)
    .set({
      suspendedAt: now,
      lastValidationStatus: "invalid",
      lastValidationError: reason,
      updatedAt: now,
    })
    .where(and(...scopeConditions));
};

/**
 * Update the validation status of a connection.
 *
 * - "valid": clears suspendedAt and lastValidationError.
 * - "invalid": sets suspendedAt to now and records the error message.
 */
export const updateConnectionValidation = async (
  id: string,
  status: "valid" | "invalid",
  error?: string,
  scopeFilter?: ScopeFilter,
): Promise<void> => {
  const scopeConditions: SQL[] = [eq(providerConnections.id, id)];
  if (scopeFilter) {
    scopeConditions.push(eq(providerConnections.scope, scopeFilter.scope));
    scopeConditions.push(eq(providerConnections.scopeId, scopeFilter.scopeId));
  }

  const now = new Date();

  if (status === "valid") {
    await db
      .update(providerConnections)
      .set({
        lastValidatedAt: now,
        lastValidationStatus: "valid",
        lastValidationError: null,
        suspendedAt: null,
        updatedAt: now,
      })
      .where(and(...scopeConditions));
  } else {
    await db
      .update(providerConnections)
      .set({
        lastValidatedAt: now,
        lastValidationStatus: "invalid",
        lastValidationError: error ?? null,
        suspendedAt: now,
        updatedAt: now,
      })
      .where(and(...scopeConditions));
  }
};

/**
 * Find an OAuth-authenticated AI provider key for a user+provider.
 */
export const getOAuthAiKeyByUserAndProvider = async (
  userId: string,
  provider: string,
): Promise<ProviderConnection | null> => {
  const mappedProvider = mapAiProviderToConnectionProvider(provider);

  const [row] = await db
    .select()
    .from(providerConnections)
    .where(
      and(
        eq(providerConnections.scope, "user"),
        eq(providerConnections.scopeId, userId),
        eq(providerConnections.provider, mappedProvider),
        eq(providerConnections.category, "ai"),
        eq(providerConnections.isActive, true),
        isNull(providerConnections.suspendedAt),
        sql`${providerConnections.config}->>'authMethod' = 'oauth'`,
      ),
    )
    .orderBy(desc(providerConnections.updatedAt))
    .limit(1);

  return row ?? null;
};

/**
 * Update the encrypted credentials (token refresh scenario) for an AI key.
 */
export const updateAiProviderKeyCredentials = async (
  id: string,
  data: {
    credentials: Record<string, unknown>;
    tokenExpiresAt?: Date | null;
  },
  encryptionKey: string,
): Promise<ConnectionMetadata | null> => {
  const encryptedFields = encryptCredentials(data.credentials, encryptionKey);

  const [updated] = await db
    .update(providerConnections)
    .set({
      ...encryptedFields,
      tokenExpiresAt: data.tokenExpiresAt !== undefined ? data.tokenExpiresAt : undefined,
      updatedAt: new Date(),
    })
    .where(eq(providerConnections.id, id))
    .returning(metadataColumns);

  return updated ?? null;
};

/**
 * Update encrypted credentials for any connection (token refresh scenario).
 * Unlike updateAiProviderKeyCredentials, this works for any category (code, ai, deployment).
 */
export const updateConnectionEncryptedCredentials = async (
  id: string,
  data: {
    credentials: Record<string, unknown>;
    tokenExpiresAt?: Date | null;
  },
  encryptionKey: string,
): Promise<ConnectionMetadata | null> => {
  const encryptedFields = encryptCredentials(data.credentials, encryptionKey);

  const [updated] = await db
    .update(providerConnections)
    .set({
      ...encryptedFields,
      tokenExpiresAt: data.tokenExpiresAt !== undefined ? data.tokenExpiresAt : undefined,
      updatedAt: new Date(),
    })
    .where(eq(providerConnections.id, id))
    .returning(metadataColumns);

  return updated ?? null;
};

/**
 * Find the latest active AI provider key by provider name (across all users).
 * Used by worker routes as a global fallback for legacy/system jobs without org context.
 *
 * @deprecated Use `findActiveConnections(provider, scope, scopeId)` with explicit scope instead.
 * This function queries across ALL workspaces and is a security risk for multi-tenant usage.
 * Only kept for legacy/system jobs that lack workspace context.
 */
export const getLatestActiveAiKeyByProvider = async (
  provider: string,
): Promise<ProviderConnection | null> => {
  logger.warn(
    { provider },
    "getLatestActiveAiKeyByProvider called — this function is deprecated. Use findActiveConnections with explicit scope instead.",
  );

  const mappedProvider = mapAiProviderToConnectionProvider(provider);

  const [row] = await db
    .select()
    .from(providerConnections)
    .where(
      and(
        eq(providerConnections.provider, mappedProvider),
        eq(providerConnections.category, "ai"),
        eq(providerConnections.isActive, true),
        isNull(providerConnections.suspendedAt),
      ),
    )
    .orderBy(desc(providerConnections.updatedAt))
    .limit(1);

  return row ?? null;
};

// ---------------------------------------------------------------------------
// Convenience helpers for Vercel connections (backward-compatible shims)
// ---------------------------------------------------------------------------

/**
 * Create a Vercel connection as a provider_connection.
 */
export const createVercelProviderConnection = async (
  data: {
    userId: string;
    teamId: string | null;
    teamName: string | null;
    accessToken: string;
    tokenPrefix: string;
    scope: string | null;
  },
  encryptionKey: string,
): Promise<ConnectionMetadata> => {
  const credBlob = { accessToken: data.accessToken };
  const encryptedFields = encryptCredentials(credBlob, encryptionKey);

  const config: Record<string, unknown> = {
    teamId: data.teamId,
    teamName: data.teamName,
    scope: data.scope,
  };

  const [created] = await db
    .insert(providerConnections)
    .values({
      provider: "vercel",
      category: "deployment",
      scope: "organization",
      scopeId: data.userId, // Will be updated when org-scoped Vercel is implemented
      createdByUserId: data.userId,
      name: data.teamName || "Vercel",
      accountIdentifier: data.tokenPrefix,
      isActive: true,
      ...encryptedFields,
      config,
    })
    .returning(metadataColumns);

  if (!created) throw new Error("Failed to create Vercel connection");
  return created;
};

/**
 * Get the active Vercel connection for a user.
 */
export const getVercelConnectionByUser = async (
  userId: string,
): Promise<ProviderConnection | null> => {
  const [row] = await db
    .select()
    .from(providerConnections)
    .where(
      and(
        eq(providerConnections.provider, "vercel"),
        eq(providerConnections.createdByUserId, userId),
        eq(providerConnections.isActive, true),
      ),
    )
    .orderBy(desc(providerConnections.updatedAt))
    .limit(1);

  return row ?? null;
};

/**
 * Deactivate all Vercel connections for a user.
 * Returns true if at least one was deactivated.
 */
export const deleteVercelConnectionByUser = async (
  userId: string,
): Promise<boolean> => {
  const rows = await db
    .update(providerConnections)
    .set({ isActive: false, updatedAt: new Date() })
    .where(
      and(
        eq(providerConnections.provider, "vercel"),
        eq(providerConnections.createdByUserId, userId),
        eq(providerConnections.isActive, true),
      ),
    )
    .returning({ id: providerConnections.id });

  return rows.length > 0;
};

// ---------------------------------------------------------------------------
// Workspace Settings
// ---------------------------------------------------------------------------

const DEFAULT_AI_KEY_POLICY = "user_preferred" as const;

/**
 * Get workspace settings. Returns default values if no row exists yet.
 */
export const getOrgSettings = async (
  workspaceId: string,
): Promise<WorkspaceSettings> => {
  const [row] = await db
    .select()
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, workspaceId))
    .limit(1);

  if (row) return row;

  // Return in-memory defaults without persisting
  return {
    id: "",
    workspaceId,
    aiKeyPolicy: DEFAULT_AI_KEY_POLICY,
    orchestrationStrategy: null,
    maxConcurrentJobs: 3,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
};

/**
 * Insert or update workspace settings. Uses ON CONFLICT on the
 * unique `workspaceId` column.
 */
export const upsertOrgSettings = async (
  workspaceId: string,
  data: Pick<NewWorkspaceSettings, "aiKeyPolicy"> & { orchestrationStrategy?: NewWorkspaceSettings["orchestrationStrategy"] },
): Promise<WorkspaceSettings> => {
  const now = new Date();

  const setFields: Record<string, unknown> = {
    aiKeyPolicy: data.aiKeyPolicy,
    updatedAt: now,
  };
  if (data.orchestrationStrategy !== undefined) {
    setFields.orchestrationStrategy = data.orchestrationStrategy;
  }

  const insertValues: Record<string, unknown> = {
    workspaceId,
    aiKeyPolicy: data.aiKeyPolicy,
    createdAt: now,
    updatedAt: now,
  };
  if (data.orchestrationStrategy !== undefined) {
    insertValues.orchestrationStrategy = data.orchestrationStrategy;
  }

  const [upserted] = await db
    .insert(workspaceSettings)
    .values(insertValues as NewWorkspaceSettings)
    .onConflictDoUpdate({
      target: workspaceSettings.workspaceId,
      set: setFields,
    })
    .returning();

  if (!upserted) throw new Error("Failed to upsert workspace settings");

  return upserted;
};
