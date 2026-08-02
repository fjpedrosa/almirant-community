import type {
  AlmirantWorkerClient,
  JobLogEntryPayload,
  JobLogLevel,
  WorkerClientRequestOptions,
} from "@almirant/remote-agent";
import {
  createJobSecretRedactor,
  type JobSecretRedactor,
} from "../security/job-secret-redactor";

type JobEventLoggerConfig = {
  jobId: string;
  workerClient: AlmirantWorkerClient;
  debugEnabled: boolean;
  flushIntervalMs?: number;
  batchSize?: number;
  maxBuffered?: number;
  /** Durable per-job high-water mark captured by the atomic claim. */
  seqOffset?: number;
  /** Inclusive end of the exact claim's current job-log reservation. */
  sequenceEnd?: number;
  /** Extend the exact claim reservation before the producer reaches its end. */
  ensureReservation?: (
    requiredThrough: number,
    requestOptions?: WorkerClientRequestOptions,
  ) => Promise<number>;
  /** Fresh live request options for periodic work-path flushes. */
  requestOptions?: () => WorkerClientRequestOptions | undefined;
  /** Mutable exact-value redactor shared by every persistence boundary in a job. */
  redactor?: JobSecretRedactor;
};

const DEFAULT_FLUSH_INTERVAL_MS = 2_000;
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_MAX_BUFFERED = 10_000;
const STRICT_DRAIN_MAX_ATTEMPTS = 3;
const MAX_PERSISTED_SEQUENCE = 2_147_483_647;
const RESERVATION_RENEWAL_RATIO = 0.75;

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw signal.reason ?? new Error("job event persistence aborted");
  }
};

