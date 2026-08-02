import { env, logger } from "@almirant/config";
import {
  failQueuedReceiptResidueCandidate,
  findQueuedReceiptResidueCandidates,
  type QueuedReceiptResidueCandidate,
} from "@almirant/database";

const MINIMUM_INTERVAL_MS = 10_000;
const MINIMUM_AGE_MS = 60_000;
const MAXIMUM_BATCH_SIZE = 100;
const STARTUP_DELAY_MS = 5_000;

export interface QueuedReceiptResidueSweepResult {
  selected: number;
  terminalized: number;
  raced: number;
  errors: number;
  terminalizedJobIds: string[];
}

export interface QueuedReceiptResidueSweepOptions {
  enabled?: boolean;
  durableSequenceReceiptsEnabled?: boolean;
  minimumAgeMs: number;
  batchSize: number;
  now?: () => Date;
}

export interface QueuedReceiptResidueSweepDependencies {
  findCandidates: typeof findQueuedReceiptResidueCandidates;
  failCandidate: typeof failQueuedReceiptResidueCandidate;
}

const defaultSweepDependencies: QueuedReceiptResidueSweepDependencies = {
  findCandidates: findQueuedReceiptResidueCandidates,
  failCandidate: failQueuedReceiptResidueCandidate,
};

export const runQueuedReceiptResidueSweepOnce = async (
  options: QueuedReceiptResidueSweepOptions,
  dependencies: QueuedReceiptResidueSweepDependencies =
    defaultSweepDependencies,
): Promise<QueuedReceiptResidueSweepResult> => {
  const enabled =
    options.enabled ??
    (env.QUEUED_RECEIPT_RESIDUE_RECONCILER_ENABLED === "true");
  const durableSequenceReceiptsEnabled =
    options.durableSequenceReceiptsEnabled ??
    (env.DURABLE_SEQUENCE_RECEIPTS_ENABLED === "true");
  if (!enabled || durableSequenceReceiptsEnabled) {
    return {
      selected: 0,
      terminalized: 0,
      raced: 0,
      errors: 0,
      terminalizedJobIds: [],
    };
  }

  const failedAt = options.now?.() ?? new Date();
  const minimumAgeMs = Math.max(
    Math.trunc(options.minimumAgeMs),
    MINIMUM_AGE_MS,
  );
  const updatedBefore = new Date(failedAt.getTime() - minimumAgeMs);
  const batchSize = Math.min(
    Math.max(Math.trunc(options.batchSize), 1),
    MAXIMUM_BATCH_SIZE,
  );
  const candidates = await dependencies.findCandidates({
    updatedBefore,
    limit: batchSize,
  });

  const terminalizedJobIds: string[] = [];
  let raced = 0;
  let errors = 0;

  for (const candidate of candidates) {
    try {
      const terminalized = await dependencies.failCandidate(candidate, {
        updatedBefore,
        failedAt,
      });
      if (terminalized) {
        terminalizedJobIds.push(candidate.jobId);
      } else {
        raced += 1;
      }
    } catch {
      // A single database error must not make the remaining bounded batch
      // invisible. The runtime emits only counters/IDs, never row payloads.
      errors += 1;
    }
  }

  return {
    selected: candidates.length,
    terminalized: terminalizedJobIds.length,
    raced,
    errors,
    terminalizedJobIds,
  };
};

type ScheduledHandle = unknown;

export interface QueuedReceiptResidueStartOptions {
  enabled: boolean;
  durableSequenceReceiptsEnabled: boolean;
  intervalMs: number;
  minimumAgeMs: number;
  batchSize: number;
}

export interface QueuedReceiptResidueStartDependencies {
  runSweep: (
    options: QueuedReceiptResidueSweepOptions,
  ) => Promise<QueuedReceiptResidueSweepResult | undefined>;
  scheduleTimeout: (
    callback: () => void,
    delayMs: number,
  ) => ScheduledHandle;
  clearScheduledTimeout: (handle: ScheduledHandle) => void;
  scheduleInterval: (
    callback: () => void,
    intervalMs: number,
  ) => ScheduledHandle;
  clearScheduledInterval: (handle: ScheduledHandle) => void;
}

const defaultStartDependencies: QueuedReceiptResidueStartDependencies = {
  runSweep: runQueuedReceiptResidueSweepOnce,
  scheduleTimeout: (callback, delayMs) =>
    setTimeout(callback, delayMs) as unknown as ScheduledHandle,
  clearScheduledTimeout: (handle) =>
    clearTimeout(handle as unknown as ReturnType<typeof setTimeout>),
  scheduleInterval: (callback, intervalMs) =>
    setInterval(callback, intervalMs) as unknown as ScheduledHandle,
  clearScheduledInterval: (handle) =>
    clearInterval(handle as unknown as ReturnType<typeof setInterval>),
};

const defaultStartOptions = (): QueuedReceiptResidueStartOptions => ({
  enabled: env.QUEUED_RECEIPT_RESIDUE_RECONCILER_ENABLED === "true",
  durableSequenceReceiptsEnabled:
    env.DURABLE_SEQUENCE_RECEIPTS_ENABLED === "true",
  intervalMs: env.QUEUED_RECEIPT_RESIDUE_RECONCILER_INTERVAL_MS,
  minimumAgeMs: env.QUEUED_RECEIPT_RESIDUE_RECONCILER_MIN_AGE_MS,
  batchSize: env.QUEUED_RECEIPT_RESIDUE_RECONCILER_BATCH_SIZE,
});

/**
 * Starts only in the legacy gate-off phase. The independent enabled switch is
 * an operational rollback control; it can stop reconciliation without
 * unsafely enabling durable receipts for the fleet.
 */
export const startQueuedReceiptResidueReconciler = (
  options: QueuedReceiptResidueStartOptions = defaultStartOptions(),
  dependencies: QueuedReceiptResidueStartDependencies =
    defaultStartDependencies,
): (() => void) => {
  if (!options.enabled || options.durableSequenceReceiptsEnabled) {
    return () => undefined;
  }

  const intervalMs = Math.max(
    Math.trunc(options.intervalMs),
    MINIMUM_INTERVAL_MS,
  );
  const sweepOptions: QueuedReceiptResidueSweepOptions = {
    minimumAgeMs: Math.max(
      Math.trunc(options.minimumAgeMs),
      MINIMUM_AGE_MS,
    ),
    batchSize: Math.min(
      Math.max(Math.trunc(options.batchSize), 1),
      MAXIMUM_BATCH_SIZE,
    ),
  };
  let stopped = false;
  let running = false;

  const tick = async (): Promise<void> => {
    if (stopped || running) return;
    running = true;
    try {
      const result = await dependencies.runSweep(sweepOptions);
      if (result && result.selected > 0) {
        logger.warn(
          {
            selected: result.selected,
            terminalized: result.terminalized,
            raced: result.raced,
            errors: result.errors,
            jobIds: result.terminalizedJobIds,
          },
          "Reconciled queued durable-sequence receipt residue",
        );
      }
    } catch {
      logger.error(
        "Queued durable-sequence receipt-residue reconciliation failed; will retry",
      );
    } finally {
      running = false;
    }
  };

  const startup = dependencies.scheduleTimeout(
    () => void tick(),
    STARTUP_DELAY_MS,
  );
  const interval = dependencies.scheduleInterval(
    () => void tick(),
    intervalMs,
  );

  return () => {
    stopped = true;
    dependencies.clearScheduledTimeout(startup);
    dependencies.clearScheduledInterval(interval);
  };
};

export type { QueuedReceiptResidueCandidate };
