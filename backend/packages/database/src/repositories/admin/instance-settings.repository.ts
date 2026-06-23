import { db } from "../../client";
import { instanceSettings } from "../../schema/instance-settings";
import type {
  InstanceSettings,
  OnboardingStepKey,
} from "../../schema/instance-settings";
import { eq, sql } from "drizzle-orm";

export interface UpdateInstanceSettingsData {
  publicUrl?: string | null;
  tailscaleUrl?: string | null;
  tailscaleHostname?: string | null;
  githubAppSlug?: string | null;
  githubAppId?: string | null;
  onboardingCompletedAt?: Date | null;
  onboardingSkippedSteps?: OnboardingStepKey[];
}

/**
 * Returns the single instance_settings row, creating it with defaults if it
 * does not yet exist. The table is enforced as single-row via the unique
 * index on `singleton`.
 */
export const getInstanceSettings = async (): Promise<InstanceSettings> => {
  const [existing] = await db.select().from(instanceSettings).limit(1);
  if (existing) {
    return existing;
  }

  const [inserted] = await db
    .insert(instanceSettings)
    .values({})
    .onConflictDoNothing({ target: instanceSettings.singleton })
    .returning();

  if (inserted) {
    return inserted;
  }

  // Row was created by a concurrent caller — read it back.
  const [row] = await db.select().from(instanceSettings).limit(1);
  if (!row) {
    throw new Error("Failed to initialize instance_settings row");
  }
  return row;
};

/**
 * Partially update the single instance_settings row. Creates it first if
 * missing so callers never have to pre-seed the table.
 */
export const updateInstanceSettings = async (
  data: UpdateInstanceSettingsData,
): Promise<InstanceSettings> => {
  const current = await getInstanceSettings();

  const [updated] = await db
    .update(instanceSettings)
    .set({
      ...data,
      updatedAt: sql`now()`,
    })
    .where(eq(instanceSettings.id, current.id))
    .returning();

  if (!updated) {
    throw new Error("Failed to update instance_settings row");
  }

  return updated;
};

/**
 * Marks onboarding as completed. Idempotent — subsequent calls only refresh
 * the timestamp when `force` is set.
 */
export const markOnboardingCompleted = async (
  force = false,
): Promise<InstanceSettings> => {
  const current = await getInstanceSettings();

  if (current.onboardingCompletedAt && !force) {
    return current;
  }

  return updateInstanceSettings({ onboardingCompletedAt: new Date() });
};

/**
 * Records a skipped onboarding step (idempotent; de-duplicates).
 */
export const addSkippedOnboardingStep = async (
  step: OnboardingStepKey,
): Promise<InstanceSettings> => {
  const current = await getInstanceSettings();
  if (current.onboardingSkippedSteps.includes(step)) {
    return current;
  }

  return updateInstanceSettings({
    onboardingSkippedSteps: [...current.onboardingSkippedSteps, step],
  });
};
