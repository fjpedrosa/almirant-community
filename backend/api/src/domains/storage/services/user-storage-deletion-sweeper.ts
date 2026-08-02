import { logger } from "@almirant/config";
import { userStorageService } from "./user-storage-runtime";

type UserStorageDeletionDrainer = Pick<
  typeof userStorageService,
  "drainDeletionQueue"
>;

export const runUserStorageDeletionSweepOnce = (
  service: UserStorageDeletionDrainer = userStorageService,
  limit = 100,
) => service.drainDeletionQueue(limit);

export const startUserStorageDeletionSweeper = (options: {
  intervalMs?: number;
  batchSize?: number;
  service?: UserStorageDeletionDrainer;
} = {}): (() => void) => {
  const intervalMs = Math.max(options.intervalMs ?? 60_000, 10_000);
  const batchSize = Math.min(Math.max(options.batchSize ?? 100, 1), 200);
  const service = options.service ?? userStorageService;
  let stopped = false;
  let running = false;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const result = await runUserStorageDeletionSweepOnce(service, batchSize);
      if (result.completed > 0 || result.failed > 0) {
        logger.info(result, "User storage deletion sweep completed");
      }
    } catch (error) {
      logger.error({ error }, "User storage deletion sweep failed; will retry");
    } finally {
      running = false;
    }
  };

  const startupTimer = setTimeout(() => void tick(), 5_000);
  const interval = setInterval(() => void tick(), intervalMs);

  return () => {
    stopped = true;
    clearTimeout(startupTimer);
    clearInterval(interval);
  };
};
