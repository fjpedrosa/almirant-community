import type { AlmirantWorkerClient, JobLogEntryPayload, JobLogLevel } from "@almirant/remote-agent";

type JobEventLoggerConfig = {
  jobId: string;
  workerClient: AlmirantWorkerClient;
  debugEnabled: boolean;
  flushIntervalMs?: number;
  batchSize?: number;
  maxBuffered?: number;
  /** Starting seq offset — set to avoid unique-constraint collisions on retries. */
  seqOffset?: number;
};

const DEFAULT_FLUSH_INTERVAL_MS = 2_000;
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_MAX_BUFFERED = 10_000;

export class RunnerJobEventLogger {
  private readonly jobId: string;
  private readonly workerClient: AlmirantWorkerClient;
  private readonly debugEnabled: boolean;
  private readonly flushIntervalMs: number;
  private readonly batchSize: number;
  private readonly maxBuffered: number;

  private seq: number;
  private queue: JobLogEntryPayload[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private flushInFlight: Promise<void> | null = null;
  private stopped = false;

  constructor(config: JobEventLoggerConfig) {
    this.jobId = config.jobId;
    this.workerClient = config.workerClient;
    this.debugEnabled = config.debugEnabled;
    this.flushIntervalMs = Math.max(500, config.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS);
    this.batchSize = Math.max(1, config.batchSize ?? DEFAULT_BATCH_SIZE);
    this.maxBuffered = Math.max(this.batchSize, config.maxBuffered ?? DEFAULT_MAX_BUFFERED);
    this.seq = config.seqOffset ?? 0;
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

  public async flush(): Promise<void> {
    if (this.flushInFlight) return this.flushInFlight;
    this.flushInFlight = this.flushInternal().finally(() => {
      this.flushInFlight = null;
    });
    return this.flushInFlight;
  }

  public async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }

  private start(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      void this.flush();
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
    if (this.stopped) return;

    const entry: JobLogEntryPayload = {
      seq: ++this.seq,
      level,
      phase,
      eventType,
      message,
      timestamp: new Date().toISOString(),
      ...(payload ? { payload } : {}),
      ...(contentType ? { contentType } : {}),
    };

    this.queue.push(entry);
    if (this.queue.length > this.maxBuffered) {
      this.queue = this.queue.slice(-this.maxBuffered);
    }

    if (this.queue.length >= this.batchSize) {
      void this.flush();
    }
  }

  private async flushInternal(): Promise<void> {
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0, this.batchSize);
    try {
      await this.workerClient.sendJobLogs(this.jobId, { logs: batch });
    } catch {
      // Best effort: restore dropped batch for a future retry.
      this.queue = [...batch, ...this.queue].slice(-this.maxBuffered);
    }
  }
}

export const createRunnerJobEventLogger = (
  config: JobEventLoggerConfig
): RunnerJobEventLogger => {
  return new RunnerJobEventLogger(config);
};
