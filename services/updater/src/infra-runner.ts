import { randomUUID } from "node:crypto";
import type { Job, JobLogLine, JobStatus, JobStep } from "./types";
import {
  applyTailnetDb,
  disableTailnetDb,
  getTailnetDbStatus,
  waitTailnetDbReady,
  type TailnetDbApplyPayload,
  type TailnetDbContext,
  type TailnetDbRuntimeStatus,
} from "./tailnet-db-ops";

const LOG_TAIL_LIMIT = 200;
const HISTORY_RETENTION_MS = 60 * 60 * 1000;

export type InfraOperation =
  | { kind: "tailscale-db-apply"; payload: TailnetDbApplyPayload }
  | { kind: "tailscale-db-disable" };

export type InfraJobEvent =
  | { type: "log"; line: JobLogLine }
  | { type: "status"; status: JobStatus; step: JobStep | null };

type Subscriber = (event: InfraJobEvent) => void;

interface InfraJobInternal {
  job: Job;
  operation: InfraOperation;
  subscribers: Set<Subscriber>;
}

export interface InfraRunnerConfig {
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

export class InfraRunner {
  private active: InfraJobInternal | null = null;
  private history = new Map<string, InfraJobInternal>();

  constructor(private readonly cfg: InfraRunnerConfig) {}

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
    if (internal.job.status === "success" || internal.job.status === "failed") return null;
    internal.subscribers.add(fn);
    return () => internal.subscribers.delete(fn);
  }

  async start(operation: InfraOperation): Promise<
    { ok: true; job: Job } | { ok: false; reason: "active"; activeJob: Job }
  > {
    if (this.active) {
      return { ok: false, reason: "active", activeJob: this.active.job };
    }

    const id = randomUUID();
    const internal: InfraJobInternal = {
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

  getTailnetDbStatus(): Promise<TailnetDbRuntimeStatus> {
    return getTailnetDbStatus(this.ctx());
  }

  private ctx(onLog?: (line: JobLogLine) => void): TailnetDbContext {
    return {
      repoPath: this.cfg.repoPath,
      composeFile: this.cfg.composeFile,
      envFile: this.cfg.envFile,
      onLog,
    };
  }

  private async run(internal: InfraJobInternal): Promise<void> {
    const onLog = (line: JobLogLine): void => this.appendLog(internal, line);
    const ctx = this.ctx(onLog);

    this.setStatus(internal, "running", "preparing");
    this.systemLog(internal, `Starting infra job ${internal.job.id}: ${internal.operation.kind}`);

    if (internal.operation.kind === "tailscale-db-disable") {
      this.setStatus(internal, "running", "stopping");
      const result = await disableTailnetDb(ctx);
      if (!result.ok) {
        this.fail(internal, `docker compose rm failed: ${result.stderr}`, result.exitCode);
        return;
      }
      this.setStatus(internal, "success", "done");
      internal.job.exitCode = 0;
      internal.job.finishedAt = nowIso();
      this.archiveActive();
      return;
    }

    this.setStatus(internal, "running", "applying");
    const apply = await applyTailnetDb(ctx, internal.operation.payload);
    if (!apply.ok) {
      this.fail(internal, `docker compose up failed: ${apply.stderr}`, apply.exitCode);
      return;
    }

    this.setStatus(internal, "running", "healthchecking");
    const status = await waitTailnetDbReady(ctx);
    if (!status.online || status.proxyServiceState !== "running") {
      this.fail(
        internal,
        status.error ?? "Tailscale DB sidecar did not become ready",
        -1,
      );
      return;
    }

    this.setStatus(internal, "success", "done");
    internal.job.exitCode = 0;
    internal.job.finishedAt = nowIso();
    this.systemLog(internal, "Tailnet database access is ready");
    this.archiveActive();
  }

  private setStatus(internal: InfraJobInternal, status: JobStatus, step: JobStep | null): void {
    internal.job.status = status;
    internal.job.step = step;
    this.emit(internal, { type: "status", status, step });
  }

  private appendLog(internal: InfraJobInternal, line: JobLogLine): void {
    const redacted = {
      ...line,
      text: line.text.replace(/tskey-[a-z]+-[A-Za-z0-9_-]+/g, "[REDACTED_TAILSCALE_KEY]"),
    };
    const tail = internal.job.logTail;
    tail.push(redacted);
    if (tail.length > LOG_TAIL_LIMIT) tail.splice(0, tail.length - LOG_TAIL_LIMIT);
    this.emit(internal, { type: "log", line: redacted });
  }

  private systemLog(internal: InfraJobInternal, text: string): void {
    this.appendLog(internal, { timestamp: nowIso(), source: "system", text });
  }

  private fail(internal: InfraJobInternal, message: string, exitCode: number): void {
    internal.job.errorMessage = message.replace(/tskey-[a-z]+-[A-Za-z0-9_-]+/g, "[REDACTED_TAILSCALE_KEY]");
    internal.job.exitCode = exitCode;
    internal.job.finishedAt = nowIso();
    this.systemLog(internal, `FAILED: ${internal.job.errorMessage}`);
    this.setStatus(internal, "failed", internal.job.step);
    this.archiveActive();
  }

  private archiveActive(): void {
    if (!this.active) return;
    this.history.set(this.active.job.id, this.active);
    this.active.subscribers.clear();
    this.active = null;
  }

  private emit(internal: InfraJobInternal, event: InfraJobEvent): void {
    for (const fn of internal.subscribers) {
      try {
        fn(event);
      } catch {
        // drop broken subscribers
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
