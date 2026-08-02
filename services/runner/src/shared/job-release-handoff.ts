import type {
  PrepareSequenceHandoffResponse,
  ProducerSequenceHighWater,
} from "@almirant/remote-agent";

const DEFAULT_HANDOFF_POLL_INTERVAL_MS = 250;
const SLOW_HANDOFF_POLL_INTERVAL_MS = 2_000;
const SLOW_HANDOFF_POLL_AFTER_MS = 30_000;

/**
 * Database coverage is bounded by PROGRESS, never by wall clock.
 *
 * Job logs are durable as soon as their high-water is read, but session and
 * native events are only in Redis at that point: they reach Postgres through a
 * shared stream drained by a single sequential consumer that carries every job
 * on the node, one HTTP POST and one transaction per event. That backlog is not
 * measurable from here, so any absolute budget is a guess about someone else's
 * queue — and the previous 30s guess destroyed a finished job.
 *
 * Measured on a job with 9,643 log / 904 session / 10,396 native events sharing
 * the consumer with a sibling: catching up took 432s, and the longest interval
 * with no insert on any channel was 4.44s (p99 0.19s); the worst single-channel
 * gap was 39.16s. So two minutes of complete silence is 3x the worst
 * per-channel gap and ~27x the worst any-channel gap actually observed, while
 * the old 30s budget was shorter than a single native gap.
 */
const DEFAULT_HANDOFF_STALL_TIMEOUT_MS = 120_000;

/**
 * Absolute ceiling, only a backstop against a producer that trickles forever.
 *
 * It must stay under the control plane's finalizing watchdog, which fails a job
 * stuck in `finalizing` for 10 minutes measured from its `updated_at` — a column
 * the worker heartbeat does not refresh. The drain ahead of this loop measured
 * ~10s, so 540s here leaves roughly 45s of slack for the release itself. If that
 * arithmetic ever changes, this constant is what has to move.
 */
const DEFAULT_HANDOFF_MAX_WAIT_MS = 540_000;

const HANDOFF_CHANNELS = ["jobLogs", "sessionEvents", "nativeEvents"] as const;

const coverageSignature = (result: PrepareSequenceHandoffResponse): string =>
  HANDOFF_CHANNELS.map((channel) => result.insertedCount[channel]).join(":");

const describeCoverage = (result: PrepareSequenceHandoffResponse): string =>
  HANDOFF_CHANNELS
    .map(
      (channel) =>
        `${channel} ${result.insertedCount[channel]}/${result.expectedCount[channel]}`,
    )
    .join(", ");

/**
 * Carries the per-channel deltas so operators stop guessing which channel was
 * behind. The old failure said only "did not become ready", and 120 polls left
 * no trace anywhere.
 */
export class SequenceHandoffCoverageError extends Error {
  readonly stalled: boolean;
  readonly emittedThrough: ProducerSequenceHighWater;
  readonly insertedCount: PrepareSequenceHandoffResponse["insertedCount"];
  readonly expectedCount: PrepareSequenceHandoffResponse["expectedCount"];

  constructor(
    message: string,
    input: {
      stalled: boolean;
      emittedThrough: ProducerSequenceHighWater;
      result: PrepareSequenceHandoffResponse;
    },
  ) {
    super(message);
    this.name = "SequenceHandoffCoverageError";
    this.stalled = input.stalled;
    this.emittedThrough = input.emittedThrough;
    this.insertedCount = input.result.insertedCount;
    this.expectedCount = input.result.expectedCount;
  }
}

type DrainAndReleaseJobInput = {
  signal?: AbortSignal;
  drain: (signal?: AbortSignal) => Promise<void>;
  readHighWater: () => ProducerSequenceHighWater;
  prepareHandoff?: (
    emittedThrough: ProducerSequenceHighWater,
    signal?: AbortSignal,
  ) => Promise<PrepareSequenceHandoffResponse>;
  handoffStallTimeoutMs?: number;
  handoffMaxWaitMs?: number;
  now?: () => number;
  waitBeforeHandoffPoll?: (
    signal?: AbortSignal,
    delayMs?: number,
  ) => Promise<void>;
  release: (
    sequenceHighWater: ProducerSequenceHighWater,
    signal?: AbortSignal,
  ) => Promise<void>;
};

type JobEventProducerDrainInput = {
  signal?: AbortSignal;
  closePublisher: (signal?: AbortSignal) => Promise<void>;
  stopLogger: (signal?: AbortSignal) => Promise<void>;
};

const raceWithSignal = async <T>(
  operation: Promise<T>,
  signal?: AbortSignal,
): Promise<T> => {
  if (!signal) return operation;
  operation.catch(() => undefined);
  if (signal.aborted) {
    throw signal.reason ?? new Error("terminal handoff aborted");
  }
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(
      signal.reason ?? new Error("terminal handoff aborted"),
    );
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
};

