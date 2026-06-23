/**
 * Seed script: Feedback Topic Detectors scheduled agent configs
 *
 * Registers the scheduled agent configs for the feedback topic housekeeping detectors:
 * - feedback-topic-merge-detector   (every 6 hours)
 * - feedback-topic-split-detector   (every Sunday at 03:00)
 * - feedback-topic-rename-detector  (1st and 15th of each month at 03:00)
 *
 * The script is idempotent for a given organization + project scope + config name.
 * Existing configs are left untouched to avoid overwriting operator customizations.
 *
 * Usage:
 *   cd backend/packages/database && ORGANIZATION_ID=<org-id> bun run db:seed:feedback-topic-detectors
 *   cd backend/packages/database && ORGANIZATION_ID=<org-id> PROJECT_ID=<project-id> bun run db:seed:feedback-topic-detectors
 *
 * Optional env vars:
 *   ENABLED=true|false   (default: true)
 *   AI_MODEL=<model-id>  (default: claude-sonnet-4-6)
 *   TIMEZONE=<tz>        (default: Europe/Madrid)
 */

import { and, eq, isNull } from "drizzle-orm";
import { db, closeConnections } from "./client";
import { scheduledAgentConfigs } from "./schema";

type DetectorSeed = {
  name: string;
  prompt: string;
  description: string;
  cron: string;
};

const DEFAULT_AI_MODEL = "claude-sonnet-4-6";
const DEFAULT_TIMEZONE = "Europe/Madrid";

const DETECTOR_SEEDS: DetectorSeed[] = [
  {
    name: "feedback-topic-merge-detector",
    prompt:
      "Run the feedback-topic-merge-detector skill to find near-duplicate topics and propose merges.",
    description:
      "Periodic scan for similar feedback topics that should be merged. Generates proposals for admin review.",
    cron: "0 */6 * * *",
  },
  {
    name: "feedback-topic-split-detector",
    prompt:
      "Run the feedback-topic-split-detector skill to find oversized topics with clear sub-groups and propose splits.",
    description:
      "Weekly scan for large feedback topics whose clusters suggest clear sub-groups. Generates split proposals for admin review.",
    cron: "0 3 * * 0",
  },
  {
    name: "feedback-topic-rename-detector",
    prompt:
      "Run the feedback-topic-rename-detector skill to find topics whose titles no longer match their contents and propose renames.",
    description:
      "Twice-monthly scan for feedback topics whose titles no longer reflect their contents. Generates rename proposals for admin review.",
    cron: "0 3 1,15 * *",
  },
];

const parseBooleanEnv = (value: string | undefined, fallback: boolean): boolean => {
  if (value == null || value.trim() === "") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`Invalid boolean value: ${value}`);
};

export const seedFeedbackTopicDetectorConfigs = async (
  organizationId: string,
  projectId?: string,
  options?: {
    enabled?: boolean;
    aiModel?: string;
    timezone?: string;
  },
) => {
  const enabled = options?.enabled ?? true;
  const aiModel = options?.aiModel ?? DEFAULT_AI_MODEL;
  const timezone = options?.timezone ?? DEFAULT_TIMEZONE;

  const results = {
    created: [] as string[],
    skipped: [] as string[],
  };

  for (const detector of DETECTOR_SEEDS) {
    const existing = await db
      .select()
      .from(scheduledAgentConfigs)
      .where(
        projectId
          ? and(
              eq(scheduledAgentConfigs.organizationId, organizationId),
              eq(scheduledAgentConfigs.projectId, projectId),
              eq(scheduledAgentConfigs.name, detector.name),
            )
          : and(
              eq(scheduledAgentConfigs.organizationId, organizationId),
              isNull(scheduledAgentConfigs.projectId),
              eq(scheduledAgentConfigs.name, detector.name),
            ),
      )
      .limit(2);

    if (existing.length > 0) {
      const duplicateWarning = existing.length > 1 ? " [WARN: duplicate configs detected]" : "";
      console.log(
        `Skipping ${detector.name}: already exists (id=${existing[0].id}, enabled=${existing[0].enabled})${duplicateWarning}`,
      );
      results.skipped.push(detector.name);
      continue;
    }

    const [created] = await db
      .insert(scheduledAgentConfigs)
      .values({
        organizationId,
        projectId: projectId ?? null,
        name: detector.name,
        prompt: detector.prompt,
        jobType: "scheduled",
        provider: "claude-code",
        description: detector.description,
        codingAgent: "claude-code",
        aiProvider: "anthropic",
        aiModel,
        scheduleType: "cron",
        scheduleConfig: { expression: detector.cron },
        timezone,
        enabled,
        targetConfig: {},
        maxJobsPerRun: 1,
      })
      .returning({
        id: scheduledAgentConfigs.id,
        name: scheduledAgentConfigs.name,
      });

    console.log(`Created ${created.name} (${created.id}) with cron ${detector.cron}`);
    results.created.push(detector.name);
  }

  return results;
};

const main = async () => {
  const organizationId = process.env.ORGANIZATION_ID;
  const projectId = process.env.PROJECT_ID;
  const enabled = parseBooleanEnv(process.env.ENABLED, true);
  const aiModel = process.env.AI_MODEL ?? DEFAULT_AI_MODEL;
  const timezone = process.env.TIMEZONE ?? DEFAULT_TIMEZONE;

  if (!organizationId) {
    console.error(
      "Error: ORGANIZATION_ID environment variable is required.\n" +
        "Usage: ORGANIZATION_ID=<uuid> [PROJECT_ID=<uuid>] [ENABLED=true|false] [AI_MODEL=<model>] [TIMEZONE=<tz>] bun run db:seed:feedback-topic-detectors",
    );
    process.exit(1);
  }

  console.log("Seeding feedback topic detector scheduled configs...");
  console.log(
    `Scope: organizationId=${organizationId} projectId=${projectId ?? "<all-projects>"} enabled=${enabled} aiModel=${aiModel} timezone=${timezone}`,
  );

  try {
    const results = await seedFeedbackTopicDetectorConfigs(organizationId, projectId, {
      enabled,
      aiModel,
      timezone,
    });

    console.log(
      `Done. Created=${results.created.length} (${results.created.join(", ") || "none"}) | Skipped=${results.skipped.length} (${results.skipped.join(", ") || "none"})`,
    );
  } catch (error) {
    console.error("Failed to seed feedback topic detector configs:", error);
    process.exit(1);
  } finally {
    await closeConnections();
  }
};

main();
