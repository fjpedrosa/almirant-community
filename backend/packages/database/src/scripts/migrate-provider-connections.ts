/**
 * Migration script: Migrate legacy provider tables into unified provider_connections table.
 *
 * Migrates data from 3 source tables:
 *   1. github_installations  -> provider_connections (scope=organization, category=code)
 *   2. provider_api_keys     -> provider_connections (scope=user, category=ai)
 *   3. vercel_connections    -> provider_connections (scope=user, category=deployment)
 *
 * Handles re-encryption of credentials into a unified JSON blob format.
 * Preserves original UUIDs for FK integrity.
 * Each phase runs inside a database transaction for atomicity.
 *
 * Usage:
 *   cd backend/packages/database
 *   bun run --env-file .env.local src/scripts/migrate-provider-connections.ts
 *
 * Required env vars:
 *   DATABASE_URL    - PostgreSQL connection string
 *   ENCRYPTION_KEY  - 32-byte hex key (64 chars) for AES-256-GCM
 */

import crypto from "node:crypto";
import { db, closeConnections } from "../client";
import { providerConnections } from "../schema/provider-connections";
import { member } from "../schema/organization";
import { eq, sql } from "drizzle-orm";

// NOTE: This migration script originally imported from legacy schema files
// (github.ts/githubInstallations, provider-api-keys.ts/providerApiKeys, vercel.ts/vercelConnections).
// Those schema files have been removed as part of the unified integrations migration.
// The script now uses raw SQL to read from the legacy tables, which may still exist
// in the database even though their Drizzle schema definitions have been removed.

// ---------------------------------------------------------------------------
// Inline encrypt / decrypt (AES-256-GCM) — copied from backend/api/src/lib/encryption.ts
// ---------------------------------------------------------------------------

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

const encrypt = (
  plaintext: string,
  keyHex: string
): { encrypted: string; iv: string; authTag: string } => {
  const key = Buffer.from(keyHex, "hex");
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");

  const authTag = cipher.getAuthTag().toString("base64");

  return {
    encrypted,
    iv: iv.toString("base64"),
    authTag,
  };
};

const decrypt = (
  encrypted: string,
  iv: string,
  authTag: string,
  keyHex: string
): string => {
  const key = Buffer.from(keyHex, "hex");
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(authTag, "base64"));

  let decrypted = decipher.update(encrypted, "base64", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
};

// ---------------------------------------------------------------------------
// Helper: mask a string for safe logging (first 4 chars + "...")
// ---------------------------------------------------------------------------

const mask = (value: string): string => {
  if (value.length <= 4) return "****";
  return value.slice(0, 4) + "...";
};

// ---------------------------------------------------------------------------
// Helper: map ai_provider enum value to provider_type enum value
// ---------------------------------------------------------------------------

const mapAiProvider = (
  aiProvider: string
): "openai" | "anthropic" | "google" | "zai" | "xai" => {
  if (aiProvider === "openai-compatible") return "zai";
  if (aiProvider === "openai_compatible") return "zai";
  return aiProvider as "openai" | "anthropic" | "google" | "zai" | "xai";
};

// ---------------------------------------------------------------------------
// Main migration
// ---------------------------------------------------------------------------

