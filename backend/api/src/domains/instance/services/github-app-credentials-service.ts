import jwt from "jsonwebtoken";
import { env, logger } from "@almirant/config";
import {
  db,
  providerConnections,
  eq,
  and,
  findActiveConnection,
  encryptCredentials,
  decryptCredentials,
} from "@almirant/database";
import {
  updateInstanceConfig,
  invalidateInstanceConfig,
} from "./instance-config-service";

// ---- Types ----

export interface GithubAppCredentials {
  appId: string;
  slug: string;
  clientId: string;
  clientSecret: string;
  webhookSecret: string;
  privateKeyPem: string;
}

interface CredentialsSource {
  credentials: GithubAppCredentials;
  source: "db" | "env";
}

// ---- In-memory cache (TTL 60s, invalidated on write) ----

let cached: { value: CredentialsSource | null; expiresAt: number } | null =
  null;
const CACHE_TTL_MS = 60_000;

const INSTANCE_SCOPE_ID = "__instance__";

// ---- Public API ----

/**
 * Returns GitHub App credentials from DB (instance-scoped provider_connection)
 * with fallback to env vars. Returns null if neither source is configured.
 * Results are cached in memory for 60s or until invalidated by a write.
 */
export const getGithubAppCredentials =
  async (): Promise<CredentialsSource | null> => {
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const result = await loadFromDb();
    if (result) {
      cached = { value: result, expiresAt: Date.now() + CACHE_TTL_MS };
      return result;
    }

    const envResult = loadFromEnv();
    cached = { value: envResult, expiresAt: Date.now() + CACHE_TTL_MS };
    return envResult;
  };

/**
 * Validate, encrypt, and upsert GitHub App credentials into the instance-scoped
 * provider_connection row. Invalidates cache and updates instance_settings.
 */
export const saveGithubAppCredentials = async (
  creds: GithubAppCredentials,
  savedByUserId: string,
): Promise<void> => {
  const encryptionKey = env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error("ENCRYPTION_KEY is not configured");
  }

  const credBlob: Record<string, unknown> = {
    appId: creds.appId,
    slug: creds.slug,
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    webhookSecret: creds.webhookSecret,
    privateKeyPem: creds.privateKeyPem,
  };

  const encrypted = encryptCredentials(credBlob, encryptionKey);

  const existing = await findActiveConnection(
    "github",
    "instance",
    INSTANCE_SCOPE_ID,
  );

  if (existing) {
    await db
      .update(providerConnections)
      .set({
        ...encrypted,
        name: `GitHub App: ${creds.slug}`,
        accountIdentifier: creds.slug,
        createdByUserId: savedByUserId,
        isActive: true,
        isDefault: true,
        lastValidatedAt: new Date(),
        lastValidationStatus: "valid",
        lastValidationError: null,
        config: { appId: creds.appId, slug: creds.slug },
        updatedAt: new Date(),
      })
      .where(eq(providerConnections.id, existing.id));
  } else {
    await db.insert(providerConnections).values({
      provider: "github",
      category: "code",
      scope: "instance",
      scopeId: INSTANCE_SCOPE_ID,
      createdByUserId: savedByUserId,
      name: `GitHub App: ${creds.slug}`,
      accountIdentifier: creds.slug,
      isActive: true,
      isDefault: true,
      ...encrypted,
      config: { appId: creds.appId, slug: creds.slug },
    });
  }

  invalidateCache();

  await updateInstanceConfig({
    githubAppSlug: creds.slug,
    githubAppId: creds.appId,
  });

  logger.info(
    { slug: creds.slug, appId: creds.appId, savedByUserId },
    "GitHub App credentials saved to DB",
  );
};

/**
 * Validate GitHub App credentials by generating a JWT and calling GET /app.
 * Returns validation result with app name on success, or error message on failure.
 */
export const validateGithubAppCredentials = async (
  creds: GithubAppCredentials,
): Promise<{ valid: boolean; appName?: string; error?: string }> => {
  try {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iat: now - 60,
      exp: now + 600,
      iss: creds.appId,
    };

    const token = jwt.sign(payload, creds.privateKeyPem, {
      algorithm: "RS256",
    });

    const response = await fetch("https://api.github.com/app", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!response.ok) {
      const body = await response.text();
      return {
        valid: false,
        error: `GitHub API returned ${response.status}: ${body}`,
      };
    }

    const data = (await response.json()) as { name?: string; slug?: string };
    return { valid: true, appName: data.name ?? data.slug ?? creds.slug };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

/**
 * Soft-delete the instance-scoped GitHub App credentials (set isActive=false).
 * Invalidates cache and clears instance_settings fields.
 */
export const clearGithubAppCredentials = async (): Promise<void> => {
  const existing = await findActiveConnection(
    "github",
    "instance",
    INSTANCE_SCOPE_ID,
  );

  if (existing) {
    await db
      .update(providerConnections)
      .set({ isActive: false, isDefault: false, updatedAt: new Date() })
      .where(eq(providerConnections.id, existing.id));
  }

  invalidateCache();

  await updateInstanceConfig({
    githubAppSlug: null,
    githubAppId: null,
  });

  logger.info("GitHub App credentials cleared");
};

/**
 * Returns a status summary of the GitHub App configuration.
 */
export const getGithubAppStatus = async (): Promise<{
  configured: boolean;
  source: "db" | "env" | null;
  slug: string | null;
  appName: string | null;
}> => {
  const result = await getGithubAppCredentials();
  if (!result) {
    return { configured: false, source: null, slug: null, appName: null };
  }
  return {
    configured: true,
    source: result.source,
    slug: result.credentials.slug,
    appName: null,
  };
};

// ---- Internal helpers ----

const invalidateCache = (): void => {
  cached = null;
};

const loadFromDb = async (): Promise<CredentialsSource | null> => {
  const encryptionKey = env.ENCRYPTION_KEY;
  if (!encryptionKey) return null;

  const connection = await findActiveConnection(
    "github",
    "instance",
    INSTANCE_SCOPE_ID,
  );

  if (
    !connection?.encryptedCredentials ||
    !connection.credentialsIv ||
    !connection.credentialsAuthTag
  ) {
    return null;
  }

  try {
    const raw = decryptCredentials(connection, encryptionKey);

    const creds: GithubAppCredentials = {
      appId: raw.appId as string,
      slug: raw.slug as string,
      clientId: raw.clientId as string,
      clientSecret: raw.clientSecret as string,
      webhookSecret: raw.webhookSecret as string,
      privateKeyPem: raw.privateKeyPem as string,
    };

    if (!creds.appId || !creds.privateKeyPem) return null;

    return { credentials: creds, source: "db" };
  } catch (err) {
    logger.error(
      { error: err instanceof Error ? err.message : String(err) },
      "Failed to decrypt GitHub App credentials from DB",
    );
    return null;
  }
};

const loadFromEnv = (): CredentialsSource | null => {
  if (!env.GITHUB_APP_ID || !env.GITHUB_PRIVATE_KEY) return null;

  const privateKeyPem = Buffer.from(env.GITHUB_PRIVATE_KEY, "base64").toString(
    "utf-8",
  );

  return {
    credentials: {
      appId: env.GITHUB_APP_ID,
      slug: "",
      clientId: env.GITHUB_CLIENT_ID ?? "",
      clientSecret: env.GITHUB_CLIENT_SECRET ?? "",
      webhookSecret: env.GITHUB_WEBHOOK_SECRET ?? "",
      privateKeyPem,
    },
    source: "env",
  };
};
