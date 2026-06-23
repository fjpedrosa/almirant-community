/**
 * Seed script: Bug Analysis Scheduled Agent Config
 *
 * Inserts a scheduled agent config for the bug-analysis auto-fix pipeline.
 * Cron: every 10 minutes. Starts enabled so the automated flow keeps processing new bug feedback.
 *
 * Idempotent: looks up the scheduled config by its stable human-friendly
 * name ("Bug Auto-Fix Pipeline") before inserting.
 *
 * Usage:
 *   cd backend/packages/database && bun run db:seed:bug-analysis
 *
 * Requires DATABASE_URL in env (loaded via --env-file).
 */

import { db, closeConnections } from "./client";
import { scheduledAgentConfigs } from "./schema";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Seed function (exported for programmatic use)
// ---------------------------------------------------------------------------

export const seedBugAnalysisConfig = async (
  organizationId: string,
  projectId?: string,
) => {
  // Check if config already exists. The old agent-config model had a
  // `skillName` column but the redesign (jobType+skillName → prompt+trigger)
  // removed it, so we look up by the stable human-friendly `name` instead.
  const existing = await db
    .select()
    .from(scheduledAgentConfigs)
    .where(eq(scheduledAgentConfigs.name, "Bug Auto-Fix Pipeline"))
    .limit(1);

  if (existing.length > 0) {
    console.log(
      `Bug analysis scheduled config already exists (id=${existing[0]?.id}), skipping.`,
    );
    return existing[0];
  }

  const [config] = await db
    .insert(scheduledAgentConfigs)
    .values({
      organizationId,
      projectId: projectId ?? null,
      name: "Bug Auto-Fix Pipeline",
      jobType: "bug-analysis",
      provider: "claude-code",
      description:
        "Automated bug analysis and fix pipeline. Runs every 10 minutes to classify new bugs by domain and enqueue fix analysis jobs (max 3 concurrent).",
      codingAgent: "claude-code",
      aiProvider: "anthropic",
      aiModel: "claude-opus-4-6",
      scheduleType: "cron",
      scheduleConfig: { expression: "*/10 * * * *" },
      timezone: "Europe/Madrid",
      enabled: true,
      targetConfig: {},
      maxJobsPerRun: 5,
    })
    .returning();

  console.log(`Bug analysis scheduled config created: ${config.id}`);
  return config;
};

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const main = async () => {
  const organizationId = process.env.ORGANIZATION_ID;
  const projectId = process.env.PROJECT_ID;

  if (!organizationId) {
    console.error(
      "Error: ORGANIZATION_ID environment variable is required.\n" +
        "Usage: ORGANIZATION_ID=<uuid> [PROJECT_ID=<uuid>] bun run db:seed:bug-analysis",
    );
    process.exit(1);
  }

  try {
    await seedBugAnalysisConfig(organizationId, projectId);
  } catch (error) {
    console.error("Failed to seed bug analysis config:", error);
    process.exit(1);
  } finally {
    await closeConnections();
  }
};

main();