export const raceTerminalOperation = <T>(
  operation: Promise<T>,
  signal?: AbortSignal,
): Promise<T> => raceWithSignal(operation, signal);

const assertSignalOpen = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw signal.reason ?? new Error("terminal handoff aborted");
  }
};

/**
 * Start both independent drains immediately and fail the handoff if either one
 * cannot prove that its buffered events are fenced.
 */
export const drainJobEventProducers = async ({
  signal,
  closePublisher,
  stopLogger,
}: JobEventProducerDrainInput): Promise<void> => {
  assertSignalOpen(signal);
  const results = await raceWithSignal(
    Promise.allSettled([
      closePublisher(signal),
      stopLogger(signal),
    ]),
    signal,
  );
  assertSignalOpen(signal);
  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((failure) => failure.reason),
      "failed to drain job event producers",
    );
  }
};

/**
 * Keep a same-job retry owned by the current runner until every producer has
 * drained. The fixed high-water marks are read only after drain completes and
 * are persisted by the release transition that makes the job claimable.
 */
export const drainAndReleaseJob = async ({
  signal,
  drain,
  readHighWater,
  prepareHandoff,
  handoffStallTimeoutMs = DEFAULT_HANDOFF_STALL_TIMEOUT_MS,
  handoffMaxWaitMs = DEFAULT_HANDOFF_MAX_WAIT_MS,
  now = () => Date.now(),
  waitBeforeHandoffPoll = (waitSignal, delayMs) => new Promise<void>((resolve, reject) => {
    if (waitSignal?.aborted) {
      reject(waitSignal.reason);
      return;
    }
    const timer = setTimeout(() => {
      waitSignal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs ?? DEFAULT_HANDOFF_POLL_INTERVAL_MS);
    const onAbort = () => {
      clearTimeout(timer);
      reject(waitSignal?.reason);
    };
    waitSignal?.addEventListener("abort", onAbort, { once: true });
  }),
  release,
}: DrainAndReleaseJobInput): Promise<void> => {
  assertSignalOpen(signal);
  await raceWithSignal(drain(signal), signal);
  assertSignalOpen(signal);
  const emittedThrough = readHighWater();

  if (prepareHandoff) {
    const startedAt = now();
    let lastProgressAt = startedAt;
    let lastSignature: string | undefined;
    for (;;) {
      assertSignalOpen(signal);
      const result = await raceWithSignal(
        prepareHandoff(emittedThrough, signal),
        signal,
      );
      if (result.ready) {
        if (HANDOFF_CHANNELS.some(
          (channel) => result.insertedCount[channel] !== result.expectedCount[channel],
        )) {
          throw new SequenceHandoffCoverageError(
            `sequence handoff reported ready without complete database coverage (${describeCoverage(result)})`,
            { stalled: false, emittedThrough, result },
          );
        }
        break;
      }

      // Any channel moving forward proves the shared ingest path is still
      // working on this job, so keep waiting however long that takes.
      const observedAt = now();
      const signature = coverageSignature(result);
      if (signature !== lastSignature) {
        lastSignature = signature;
        lastProgressAt = observedAt;
      }
      const stalledForMs = observedAt - lastProgressAt;
      const waitedForMs = observedAt - startedAt;
      if (stalledForMs >= handoffStallTimeoutMs) {
        throw new SequenceHandoffCoverageError(
          `sequence handoff stalled with no database coverage progress for ${stalledForMs}ms (${describeCoverage(result)})`,
          { stalled: true, emittedThrough, result },
        );
      }
      if (waitedForMs >= handoffMaxWaitMs) {
        throw new SequenceHandoffCoverageError(
          `sequence handoff did not become ready within ${handoffMaxWaitMs}ms while still progressing (${describeCoverage(result)})`,
          { stalled: false, emittedThrough, result },
        );
      }
      // Back off once the wait is clearly a backlog drain: every poll takes the
      // same row locks each durable insert needs, so polling four times a second
      // for minutes throttles the very pipeline we are waiting for.
      const delayMs = waitedForMs >= SLOW_HANDOFF_POLL_AFTER_MS
        ? SLOW_HANDOFF_POLL_INTERVAL_MS
        : DEFAULT_HANDOFF_POLL_INTERVAL_MS;
      await raceWithSignal(waitBeforeHandoffPoll(signal, delayMs), signal);
    }
  }

  assertSignalOpen(signal);
  await raceWithSignal(release(emittedThrough, signal), signal);
  assertSignalOpen(signal);
};
