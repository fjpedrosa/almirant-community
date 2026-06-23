/**
 * App bootstrap — registers extension point implementations and warms runtime
 * caches that depend on the database.
 *
 * Import this module once at the top of index.ts (before any route modules).
 *
 * CE (self-hosted) uses the defaults registered here.
 * EE overrides by calling set*() with enterprise implementations before
 * calling this function.
 */

import {
  setPermissionChecker,
  setActivityLogger,
  setRunnerOrchestrator,
  setAuthProviders,
  setFeedbackProcessor,
} from "@almirant/shared";
import { setAlmirantProjectId, logger } from "@almirant/config";
import { getInstanceSettings } from "@almirant/database";
import { defaultPermissionChecker } from "./infrastructure/extensions/default-permission-checker";
import { defaultActivityLogger } from "./infrastructure/extensions/default-activity-logger";
import { scalerMetricsRunnerOrchestrator } from "./infrastructure/extensions/scaler-metrics-runner-orchestrator";
import { defaultAuthProviderRegistry } from "./infrastructure/extensions/default-auth-provider-registry";
import { defaultFeedbackProcessor } from "./infrastructure/extensions/default-feedback-processor";

export function bootstrapExtensions(): void {
  setPermissionChecker(defaultPermissionChecker);
  setActivityLogger(defaultActivityLogger);
  setRunnerOrchestrator(scalerMetricsRunnerOrchestrator);
  setAuthProviders(defaultAuthProviderRegistry);
  setFeedbackProcessor(defaultFeedbackProcessor);
}

/**
 * Loads runtime-resolved settings from the database. Must run after DB
 * connectivity is established but before any request handler depends on the
 * values being cached.
 */
export async function bootstrapRuntimeSettings(): Promise<void> {
  try {
    const row = await getInstanceSettings();
    if (row.internalFeedbackProjectId) {
      setAlmirantProjectId(row.internalFeedbackProjectId);
    }
  } catch (err) {
    logger.warn(
      { err },
      "[bootstrap] Failed to load instance_settings; feedback project id will fall back to env.",
    );
  }
}