const raceWithAbort = async <T>(
  operation: Promise<T>,
  signal?: AbortSignal,
): Promise<T> => {
  if (!signal) return operation;
  operation.catch(() => undefined);
  throwIfAborted(signal);

  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      reject(signal.reason ?? new Error("job event persistence aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });

  try {
    return await Promise.race([operation, aborted]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
};

export class RunnerJobEventLogger {
  private readonly jobId: string;
  private readonly workerClient: AlmirantWorkerClient;
  private readonly debugEnabled: boolean;
  private readonly flushIntervalMs: number;
  private readonly batchSize: number;
  private readonly maxBuffered: number;
  private readonly sequenceBase: number;
  private readonly ensureReservation?: (
    requiredThrough: number,
    requestOptions?: WorkerClientRequestOptions,
  ) => Promise<number>;
  private readonly requestOptions?: () => WorkerClientRequestOptions | undefined;
  private readonly redactor: JobSecretRedactor;

  private seq: number;
  private persistedSeq: number;
  private sequenceEnd?: number;
  private queue: JobLogEntryPayload[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private flushInFlight: Promise<void> | null = null;
  private stopInFlight: Promise<void> | null = null;
  private inFlightCount = 0;
  private fatalError: Error | null = null;
  private stopped = false;

  constructor(config: JobEventLoggerConfig) {
    this.jobId = config.jobId;
    this.workerClient = config.workerClient;
    this.debugEnabled = config.debugEnabled;
    this.flushIntervalMs = Math.max(500, config.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS);
    this.batchSize = Math.max(1, config.batchSize ?? DEFAULT_BATCH_SIZE);
    this.maxBuffered = Math.max(this.batchSize, config.maxBuffered ?? DEFAULT_MAX_BUFFERED);
    this.seq = config.seqOffset ?? 0;
    this.persistedSeq = this.seq;
    this.sequenceBase = this.seq;
    this.sequenceEnd = config.sequenceEnd;
    this.ensureReservation = config.ensureReservation;
    this.requestOptions = config.requestOptions;
    this.redactor = config.redactor ?? createJobSecretRedactor();
    this.start();
  }

  public debug(
    phase: string,
    eventType: string,
    message: string,
    payload?: Record<string, unknown>
  ): void {
    if (!this.debugEnabled) return;
    this.enqueue("debug", phase, eventType, message, payload);
  }

  public info(
    phase: string,
    eventType: string,
    message: string,
    payload?: Record<string, unknown>
  ): void {
    this.enqueue("info", phase, eventType, message, payload);
  }

  public warn(
    phase: string,
    eventType: string,
    message: string,
    payload?: Record<string, unknown>
  ): void {
    this.enqueue("warn", phase, eventType, message, payload);
  }

  public error(
    phase: string,
    eventType: string,
    message: string,
    payload?: Record<string, unknown>
  ): void {
    this.enqueue("error", phase, eventType, message, payload);
  }

  /**
   * Persist a raw transcript chunk from the agent's output stream.
   * Uses a distinctive phase/eventType so transcript entries can be
   * filtered and reconstructed independently of structured logs.
   */
  public transcript(
    chunk: string,
    contentType?: "thinking" | "text" | "tool_use",
    payload?: Record<string, unknown>,
  ): void {
    if (!chunk) return;
    this.enqueue("info", "transcript", "raw_output", chunk, payload, contentType);
  }

  public async flush(
    requestOptions = this.requestOptions?.(),
  ): Promise<void> {
    if (this.stopped) {
      return this.stopInFlight ?? this.flushInFlight ?? Promise.resolve();
    }
    if (this.flushInFlight) return this.flushInFlight;
    this.flushInFlight = this.flushInternal(requestOptions).finally(() => {
      this.flushInFlight = null;
    });
    return this.flushInFlight;
  }

  public stop(requestOptions?: WorkerClientRequestOptions): Promise<void> {
    if (this.stopInFlight) return this.stopInFlight;
    this.stopped = true;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    this.stopInFlight = this.drainStrictly(
      requestOptions ?? this.requestOptions?.(),
    );
    return this.stopInFlight;
  }

  public getSequenceHighWater(): number {
    return this.persistedSeq;
  }

  private start(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      void this.flush().catch(() => undefined);
    }, this.flushIntervalMs);
  }

  private enqueue(
    level: JobLogLevel,
    phase: string,
    eventType: string,
    message: string,
    payload?: Record<string, unknown>,
    contentType?: string,
  ): void {
    if (this.stopped) {
      throw new Error("job event logger is frozen");
    }
    if (this.fatalError) throw this.fatalError;
    if (this.seq >= MAX_PERSISTED_SEQUENCE) {
      const error = new Error("job log sequence INT32 space exhausted before enqueue");
      this.fatalError = error;
      throw error;
    }
    if (this.queue.length + this.inFlightCount >= this.maxBuffered) {
      const error = new Error("job event logger buffer capacity exceeded");
      this.fatalError = error;
      throw error;
    }

    const redactedPayload = payload
      ? this.redactor.redactValue(payload)
      : undefined;
    const entry: JobLogEntryPayload = {
      seq: ++this.seq,
      level,
      phase,
      eventType,
      message: this.redactor.redactString(message),
      timestamp: new Date().toISOString(),
      ...(redactedPayload ? { payload: redactedPayload } : {}),
      ...(contentType ? { contentType } : {}),
    };

    this.queue.push(entry);

    if (this.queue.length >= this.batchSize) {
      void this.flush().catch(() => undefined);
    }
  }

  private async flushInternal(
    requestOptions?: WorkerClientRequestOptions,
  ): Promise<void> {
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0, this.batchSize);
    this.inFlightCount = batch.length;
    try {
      await this.persistBatch(batch, requestOptions);
    } catch {
      // Best effort: restore dropped batch for a future retry.
      this.queue = [...batch, ...this.queue];
    } finally {
      this.inFlightCount = 0;
    }
  }

  private async ensureSequenceCapacity(
    highestSequence: number,
    requestOptions?: WorkerClientRequestOptions,
  ): Promise<void> {
    const currentEnd = this.sequenceEnd;
    if (currentEnd === undefined) return;
    if (highestSequence > MAX_PERSISTED_SEQUENCE) {
      throw new Error("job log sequence INT32 space exhausted before publish");
    }

    const span = currentEnd - this.sequenceBase;
    const renewalAt = this.sequenceBase + Math.ceil(span * RESERVATION_RENEWAL_RATIO);
    const needsExtension = highestSequence > currentEnd || highestSequence >= renewalAt;
    if (!needsExtension || currentEnd === MAX_PERSISTED_SEQUENCE) return;
    if (!this.ensureReservation) {
      throw new Error("job log sequence reservation capability is unavailable");
    }

    const requiredThrough = Math.max(highestSequence, currentEnd + 1);
    const reservedThrough = await raceWithAbort(
      this.ensureReservation(requiredThrough, requestOptions),
      requestOptions?.signal,
    );
    throwIfAborted(requestOptions?.signal);
    if (
      !Number.isInteger(reservedThrough) ||
      reservedThrough < requiredThrough ||
      reservedThrough > MAX_PERSISTED_SEQUENCE
    ) {
      throw new Error("job log sequence reservation response is invalid");
    }
    this.sequenceEnd = Math.max(currentEnd, reservedThrough);
  }

  private async persistBatch(
    batch: JobLogEntryPayload[],
    requestOptions?: WorkerClientRequestOptions,
  ): Promise<void> {
    const highestSequence = batch.at(-1)?.seq;
    if (highestSequence === undefined) return;
    throwIfAborted(requestOptions?.signal);
    await this.ensureSequenceCapacity(highestSequence, requestOptions);
    const response = await raceWithAbort(
      this.workerClient.sendJobLogs(
        this.jobId,
        { logs: batch },
        requestOptions,
      ),
      requestOptions?.signal,
    );
    throwIfAborted(requestOptions?.signal);
    if (
      response.received !== batch.length ||
      response.inserted + response.duplicates !== batch.length
    ) {
      throw new Error("job log persistence did not acknowledge the complete batch");
    }
    this.persistedSeq = Math.max(this.persistedSeq, highestSequence);
  }

  /**
   * Wait for any best-effort flush already in progress, then prove that every
   * remaining buffered row was accepted before allowing the job to be released.
   * Persistent failures are bounded and propagated so the caller fails closed.
   */
  private async drainStrictly(
    requestOptions?: WorkerClientRequestOptions,
  ): Promise<void> {
    if (this.flushInFlight) {
      await raceWithAbort(
        this.flushInFlight,
        requestOptions?.signal,
      );
    }

    let failedAttempts = 0;
    while (this.queue.length > 0) {
      throwIfAborted(requestOptions?.signal);
      const batch = this.queue.splice(0, this.batchSize);
      this.inFlightCount = batch.length;
      try {
        await this.persistBatch(batch, requestOptions);
        failedAttempts = 0;
      } catch (error) {
        this.queue = [...batch, ...this.queue];
        failedAttempts += 1;
        if (failedAttempts >= STRICT_DRAIN_MAX_ATTEMPTS) {
          throw error;
        }
      } finally {
        this.inFlightCount = 0;
      }
    }

    if (this.fatalError) throw this.fatalError;
  }
}

export const createRunnerJobEventLogger = (
  config: JobEventLoggerConfig
): RunnerJobEventLogger => {
  return new RunnerJobEventLogger(config);
};