const main = async () => {
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    console.error(
      "ERROR: ENCRYPTION_KEY environment variable is required.\n" +
        "Generate one with: openssl rand -hex 32"
    );
    process.exit(1);
  }

  console.log("=== Provider Connections Migration ===\n");

  // Pre-count source tables (raw SQL since schema files were removed)
  const githubRows = await db.execute(sql`SELECT count(*)::int AS count FROM github_installations`);
  const apiKeyRows = await db.execute(sql`SELECT count(*)::int AS count FROM provider_api_keys`);
  const vercelRows = await db.execute(sql`SELECT count(*)::int AS count FROM vercel_connections`);

  const githubCount = Number((githubRows as any)[0]?.count ?? 0);
  const apiKeyCount = Number((apiKeyRows as any)[0]?.count ?? 0);
  const vercelCount = Number((vercelRows as any)[0]?.count ?? 0);

  console.log("Source table counts:");
  console.log(`  github_installations : ${githubCount}`);
  console.log(`  provider_api_keys    : ${apiKeyCount}`);
  console.log(`  vercel_connections   : ${vercelCount}`);
  console.log(`  TOTAL                : ${githubCount + apiKeyCount + vercelCount}\n`);

  if (githubCount + apiKeyCount + vercelCount === 0) {
    console.log("No rows to migrate. Done.");
    await closeConnections();
    process.exit(0);
  }

  // Build org -> admin userId lookup (cached across phases)
  const orgAdminCache = new Map<string, string | null>();

  const findOrgAdmin = async (organizationId: string): Promise<string | null> => {
    if (orgAdminCache.has(organizationId)) {
      return orgAdminCache.get(organizationId)!;
    }

    // Look for owner first, then admin, then any member
    const members = await db
      .select({ userId: member.userId, role: member.role })
      .from(member)
      .where(eq(member.organizationId, organizationId))
      .orderBy(
        sql`CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END`
      )
      .limit(1);

    const userId = members.length > 0 ? members[0].userId : null;
    orgAdminCache.set(organizationId, userId);
    return userId;
  };

  let phase1Inserted = 0;
  let phase2Inserted = 0;
  let phase3Inserted = 0;

  // Track one sample from each phase for verification
  const samples: {
    github: { id: string; plainSnippet: string } | null;
    apiKey: { id: string; plainSnippet: string } | null;
    vercel: { id: string; plainSnippet: string } | null;
  } = { github: null, apiKey: null, vercel: null };

  // =========================================================================
  // Phase 1: GitHub Installations
  // =========================================================================
  console.log("--- Phase 1: GitHub Installations ---\n");

  if (githubCount > 0) {
    const allGithub = (await db.execute(sql`SELECT * FROM github_installations`)) as any[];

    await db.transaction(async (tx) => {
      for (const gh of allGithub) {
        // Build credentials JSON (if accessToken exists)
        let encryptedCredentials: string | null = null;
        let credentialsIv: string | null = null;
        let credentialsAuthTag: string | null = null;

        if (gh.access_token) {
          const credBlob = JSON.stringify({ accessToken: gh.access_token });
          const enc = encrypt(credBlob, encryptionKey);
          encryptedCredentials = enc.encrypted;
          credentialsIv = enc.iv;
          credentialsAuthTag = enc.authTag;

          // Capture sample for verification
          if (!samples.github) {
            samples.github = { id: gh.id, plainSnippet: mask(gh.access_token) };
          }
        }

        // Find org admin for createdByUserId
        const adminUserId = await findOrgAdmin(gh.organization_id);

        // Build config
        const config = {
          installationId: gh.installation_id,
          accountType: gh.account_type,
          accountAvatarUrl: gh.account_avatar_url,
          permissions: gh.permissions,
          repositorySelection: gh.repository_selection,
        };

        await tx.insert(providerConnections).values({
          id: gh.id,
          provider: "github",
          category: "code",
          scope: "organization",
          scopeId: gh.organization_id,
          createdByUserId: adminUserId,
          name: gh.account_login,
          accountIdentifier: gh.account_login,
          isActive: gh.suspended_at === null,
          suspendedAt: gh.suspended_at,
          tokenExpiresAt: gh.token_expires_at,
          encryptedCredentials,
          credentialsIv,
          credentialsAuthTag,
          config,
          createdAt: gh.created_at,
          updatedAt: gh.updated_at,
        });

        phase1Inserted++;
        console.log(
          `  [OK] ${gh.account_login} (installation ${gh.installation_id}) -> provider_connections`
        );
      }
    });
  }

  console.log(`\n  Phase 1 complete: ${phase1Inserted}/${githubCount} rows migrated.\n`);

  // =========================================================================
  // Phase 2: Provider API Keys
  // =========================================================================
  console.log("--- Phase 2: Provider API Keys ---\n");

  if (apiKeyCount > 0) {
    const allApiKeys = (await db.execute(sql`SELECT * FROM provider_api_keys`)) as any[];

    await db.transaction(async (tx) => {
      for (const key of allApiKeys) {
        // Decrypt the existing API key
        const plainApiKey = decrypt(
          key.encrypted_key,
          key.iv,
          key.auth_tag,
          encryptionKey
        );

        // Decrypt refresh token if present
        let plainRefreshToken: string | undefined;
        if (
          key.encrypted_refresh_token &&
          key.refresh_token_iv &&
          key.refresh_token_auth_tag
        ) {
          plainRefreshToken = decrypt(
            key.encrypted_refresh_token,
            key.refresh_token_iv,
            key.refresh_token_auth_tag,
            encryptionKey
          );
        }

        // Build credentials JSON blob
        const credObject: Record<string, string | null | undefined> = {
          apiKey: plainApiKey,
        };
        if (plainRefreshToken) credObject.refreshToken = plainRefreshToken;
        if (key.base_url) credObject.baseUrl = key.base_url;
        credObject.authMethod = key.auth_method;
        if (key.oauth_scopes) credObject.oauthScopes = key.oauth_scopes;

        const credBlob = JSON.stringify(credObject);
        const enc = encrypt(credBlob, encryptionKey);

        // Capture sample for verification
        if (!samples.apiKey) {
          samples.apiKey = { id: key.id, plainSnippet: mask(plainApiKey) };
        }

        // Build config
        const config: Record<string, string | null> = {
          keyPrefix: key.key_prefix,
          baseUrl: key.base_url,
          authMethod: key.auth_method,
        };
        if (key.oauth_scopes) config.oauthScopes = key.oauth_scopes;

        await tx.insert(providerConnections).values({
          id: key.id,
          provider: mapAiProvider(key.provider),
          category: "ai",
          scope: "user",
          scopeId: key.user_id,
          createdByUserId: key.user_id,
          name: key.name,
          accountIdentifier: key.key_prefix,
          isActive: key.is_active,
          lastUsedAt: key.last_used_at,
          tokenExpiresAt: key.token_expires_at,
          encryptedCredentials: enc.encrypted,
          credentialsIv: enc.iv,
          credentialsAuthTag: enc.authTag,
          config,
          createdAt: key.created_at,
          updatedAt: key.updated_at,
        });

        phase2Inserted++;
        console.log(
          `  [OK] "${key.name}" (${key.provider}, prefix=${key.key_prefix}) -> provider_connections`
        );
      }
    });
  }

  console.log(`\n  Phase 2 complete: ${phase2Inserted}/${apiKeyCount} rows migrated.\n`);

  // =========================================================================
  // Phase 3: Vercel Connections
  // =========================================================================
  console.log("--- Phase 3: Vercel Connections ---\n");

  if (vercelCount > 0) {
    const allVercel = (await db.execute(sql`SELECT * FROM vercel_connections`)) as any[];

    await db.transaction(async (tx) => {
      for (const vc of allVercel) {
        // Decrypt the existing access token
        const plainToken = decrypt(
          vc.encrypted_access_token,
          vc.iv,
          vc.auth_tag,
          encryptionKey
        );

        // Build credentials JSON blob
        const credBlob = JSON.stringify({ accessToken: plainToken });
        const enc = encrypt(credBlob, encryptionKey);

        // Capture sample for verification
        if (!samples.vercel) {
          samples.vercel = { id: vc.id, plainSnippet: mask(plainToken) };
        }

        // Build config
        const config: Record<string, string | null> = {
          teamId: vc.team_id,
          teamName: vc.team_name,
          scope: vc.scope,
        };

        await tx.insert(providerConnections).values({
          id: vc.id,
          provider: "vercel",
          category: "deployment",
          scope: "user",
          scopeId: vc.user_id,
          createdByUserId: vc.user_id,
          name: vc.team_name || "Vercel",
          accountIdentifier: vc.token_prefix,
          isActive: true,
          encryptedCredentials: enc.encrypted,
          credentialsIv: enc.iv,
          credentialsAuthTag: enc.authTag,
          config,
          createdAt: vc.created_at,
          updatedAt: vc.updated_at,
        });

        phase3Inserted++;
        console.log(
          `  [OK] "${vc.team_name || "Vercel"}" (prefix=${vc.token_prefix}) -> provider_connections`
        );
      }
    });
  }

  console.log(`\n  Phase 3 complete: ${phase3Inserted}/${vercelCount} rows migrated.\n`);

  // =========================================================================
  // Verification
  // =========================================================================
  console.log("--- Verification ---\n");

  // Count rows in provider_connections
  const [totalResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(providerConnections);

  const totalMigrated = phase1Inserted + phase2Inserted + phase3Inserted;

  console.log(`Total rows inserted into provider_connections: ${totalMigrated}`);
  console.log(`Total rows now in provider_connections table : ${totalResult.count}`);
  console.log();

  // Assert counts
  if (phase1Inserted !== githubCount) {
    console.error(
      `MISMATCH: Phase 1 expected ${githubCount} rows, inserted ${phase1Inserted}`
    );
  }
  if (phase2Inserted !== apiKeyCount) {
    console.error(
      `MISMATCH: Phase 2 expected ${apiKeyCount} rows, inserted ${phase2Inserted}`
    );
  }
  if (phase3Inserted !== vercelCount) {
    console.error(
      `MISMATCH: Phase 3 expected ${vercelCount} rows, inserted ${phase3Inserted}`
    );
  }

  if (
    phase1Inserted === githubCount &&
    phase2Inserted === apiKeyCount &&
    phase3Inserted === vercelCount
  ) {
    console.log("All row counts match. Migration data integrity verified.\n");
  }

  // Spot-check decryption on one row from each phase
  console.log("Spot-check (decrypt one credential per phase):\n");

  const spotCheck = async (
    label: string,
    sample: { id: string; plainSnippet: string } | null,
    credentialKey: string
  ) => {
    if (!sample) {
      console.log(`  ${label}: no rows to verify`);
      return;
    }

    const [row] = await db
      .select({
        encryptedCredentials: providerConnections.encryptedCredentials,
        credentialsIv: providerConnections.credentialsIv,
        credentialsAuthTag: providerConnections.credentialsAuthTag,
      })
      .from(providerConnections)
      .where(eq(providerConnections.id, sample.id))
      .limit(1);

    if (row?.encryptedCredentials && row.credentialsIv && row.credentialsAuthTag) {
      const plain = decrypt(
        row.encryptedCredentials,
        row.credentialsIv,
        row.credentialsAuthTag,
        encryptionKey
      );
      const parsed = JSON.parse(plain);
      console.log(
        `  ${label} [${sample.id}]: ${credentialKey} = ${mask(parsed[credentialKey])}`
      );
    }
  };

  await spotCheck("GitHub ", samples.github, "accessToken");
  await spotCheck("API Key", samples.apiKey, "apiKey");
  await spotCheck("Vercel ", samples.vercel, "accessToken");

  // =========================================================================
  // Summary
  // =========================================================================
  console.log("\n=== Migration Complete ===");
  console.log(`  GitHub installations -> provider_connections : ${phase1Inserted}`);
  console.log(`  Provider API keys    -> provider_connections : ${phase2Inserted}`);
  console.log(`  Vercel connections   -> provider_connections : ${phase3Inserted}`);
  console.log(`  TOTAL migrated                              : ${totalMigrated}`);

  await closeConnections();
  process.exit(0);
};

main().catch(async (err) => {
  console.error("\nMigration failed:", err);
  await closeConnections();
  process.exit(1);
});
