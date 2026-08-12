import { randomUUID } from "node:crypto";
import type { Job, JobLogLine, JobStatus, JobStep } from "./types";
import {
  fetchOrigin,
  pullFastForward,
  revParseHead,
  revParseHeadShort,
} from "./git-ops";
import {
  build,
  imageExists,
  listServices,
  upForceRecreate,
  waitHealthy,
  type ComposeContext,
} from "./compose-ops";
import {
  loadShimImageTargets,
  syncShimImageEnvFile,
  type ShimImageTarget,
} from "./shim-images";

const LOG_TAIL_LIMIT = 200;
const HISTORY_RETENTION_MS = 60 * 60 * 1000;
const HEALTHCHECK_TIMEOUT_MS = 5 * 60 * 1000;

export type JobEvent =
  | { type: "log"; line: JobLogLine }
  | { type: "status"; status: JobStatus; step: JobStep | null };

type Subscriber = (event: JobEvent) => void;

interface JobInternal {
  job: Job;
  subscribers: Set<Subscriber>;
}

export interface RunnerConfig {
  repoPath: string;
  composeFile: string;
  envFile: string;
  branch: string;
  excludeServices: string[];
}

const nowIso = (): string => new Date().toISOString();

const makeEmptyJob = (id: string, fromSha: string | null): Job => ({
  id,
  status: "queued",
  step: null,
  exitCode: null,
  startedAt: nowIso(),
  finishedAt: null,
  logTail: [],
  fromSha,
  toSha: null,
  errorMessage: null,
});

export class JobRunner {
  private active: JobInternal | null = null;
  private history = new Map<string, JobInternal>();

  constructor(private readonly cfg: RunnerConfig) {}

  getActive(): Job | null {
    return this.active?.job ?? null;
  }

  getJob(id: string): Job | null {
    if (this.active?.job.id === id) return this.active.job;
    return this.history.get(id)?.job ?? null;
  }

  /**
   * Subscribes a listener to job events. Returns an unsubscribe function.
   * Returns null if the job is unknown or already finished (callers should
   * fetch the final state via getJob and not bother subscribing).
   */
  subscribe(id: string, fn: Subscriber): (() => void) | null {
    const internal =
      this.active?.job.id === id ? this.active : this.history.get(id) ?? null;
    if (!internal) return null;
    if (
      internal.job.status === "success" ||
      internal.job.status === "failed"
    ) {
      return null;
    }
    internal.subscribers.add(fn);
    return () => internal.subscribers.delete(fn);
  }

