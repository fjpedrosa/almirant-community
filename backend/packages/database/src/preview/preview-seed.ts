/**
 * Local/preview platform seed data.
 *
 * Creates the minimum shared data needed by local and preview environments
 * without pre-creating any human user account. In production/self-hosted mode,
 * the infrastructure service-account key is optional and only seeded when
 * ALMIRANT_API_KEY is provided.
 *
 * Idempotent: safe to run multiple times.
 */

import { createHash } from "crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../schema";

// Fixed IDs for idempotency
const LOCAL_INFRA_ORG_ID = "local-infra-org-1";
const LOCAL_INFRA_SERVICE_ACCOUNT_ID =
  "00000000-0000-4000-a000-000000000900";
const LOCAL_INFRA_API_KEY_ID = "00000000-0000-4000-a000-000000000901";

// Well-known dev runner API key: alm_sa_03a9fd877e5dde3cdc283b0a7c28b6bc19d6206303feedff2daab4f77d28962e
const DEV_RUNNER_API_KEY =
  "alm_sa_03a9fd877e5dde3cdc283b0a7c28b6bc19d6206303feedff2daab4f77d28962e";
const SERVICE_ACCOUNT_KEY_PREFIX = "alm_sa_";

type SeededInfraApiKeyConfig = {
  keyHash: string;
  keyPrefix: string;
};

const buildInfraApiKeyConfig = (
  plaintextKey: string,
): SeededInfraApiKeyConfig => {
  if (!plaintextKey.startsWith(SERVICE_ACCOUNT_KEY_PREFIX)) {
    throw new Error(
      `ALMIRANT_API_KEY must start with '${SERVICE_ACCOUNT_KEY_PREFIX}'`,
    );
  }

  const rawKey = plaintextKey.slice(SERVICE_ACCOUNT_KEY_PREFIX.length);
  if (!rawKey) {
    throw new Error("ALMIRANT_API_KEY must include key material after the prefix");
  }

  return {
    keyHash: createHash("sha256").update(rawKey).digest("hex"),
    keyPrefix: `${SERVICE_ACCOUNT_KEY_PREFIX}${rawKey.slice(0, 8)}`,
  };
};

const resolveInfraApiKeyConfig = (): SeededInfraApiKeyConfig | null => {
  const providedKey = process.env.ALMIRANT_API_KEY?.trim();

  if (providedKey) {
    return buildInfraApiKeyConfig(providedKey);
  }

  if (process.env.NODE_ENV === "production") {
    return null;
  }

  return buildInfraApiKeyConfig(DEV_RUNNER_API_KEY);
};

