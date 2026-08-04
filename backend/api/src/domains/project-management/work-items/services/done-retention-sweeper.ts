import {
  DONE_RETENTION_BATCH_SIZE,
  DONE_RETENTION_HOURS,
  archiveDoneWorkItems,
  type ArchivedDoneWorkItem,
} from "@almirant/database";
import { logger } from "@almirant/config";
import { wsConnectionManager } from "../../../../shared/ws/ws-connection-manager";

export const groupArchivedItemsByWorkspace = (
  items: ArchivedDoneWorkItem[],
): Map<string, ArchivedDoneWorkItem[]> => {
  const grouped = new Map<string, ArchivedDoneWorkItem[]>();
  for (const item of items) {
    const workspaceItems = grouped.get(item.workspaceId);
    if (workspaceItems) workspaceItems.push(item);
    else grouped.set(item.workspaceId, [item]);
  }
  return grouped;
};

type DoneRetentionSweeperConfig = {
  intervalMs?: number;
  retentionHours?: number;
  batchSize?: number;
};

export const runDoneRetentionSweeperOnce = async (
  config?: DoneRetentionSweeperConfig,
): Promise<number> => {
  const archived = await archiveDoneWorkItems({
    retentionHours: config?.retentionHours ?? DONE_RETENTION_HOURS,
    batchSize: config?.batchSize ?? DONE_RETENTION_BATCH_SIZE,
  });

  const byWorkspace = groupArchivedItemsByWorkspace(archived);
  for (const [workspaceId, items] of byWorkspace) {
    wsConnectionManager.broadcastToWorkspace(workspaceId, {
      type: "work-items:invalidated",
      payload: {
        workItemIds: items.map((item) => item.id),
        boardIds: [...new Set(items.map((item) => item.boardId))],
      },
    });
  }

  if (archived.length > 0) {
    logger.info(
      { archivedCount: archived.length },
      "[done-retention-sweeper] Archived completed work items",
    );
  }
  return archived.length;
};

export const startDoneRetentionSweeper = (
  config?: DoneRetentionSweeperConfig,
): (() => void) => {
  const intervalMs = config?.intervalMs ?? 15 * 60 * 1000;
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await runDoneRetentionSweeperOnce(config);
    } catch (error) {
      logger.error(
        { error },
        "[done-retention-sweeper] Tick failed (will retry next interval)",
      );
    } finally {
      running = false;
    }
  };

  setTimeout(() => void tick(), 10_000);
  timer = setInterval(() => void tick(), intervalMs);
  logger.info({ intervalMs }, "[done-retention-sweeper] Background sweeper started");

  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
    logger.info("[done-retention-sweeper] Background sweeper stopped");
  };
};
