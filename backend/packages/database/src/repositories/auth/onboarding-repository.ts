import { db } from "../../client";
import {
  onboardingStatus,
  onboardingEvents,
  providerConnections,
  projects,
} from "../../schema";
import { and, eq, or } from "drizzle-orm";

export type OnboardingStepDbKey =
  | "github"
  | "vercel"
  | "aiProvider"
  | "firstProject";

const stepToColumnKey = (
  step: OnboardingStepDbKey
): "githubCompletedAt" | "vercelCompletedAt" | "aiProviderCompletedAt" | "firstProjectCompletedAt" => {
  switch (step) {
    case "github":
      return "githubCompletedAt";
    case "vercel":
      return "vercelCompletedAt";
    case "aiProvider":
      return "aiProviderCompletedAt";
    case "firstProject":
      return "firstProjectCompletedAt";
  }
};

export const getOnboardingStatusByUserId = async (userId: string) => {
  const [row] = await db
    .select()
    .from(onboardingStatus)
    .where(eq(onboardingStatus.userId, userId))
    .limit(1);

  return row ?? null;
};

// Create the row if missing (1 row per user via UNIQUE(user_id)).
// Uses INSERT ... ON CONFLICT DO NOTHING as requested.
export const getOrCreateOnboardingStatus = async (userId: string) => {
  const now = new Date();

  const [created] = await db
    .insert(onboardingStatus)
    .values({
      userId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: onboardingStatus.userId,
    })
    .returning();

  if (created) return created;

  const existing = await getOnboardingStatusByUserId(userId);
  if (!existing) throw new Error("Failed to get or create onboarding status");

  return existing;
};

export const updateOnboardingStep = async (args: {
  userId: string;
  step: OnboardingStepDbKey;
  completedAt?: Date;
}) => {
  const now = new Date();
  const completedAt = args.completedAt ?? now;

  const columnKey = stepToColumnKey(args.step);
  const [updated] = await db
    .update(onboardingStatus)
    .set({
      [columnKey]: completedAt,
      updatedAt: now,
    })
    .where(eq(onboardingStatus.userId, args.userId))
    .returning();

  return updated ?? null;
};

export const clearOnboardingStep = async (args: {
  userId: string;
  step: OnboardingStepDbKey;
}) => {
  const now = new Date();
  const columnKey = stepToColumnKey(args.step);

  const [updated] = await db
    .update(onboardingStatus)
    .set({
      [columnKey]: null,
      updatedAt: now,
    })
    .where(eq(onboardingStatus.userId, args.userId))
    .returning();

  return updated ?? null;
};

export const dismissOnboardingBanner = async (userId: string) => {
  const now = new Date();
  const [updated] = await db
    .update(onboardingStatus)
    .set({
      bannerDismissedAt: now,
      updatedAt: now,
    })
    .where(eq(onboardingStatus.userId, userId))
    .returning();

  return updated ?? null;
};

export const resetBannerDismissal = async (userId: string) => {
  const now = new Date();
  const [updated] = await db
    .update(onboardingStatus)
    .set({
      bannerDismissedAt: null,
      updatedAt: now,
    })
    .where(eq(onboardingStatus.userId, userId))
    .returning();

  return updated ?? null;
};

// Used by GET /onboarding/status to keep the table in sync with the user's real state.
export const getOnboardingStatusWithAutoSync = async (userId: string) => {
  const status = await getOrCreateOnboardingStatus(userId);

  // Short-circuit: if the user has skipped onboarding globally, no need to auto-sync
  if (status.skippedAt) return status;

  // Scope connection checks to the current user: either they created it
  // (user-scoped, e.g. GitHub OAuth) or it's an org-scoped connection
  // (e.g. GitHub App installation) visible to all members.
  const userOrOrgScope = or(
    eq(providerConnections.createdByUserId, userId),
    eq(providerConnections.scope, "organization")
  );

  const [githubRow] = await db
    .select({ id: providerConnections.id })
    .from(providerConnections)
    .where(
      and(
        eq(providerConnections.provider, "github"),
        eq(providerConnections.isActive, true),
        userOrOrgScope
      )
    )
    .limit(1);

  const [vercelRow] = await db
    .select({ id: providerConnections.id })
    .from(providerConnections)
    .where(
      and(
        eq(providerConnections.provider, "vercel"),
        eq(providerConnections.isActive, true),
        userOrOrgScope
      )
    )
    .limit(1);

  const [providerKeyRow] = await db
    .select({ id: providerConnections.id })
    .from(providerConnections)
    .where(
      and(
        eq(providerConnections.category, "ai"),
        eq(providerConnections.isActive, true),
        userOrOrgScope
      )
    )
    .limit(1);

  const [projectRow] = await db
    .select({ id: projects.id })
    .from(projects)
    .limit(1);

  const hasGithub = !!githubRow;
  const hasVercel = !!vercelRow;
  const hasProviderKey = !!providerKeyRow;
  const hasProject = !!projectRow;

  const now = new Date();
  const updates: Partial<typeof onboardingStatus.$inferInsert> = {};

  if (hasGithub && !status.githubCompletedAt) updates.githubCompletedAt = now;
  if (!hasGithub && status.githubCompletedAt) updates.githubCompletedAt = null;

  if (hasVercel && !status.vercelCompletedAt) updates.vercelCompletedAt = now;
  if (!hasVercel && status.vercelCompletedAt) updates.vercelCompletedAt = null;

  if (hasProviderKey && !status.aiProviderCompletedAt)
    updates.aiProviderCompletedAt = now;
  if (!hasProviderKey && status.aiProviderCompletedAt)
    updates.aiProviderCompletedAt = null;

  if (hasProject && !status.firstProjectCompletedAt)
    updates.firstProjectCompletedAt = now;
  if (!hasProject && status.firstProjectCompletedAt)
    updates.firstProjectCompletedAt = null;

  const needsUpdate = Object.keys(updates).length > 0;
  if (!needsUpdate) return status;

  const [updated] = await db
    .update(onboardingStatus)
    .set({ ...updates, updatedAt: now })
    .where(eq(onboardingStatus.userId, userId))
    .returning();

  return updated ?? status;
};

export const skipOnboarding = async (userId: string) => {
  const now = new Date();
  const [updated] = await db
    .update(onboardingStatus)
    .set({
      skippedAt: now,
      updatedAt: now,
    })
    .where(eq(onboardingStatus.userId, userId))
    .returning();

  return updated ?? null;
};

export const skipOnboardingStep = async (
  userId: string,
  step: string,
  reason?: string
) => {
  const now = new Date();

  // Get current skippedSteps to merge
  const current = await getOnboardingStatusByUserId(userId);
  const existing = (current?.skippedSteps ?? {}) as Record<string, string>;
  const merged = { ...existing, [step]: reason ?? now.toISOString() };

  const [updated] = await db
    .update(onboardingStatus)
    .set({
      skippedSteps: merged,
      updatedAt: now,
    })
    .where(eq(onboardingStatus.userId, userId))
    .returning();

  return updated ?? null;
};

export const logOnboardingEvent = async (
  userId: string,
  step: string,
  action: string,
  metadata?: Record<string, unknown>
) => {
  const [event] = await db
    .insert(onboardingEvents)
    .values({
      userId,
      step,
      action,
      metadata: metadata ?? null,
    })
    .returning();

  return event;
};