export async function seedPreviewData(connectionString: string) {
  const client = postgres(connectionString);
  const db = drizzle(client, { schema });

  try {
    console.log("[preview-seed] Seeding local platform defaults...");

    const infraApiKeyConfig = resolveInfraApiKeyConfig();

    // 1. Optional infrastructure organization for embedded runner/automation use
    if (infraApiKeyConfig) {
      console.log("[preview-seed] Creating local infrastructure organization...");
      await db
        .insert(schema.organization)
        .values({
          id: LOCAL_INFRA_ORG_ID,
          name: "Local Infrastructure",
          slug: "local-infra",
        })
        .onConflictDoNothing();

      console.log(
        `[preview-seed] Upserting runner service account + API key (${infraApiKeyConfig.keyPrefix})...`,
      );
      await db
        .insert(schema.serviceAccounts)
        .values({
          id: LOCAL_INFRA_SERVICE_ACCOUNT_ID,
          organizationId: LOCAL_INFRA_ORG_ID,
          name: "Dev Runner",
          type: "runner",
          isActive: true,
        })
        .onConflictDoUpdate({
          target: schema.serviceAccounts.id,
          set: {
            organizationId: LOCAL_INFRA_ORG_ID,
            name: "Dev Runner",
            type: "runner",
            isActive: true,
          },
        });

      await db
        .insert(schema.apiKeys)
        .values({
          id: LOCAL_INFRA_API_KEY_ID,
          name: "Dev Runner API Key",
          keyHash: infraApiKeyConfig.keyHash,
          keyPrefix: infraApiKeyConfig.keyPrefix,
          isActive: true,
          serviceAccountId: LOCAL_INFRA_SERVICE_ACCOUNT_ID,
          organizationId: LOCAL_INFRA_ORG_ID,
          allowedIssuedPermissions: ["mcp:read", "mcp:write"],
        })
        .onConflictDoUpdate({
          target: schema.apiKeys.id,
          set: {
            name: "Dev Runner API Key",
            keyHash: infraApiKeyConfig.keyHash,
            keyPrefix: infraApiKeyConfig.keyPrefix,
            isActive: true,
            serviceAccountId: LOCAL_INFRA_SERVICE_ACCOUNT_ID,
            organizationId: LOCAL_INFRA_ORG_ID,
            allowedIssuedPermissions: ["mcp:read", "mcp:write"],
          },
        });
    } else {
      console.log(
        "[preview-seed] Skipping infrastructure service account seed (production mode without ALMIRANT_API_KEY).",
      );
    }

    // 2. Built-in board templates
    console.log("[preview-seed] Creating board templates...");
    const boardTemplateData: Array<typeof schema.boardTemplates.$inferInsert> = [
      {
        name: "Development",
        description:
          "Software development board with full flow from backlog to production",
        area: "desarrollo" as const,
        columns: [
          { name: "Backlog", color: "#94a3b8", order: 0, isDone: false, role: "backlog" },
          { name: "In Progress", color: "#f59e0b", order: 1, isDone: false, role: "in_progress" },
          { name: "Reviewing", color: "#8b5cf6", order: 2, isDone: false, role: "review" },
          { name: "Validating", color: "#ec4899", order: 3, isDone: false, role: "validating" },
          { name: "Release", color: "#a855f7", order: 4, isDone: false, role: "release" },
          { name: "Done", color: "#22c55e", order: 5, isDone: true, role: "done" },
        ],
        isBuiltIn: true,
      },
      {
        name: "Sales",
        description:
          "Sales pipeline with stages from prospecting to close",
        area: "ventas" as const,
        columns: [
          { name: "Prospect", color: "#94a3b8", order: 0, isDone: false },
          { name: "Contacted", color: "#6366f1", order: 1, isDone: false },
          { name: "Qualified", color: "#06b6d4", order: 2, isDone: false },
          { name: "Proposal", color: "#f59e0b", order: 3, isDone: false },
          {
            name: "Negotiation",
            color: "#f97316",
            order: 4,
            isDone: false,
          },
          { name: "Won", color: "#22c55e", order: 5, isDone: true },
          { name: "Lost", color: "#ef4444", order: 6, isDone: true },
        ],
        isBuiltIn: true,
      },
      {
        name: "Simple Kanban",
        description:
          "Basic Kanban board with three columns for any type of project",
        area: "general" as const,
        columns: [
          { name: "To Do", color: "#6366f1", order: 0, isDone: false },
          { name: "Doing", color: "#f59e0b", order: 1, isDone: false },
          { name: "Done", color: "#22c55e", order: 2, isDone: true },
        ],
        isBuiltIn: true,
      },
    ];
    await db
      .insert(schema.boardTemplates)
      .values(boardTemplateData)
      .onConflictDoNothing();

    // 3. System settings
    console.log("[preview-seed] Creating system settings...");
    const existingSettings = await db
      .select()
      .from(schema.systemSettings)
      .limit(1);
    if (existingSettings.length === 0) {
      await db.insert(schema.systemSettings).values({});
    }

    // 4. Instance settings + internal feedback project (self-hosted auto-provision)
    console.log("[preview-seed] Ensuring instance_settings row + internal feedback project...");
    const [instanceRow] = await db
      .insert(schema.instanceSettings)
      .values({})
      .onConflictDoNothing({ target: schema.instanceSettings.singleton })
      .returning();

    const currentInstance =
      instanceRow ??
      (await db
        .select()
        .from(schema.instanceSettings)
        .limit(1))[0];

    if (currentInstance && !currentInstance.internalFeedbackProjectId) {
      // Prefer an existing env-pinned UUID so SaaS deploys stay consistent; if
      // absent (the self-hosted default), create a placeholder project whose
      // UUID is persisted in instance_settings for all subsequent reads.
      const envPinned = process.env.ALMIRANT_PROJECT_ID?.trim();
      let projectId: string | null = envPinned && envPinned.length > 0 ? envPinned : null;

      if (!projectId) {
        const [createdProject] = await db
          .insert(schema.projects)
          .values({
            name: "Almirant Internal",
            description:
              "Internal project used by Almirant for system-generated feedback and bug-fix attempts. Safe to rename; do not delete.",
            color: "#6366f1",
          })
          .returning({ id: schema.projects.id });
        projectId = createdProject?.id ?? null;
      }

      if (projectId) {
        await db
          .update(schema.instanceSettings)
          .set({ internalFeedbackProjectId: projectId })
          .where(eq(schema.instanceSettings.id, currentInstance.id));
      }
    }

    console.log("[preview-seed] Local platform seed completed successfully.");
    const infraSummary = infraApiKeyConfig
      ? "  - 1 infrastructure organization\n  - 1 runner service account + API key"
      : "  - infrastructure organization/API key skipped";
    console.log(`[preview-seed] Created:\n${infraSummary}\n  - 3 board templates\n  - 1 system settings row`);
  } finally {
    await client.end();
  }
}

// Allow running directly
if (import.meta.main) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error(
      "[preview-seed] ERROR: DATABASE_URL environment variable is required.",
    );
    process.exit(1);
  }
  seedPreviewData(connectionString)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[preview-seed] Seed failed:", err);
      process.exit(1);
    });
}
