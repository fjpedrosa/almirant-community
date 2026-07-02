import { db } from "../../client";
import { effortEstimatorConfigs } from "../../schema/effort-estimator-configs";
import type { EffortEstimatorConfig } from "../../schema/effort-estimator-configs";
import { eq, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EffortEstimatorConfigPatch = Partial<{
  provider: "openai" | "anthropic" | "google" | "zai" | "xai";
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
}>;

// ---------------------------------------------------------------------------
// getActiveConfig — singleton active row (isActive=true)
// ---------------------------------------------------------------------------

/**
 * Returns the currently active effort-estimator config row (the singleton
 * row where `is_active = true`). Returns null if no active row exists.
 */
export const getActiveConfig = async (): Promise<
  EffortEstimatorConfig | null
> => {
  const [row] = await db
    .select()
    .from(effortEstimatorConfigs)
    .where(eq(effortEstimatorConfigs.isActive, true))
    .limit(1);

  return row ?? null;
};

// ---------------------------------------------------------------------------
// updateActiveConfig — in-place update of the active row
// ---------------------------------------------------------------------------

/**
 * Updates the active config row in-place. Touches `updatedAt` and sets
 * `updatedByUserId`. Returns the updated row, or null if no active row exists.
 *
 * `temperature` is stored as a numeric(3,2) column — Drizzle serializes
 * numbers to strings automatically, but we coerce explicitly for safety.
 */
export const updateActiveConfig = async (
  patch: EffortEstimatorConfigPatch,
  userId: string,
): Promise<EffortEstimatorConfig | null> => {
  const active = await getActiveConfig();
  if (!active) return null;

  const updateData: Record<string, unknown> = {
    updatedByUserId: userId,
    updatedAt: sql`now()`,
  };

  if (patch.provider !== undefined) updateData.provider = patch.provider;
  if (patch.model !== undefined) updateData.model = patch.model;
  if (patch.temperature !== undefined) {
    // numeric(3,2) expects a string representation
    updateData.temperature = patch.temperature.toString();
  }
  if (patch.maxTokens !== undefined) updateData.maxTokens = patch.maxTokens;
  if (patch.systemPrompt !== undefined) {
    updateData.systemPrompt = patch.systemPrompt;
  }

  const [updated] = await db
    .update(effortEstimatorConfigs)
    .set(updateData)
    .where(eq(effortEstimatorConfigs.id, active.id))
    .returning();

  return updated ?? null;
};