  async start(): Promise<
    { ok: true; job: Job } | { ok: false; reason: "active"; activeJob: Job }
  > {
    if (this.active) {
      return { ok: false, reason: "active", activeJob: this.active.job };
    }

    const fromSha = await revParseHeadShort(this.cfg.repoPath);
    const id = randomUUID();
    const internal: JobInternal = {
      job: makeEmptyJob(id, fromSha),
      subscribers: new Set(),
    };
    this.active = internal;
    this.gcHistory();

    void this.run(internal).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.fail(internal, msg, -1);
    });

    return { ok: true, job: internal.job };
  }

  // ─── Internal pipeline ────────────────────────────────────────────────────

  private async run(internal: JobInternal): Promise<void> {
    const onLog = (line: JobLogLine): void => this.appendLog(internal, line);
    const ctxBase: Omit<ComposeContext, "buildSha"> = {
      repoPath: this.cfg.repoPath,
      composeFile: this.cfg.composeFile,
      envFile: this.cfg.envFile,
      onLog,
    };

    this.setStatus(internal, "running", "fetching");
    this.systemLog(internal, `Starting update job ${internal.job.id}`);

    // 1. git fetch + pull --ff-only
    const fetchResult = await fetchOrigin({
      repoPath: this.cfg.repoPath,
      branch: this.cfg.branch,
      onLog,
    });
    if (!fetchResult.ok) {
      this.fail(internal, `git fetch failed: ${fetchResult.stderr}`, fetchResult.exitCode);
      return;
    }
    const pullResult = await pullFastForward({
      repoPath: this.cfg.repoPath,
      branch: this.cfg.branch,
      onLog,
    });
    if (!pullResult.ok) {
      this.fail(internal, `git pull failed: ${pullResult.stderr}`, pullResult.exitCode);
      return;
    }
    const newShaFull = await revParseHead(this.cfg.repoPath);
    const newShaShort = newShaFull ? newShaFull.slice(0, 7) : null;
    internal.job.toSha = newShaShort;
    this.systemLog(internal, `At revision ${newShaShort ?? "unknown"}`);

    // 2. Build missing agent shim images before the runner is recreated.
    //
    // Shim services are intentionally hidden behind the `shims` profile because
    // they are images only: Compose must build them, but it must never start
    // them as long-running services. The runner later launches these images as
    // sibling containers per agent job.
    this.setStatus(internal, "running", "building");
    const shimResult = await this.ensureShimImages(internal, {
      ...ctxBase,
      buildSha: newShaFull,
      profiles: ["shims"],
    });
    if (!shimResult.ok) return;

    // 3. docker compose build (with ALMIRANT_BUILD_SHA injected)
    let services: string[];
    try {
      const all = await listServices({ ...ctxBase, buildSha: newShaFull });
      services = all.filter((s) => !this.cfg.excludeServices.includes(s));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.fail(internal, msg, -1);
      return;
    }
    if (services.length === 0) {
      this.fail(internal, "No services to update after exclusions", -1);
      return;
    }
    this.systemLog(internal, `Building services: ${services.join(", ")}`);
    const buildResult = await build(services, { ...ctxBase, buildSha: newShaFull });
    if (!buildResult.ok) {
      this.fail(internal, `docker compose build failed: ${buildResult.stderr}`, buildResult.exitCode);
      return;
    }

    // 4. docker compose up -d --force-recreate <services excluding updater>
    this.setStatus(internal, "running", "recreating");
    this.systemLog(internal, `Recreating services: ${services.join(", ")}`);
    const upResult = await upForceRecreate(services, { ...ctxBase, buildSha: newShaFull });
    if (!upResult.ok) {
      this.fail(internal, `docker compose up failed: ${upResult.stderr}`, upResult.exitCode);
      return;
    }

    // 5. wait for healthy
    this.setStatus(internal, "running", "healthchecking");
    const health = await waitHealthy(
      services,
      { ...ctxBase, buildSha: newShaFull },
      HEALTHCHECK_TIMEOUT_MS,
    );
    if (!health.allHealthy) {
      const summary = health.statuses
        .map((s) => `${s.service}=${s.health ?? s.state}`)
        .join(" ");
      this.fail(internal, `services did not become healthy: ${summary}`, -1);
      return;
    }

    this.setStatus(internal, "success", "done");
    internal.job.exitCode = 0;
    internal.job.finishedAt = nowIso();
    this.systemLog(internal, `Update completed successfully`);
    this.archiveActive();
  }

  private async ensureShimImages(
    internal: JobInternal,
    ctx: ComposeContext,
  ): Promise<{ ok: true } | { ok: false }> {
    let targets: ShimImageTarget[];

    try {
      targets = loadShimImageTargets(this.cfg.repoPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.fail(internal, `shim image manifest failed: ${msg}`, -1);
      return { ok: false };
    }

    const envSync = syncShimImageEnvFile(
      this.cfg.repoPath,
      this.cfg.envFile,
      targets,
    );
    for (const updated of envSync.updated) {
      this.systemLog(
        internal,
        `Updated ${updated.envVar} from ${updated.from} to ${updated.to}`,
      );
    }
    for (const appended of envSync.appended) {
      this.systemLog(
        internal,
        `Added ${appended.envVar}=${appended.to} to ${this.cfg.envFile}`,
      );
    }
    for (const skipped of envSync.skippedCustom) {
      this.systemLog(
        internal,
        `Keeping custom ${skipped.envVar}=${skipped.value} ` +
          `(manifest expects ${skipped.expected})`,
      );
    }

    const missing: ShimImageTarget[] = [];
    for (const target of targets) {
      const exists = await imageExists(target.image, ctx);
      if (!exists) missing.push(target);
    }

    if (missing.length === 0) {
      this.systemLog(
        internal,
        `Shim images already present: ${targets.map((target) => target.image).join(", ")}`,
      );
      return { ok: true };
    }

    const services = missing.map((target) => target.service);
    this.systemLog(
      internal,
      `Building missing shim images: ${missing.map((target) => target.image).join(", ")}`,
    );

    const result = await build(services, ctx);
    if (!result.ok) {
      this.fail(
        internal,
        `docker compose build shims failed: ${result.stderr}`,
        result.exitCode,
      );
      return { ok: false };
    }

    return { ok: true };
  }

  // ─── State mutators ───────────────────────────────────────────────────────

  private setStatus(internal: JobInternal, status: JobStatus, step: JobStep | null): void {
    internal.job.status = status;
    internal.job.step = step;
    this.emit(internal, { type: "status", status, step });
  }

  private appendLog(internal: JobInternal, line: JobLogLine): void {
    const tail = internal.job.logTail;
    tail.push(line);
    if (tail.length > LOG_TAIL_LIMIT) {
      tail.splice(0, tail.length - LOG_TAIL_LIMIT);
    }
    this.emit(internal, { type: "log", line });
  }

  private systemLog(internal: JobInternal, text: string): void {
    this.appendLog(internal, { timestamp: nowIso(), source: "system", text });
  }

  private fail(internal: JobInternal, message: string, exitCode: number): void {
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

  private emit(internal: JobInternal, event: JobEvent): void {
    for (const fn of internal.subscribers) {
      try {
        fn(event);
      } catch {
        // subscriber threw — drop it silently to avoid breaking the pipeline
      }
    }
  }

  private gcHistory(): void {
    const cutoff = Date.now() - HISTORY_RETENTION_MS;
    for (const [id, entry] of this.history) {
      const finished = entry.job.finishedAt
        ? Date.parse(entry.job.finishedAt)
        : 0;
      if (finished && finished < cutoff) this.history.delete(id);
    }
  }
}
