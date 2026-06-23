import { randomUUID } from "node:crypto";
import type { Job, JobLogLine, JobStatus, JobStep } from "./types";
import {
  cleanupExitedAgentContainers,
  getServiceOperationsStatus,
  isControllableService,
  restartControllableService,
  waitForControllableService,
  type ControllableService,
  type ServiceOperationsStatus,
} from "./service-ops";
import type { ComposeContext } from "./compose-ops";

const LOG_TAIL_LIMIT = 200;
const HISTORY_RETENTION_MS = 60 * 60 * 1000;

export type ServiceOperation =
  | { kind: "restart-service"; service: ControllableService }
  | { kind: "cleanup-exited-agent-containers" };

export type ServiceOperationEvent =
  | { type: "log"; line: JobLogLine }
  | { type: "status"; status: JobStatus; step: JobStep | null };

type Subscriber = (event: ServiceOperationEvent) => void;

interface ServiceOperationInternal {
  job: Job;
  operation: ServiceOperation;
  subscribers: Set<Subscriber>;
}

export interface ServiceOpsRunnerConfig {
  repoPath: string;
  composeFile: string;
  envFile: string;
}

const nowIso = (): string => new Date().toISOString();

const makeEmptyJob = (id: string): Job => ({
  id,
  status: "queued",
  step: null,
  exitCode: null,
  startedAt: nowIso(),
  finishedAt: null,
  logTail: [],
  fromSha: null,
  toSha: null,
  errorMessage: null,
});

export class ServiceOpsRunner {
  private active: ServiceOperationInternal | null = null;
  private history = new Map<string, ServiceOperationInternal>();

  constructor(private readonly cfg: ServiceOpsRunnerConfig) {}

  getActive(): Job | null {
    return this.active?.job ?? null;
  }

  getJob(id: string): Job | null {
    if (this.active?.job.id === id) return this.active.job;
    return this.history.get(id)?.job ?? null;
  }

  subscribe(id: string, fn: Subscriber): (() => void) | null {
    const internal =
      this.active?.job.id === id ? this.active : this.history.get(id) ?? null;
    if (!internal) return null;
    if (internal.job.status === "success" || internal.job.status === "failed") {
      return null;
    }
    internal.subscribers.add(fn);
    return () => internal.subscribers.delete(fn);
  }

  getStatus(): Promise<ServiceOperationsStatus> {
    return getServiceOperationsStatus(this.ctx());
  }

  async start(operation: ServiceOperation): Promise<
    { ok: true; job: Job } | { ok: false; reason: "active"; activeJob: Job }
  > {
    if (this.active) {
      return { ok: false, reason: "active", activeJob: this.active.job };
    }

    if (
      operation.kind === "restart-service" &&
      !isControllableService(operation.service)
    ) {
      throw new Error(`Service is not controllable: ${operation.service}`);
    }

    const id = randomUUID();
    const internal: ServiceOperationInternal = {
      job: makeEmptyJob(id),
      operation,
      subscribers: new Set(),
    };
    this.active = internal;
    this.gcHistory();

    void this.run(internal).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      this.fail(internal, message, -1);
    });

    return { ok: true, job: internal.job };
  }

  private ctx(onLog?: (line: JobLogLine) => void): ComposeContext {
    return {
      repoPath: this.cfg.repoPath,
      composeFile: this.cfg.composeFile,
      envFile: this.cfg.envFile,
      buildSha: null,
      onLog,
    };
  }

  private async run(internal: ServiceOperationInternal): Promise<void> {
    const onLog = (line: JobLogLine): void => this.appendLog(internal, line);
    const ctx = this.ctx(onLog);

    this.setStatus(internal, "running", "preparing");
    this.systemLog(
      internal,
      `Starting service operation ${internal.job.id}: ${internal.operation.kind}`,
    );

    if (internal.operation.kind === "cleanup-exited-agent-containers") {
      this.setStatus(internal, "running", "cleaning");
      const result = await cleanupExitedAgentContainers(ctx, onLog);
      this.systemLog(
        internal,
        `Removed ${result.removed} exited agent container(s); ` +
          `failed=${result.failed}; skippedRunning=${result.skippedRunning}`,
      );
      if (result.failed > 0) {
        this.fail(
          internal,
          `Failed to remove ${result.failed} exited agent container(s)`,
          -1,
        );
        return;
      }

      this.succeed(internal);
      return;
    }

    const service = internal.operation.service;
    this.setStatus(internal, "running", "restarting");
    this.systemLog(internal, `Restarting compose service: ${service}`);
    const restart = await restartControllableService(service, ctx);
    if (!restart.ok) {
      this.fail(
        internal,
        `docker compose restart ${service} failed: ${restart.stderr || restart.stdout}`,
        restart.exitCode,
      );
      return;
    }

    this.setStatus(internal, "running", "healthchecking");
    const health = await waitForControllableService(service, ctx);
    if (!health.allHealthy) {
      this.fail(
        internal,
        `service ${service} did not become healthy after restart`,
        -1,
      );
      return;
    }

    this.succeed(internal);
  }

  private setStatus(
    internal: ServiceOperationInternal,
    status: JobStatus,
    step: JobStep | null,
  ): void {
    internal.job.status = status;
    internal.job.step = step;
    this.emit(internal, { type: "status", status, step });
  }

  private appendLog(internal: ServiceOperationInternal, line: JobLogLine): void {
    internal.job.logTail.push(line);
    if (internal.job.logTail.length > LOG_TAIL_LIMIT) {
      internal.job.logTail.splice(0, internal.job.logTail.length - LOG_TAIL_LIMIT);
    }
    this.emit(internal, { type: "log", line });
  }

  private systemLog(internal: ServiceOperationInternal, text: string): void {
    this.appendLog(internal, { timestamp: nowIso(), source: "system", text });
  }

  private succeed(internal: ServiceOperationInternal): void {
    internal.job.exitCode = 0;
    internal.job.finishedAt = nowIso();
    this.setStatus(internal, "success", "done");
    this.systemLog(internal, "Service operation completed successfully");
    this.archiveActive();
  }

  private fail(
    internal: ServiceOperationInternal,
    message: string,
    exitCode: number,
  ): void {
    internal.job.errorMessage = message;
    internal.job.exitCode = exitCode;
    internal.job.finishedAt = nowIso();
    this.systemLog(internal, `FAILED: ${message}`);
    this.setStatus(internal, "failed", internal.job.step);
    this.archiveActive();
  }

  private archiveActive(): void {
    if (!this.active) return;
    this.history.set(this.active.job.id, this.active);
    this.active.subscribers.clear();
    this.active = null;
  }

  private emit(
    internal: ServiceOperationInternal,
    event: ServiceOperationEvent,
  ): void {
    for (const fn of internal.subscribers) {
      try {
        fn(event);
      } catch {
        // Drop broken subscribers.
      }
    }
  }

  private gcHistory(): void {
    const cutoff = Date.now() - HISTORY_RETENTION_MS;
    for (const [id, entry] of this.history) {
      const finished = entry.job.finishedAt ? Date.parse(entry.job.finishedAt) : 0;
      if (finished && finished < cutoff) this.history.delete(id);
    }
  }
}
