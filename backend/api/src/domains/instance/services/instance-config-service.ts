import {
  getInstanceSettings,
  updateInstanceSettings,
  markOnboardingCompleted,
  addSkippedOnboardingStep,
  type InstanceSettings,
  type OnboardingStepKey,
  type UpdateInstanceSettingsData,
} from "@almirant/database";

/**
 * In-memory cached accessor for the single `instance_settings` row.
 *
 * The row is read once and cached for the lifetime of the process until an
 * explicit `invalidateInstanceConfig()` is called. All mutating helpers in
 * this module invalidate the cache after a successful write so callers never
 * observe stale data.
 *
 * Callers MUST go through this service — never call the repository directly
 * from routes/middleware — so that the cache is authoritative.
 */

let cache: InstanceSettings | null = null;
let inflight: Promise<InstanceSettings> | null = null;

const load = async (): Promise<InstanceSettings> => {
  if (cache) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    const row = await getInstanceSettings();
    cache = row;
    return row;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
};

export const getInstanceConfig = (): Promise<InstanceSettings> => load();

export const invalidateInstanceConfig = (): void => {
  cache = null;
};

export const updateInstanceConfig = async (
  data: UpdateInstanceSettingsData,
): Promise<InstanceSettings> => {
  const row = await updateInstanceSettings(data);
  cache = row;
  return row;
};

export const completeOnboarding = async (
  force = false,
): Promise<InstanceSettings> => {
  const row = await markOnboardingCompleted(force);
  cache = row;
  return row;
};

export const skipOnboardingStep = async (
  step: OnboardingStepKey,
): Promise<InstanceSettings> => {
  const row = await addSkippedOnboardingStep(step);
  cache = row;
  return row;
};

/**
 * Subset of the instance config that is safe to expose to unauthenticated
 * clients via `/api/instance/public-config`. Used by the frontend to decide
 * the Better-Auth baseURL and the trusted origins at runtime.
 */
export interface PublicInstanceConfig {
  publicUrl: string | null;
  githubAppSlug: string | null;
  onboardingCompleted: boolean;
}

export const getPublicInstanceConfig = async (): Promise<PublicInstanceConfig> => {
  const row = await load();
  return {
    publicUrl: row.publicUrl,
    githubAppSlug: row.githubAppSlug,
    onboardingCompleted: row.onboardingCompletedAt !== null,
  };
};
