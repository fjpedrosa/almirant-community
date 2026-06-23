import { env } from "./env";

let runtimeProjectId: string | null = null;

/**
 * Injects the internal feedback project UUID at runtime. Called by the backend
 * at boot after reading `instance_settings.internal_feedback_project_id`. This
 * lets self-hosted instances auto-provision the project without requiring the
 * operator to set `ALMIRANT_PROJECT_ID` in env.
 */
export function setAlmirantProjectId(projectId: string | null): void {
  runtimeProjectId = projectId;
}

/**
 * Returns the Almirant internal feedback project UUID.
 *
 * Resolution order:
 *   1. `env.ALMIRANT_PROJECT_ID` (operator override)
 *   2. Runtime cache populated from `instance_settings` at boot
 *
 * Throws if neither source has a value so the missing configuration is
 * surfaced the moment any feedback code path runs.
 */
export function getAlmirantProjectId(): string {
  const envValue = env.ALMIRANT_PROJECT_ID;
  if (envValue) {
    return envValue;
  }
  if (runtimeProjectId) {
    return runtimeProjectId;
  }
  throw new Error(
    "ALMIRANT_PROJECT_ID is not configured. Either set it in backend/api/.env " +
      "or let the bootstrap provision it automatically via instance_settings.",
  );
}
