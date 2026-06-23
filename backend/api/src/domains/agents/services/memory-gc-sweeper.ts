import {
  archiveSupersededObservations,
  archiveUnreadQuarantinedObservations,
} from "@almirant/database";
import { logger } from "@almirant/config";

type MemoryGcSweeperConfig = {
  intervalMs?: number;
  unreadQuarantineDays?: number;
  supersededDays?: number;
};

export const runMemoryGcSweeperOnce = async (
  cfg?: MemoryGcSweeperConfig
) => {
  const unreadQuarantineDays = cfg?.unreadQuarantineDays ?? 60;
  const supersededDays = cfg?.supersededDays ?? 30;

  const [archivedUnread, archivedSuperseded] = await Promise.all([
    archiveUnreadQuarantinedObservations(unreadQuarantineDays),
    archiveSupersededObservations(supersededDays),
  ]);

  logger.info(
    {
      archivedUnreadCount: archivedUnread.length,
      archivedSupersededCount: archivedSuperseded.length,
      unreadQuarantineDays,
      supersededDays,
    },
    "[memory-gc-sweeper] Sweep completed"
  );
};

export const startMemoryGcSweeper = (
  cfg?: MemoryGcSweeperConfig
): (() => void) => {
  const intervalMs = cfg?.intervalMs ?? 86_400_000;
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await runMemoryGcSweeperOnce(cfg);
    } catch (error) {
      logger.error(
        { error },
        "[memory-gc-sweeper] Tick failed (transient error, will retry next interval)"
      );
    } finally {
      running = false;
    }
  };

  setTimeout(() => void tick(), 30_000);
  timer = setInterval(() => void tick(), intervalMs);

  logger.info({ intervalMs }, "[memory-gc-sweeper] Background sweeper started");

  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
    logger.info("[memory-gc-sweeper] Background sweeper stopped");
  };
};
