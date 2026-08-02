/**
 * Ported from cloud's resolve-scheduled-worker-identity.ts, RENAMED to avoid
 * a same-name collision: workers.routes.ts already has an unrelated local
 * (non-exported) `resolveScheduledWorkerIdentity` helper that resolves which
 * WORKSPACE a scheduled-worker read endpoint should query
 * (workerApiKeyWorkspaceId, scheduledConfigId) -> workspaceId | null. This
 * function does something entirely different: given a workspaceId +
 * scheduledConfigId, it resolves the config's OWNER USER ID for job
 * attribution. Porting it under the original name would compile fine (the
 * two live in different modules) but would be a serious footgun for future
 * readers. Not touched: workers.routes.ts's own two call sites of its local
 * helper (lote 16 territory) -- this file exists purely so
 * release-integration-queue-service.ts (and, later, the
 * scheduled-agent-dispatcher tick) can resolve ownership without an HTTP
 * hop, same as cloud.
 */
import { getScheduledAgentConfigById } from "@almirant/database";
import type { ScheduledAgentConfigDb } from "@almirant/database";
import { logger } from "@almirant/config";

export type ScheduledConfigOwnerIdentityResolution =
  | {
      found: true;
      ownerUserId: string | null;
      scheduledConfigName: string | null;
      config: ScheduledAgentConfigDb | null;
    }
  | {
      found: false;
      ownerUserId: null;
      scheduledConfigName: null;
      config: null;
    };

/**
 * Resolve the owner identity behind a scheduled worker request. When no
 * scheduledConfigId is provided, the caller is treated as unattended
 * (found: true, no owner). When a scheduledConfigId is provided but does
 * not resolve to a config in the workspace, resolution fails so callers can
 * translate that into a 404.
 */
export const resolveScheduledConfigOwnerIdentity = async (
  workspaceId: string,
  scheduledConfigId: string | undefined,
  claimedOwnerUserId?: string,
): Promise<ScheduledConfigOwnerIdentityResolution> => {
  if (!scheduledConfigId) {
    return {
      found: true,
      ownerUserId: null,
      scheduledConfigName: null,
      config: null,
    };
  }

  const config = await getScheduledAgentConfigById(scheduledConfigId, workspaceId);
  if (!config) {
    return {
      found: false,
      ownerUserId: null,
      scheduledConfigName: null,
      config: null,
    };
  }

  const ownerUserId = config.ownerUserId ?? null;

  if (claimedOwnerUserId && claimedOwnerUserId !== ownerUserId) {
    logger.warn(
      {
        scheduledConfigId,
        workspaceId,
        claimedOwnerUserId,
        persistedOwnerUserId: ownerUserId,
      },
      "workers/jobs: ignored scheduled-agent owner claimed by runner",
    );
  }

  return {
    found: true,
    ownerUserId,
    scheduledConfigName: config.name,
    config,
  };
};
