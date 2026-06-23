import os from "os";
import { statfsSync } from "node:fs";
import type {
  AlmirantWorkerClient,
  ClaimedJob,
  DefinitionOfDoneReviewCandidate,
  ScheduledAgentConfig,
  TimeWindowScheduleConfig,
  CronScheduleConfig,
} from "@almirant/remote-agent";
import { Cron } from "croner";
import type { ContainerCleanupResult, ContainerManager } from "../workspace/container-manager";
import type { JobExecutor } from "../job-executor";
import type { RunnerStatusSnapshot } from "../shared/types";
import { classifyError, isRecoverableError } from "../shared/types";
import { emitHeartbeatMetrics } from "../observability/telemetry";
import {
  calculateRamBoundAvailableSlots,
  calculateRunnerMemorySnapshot,
  getSystemMemorySnapshot,
  normalizeReservedMemoryMb,
  resolveJobMemoryRequirement,
  type RunnerMemorySnapshot,
} from "./runner-memory";
import { resolveQuotaAvailableAt } from "../shared/quota-pause";

type RunnerOrchestratorConfig = {
  workerId: string;
  hostname: string;
  maxConcurrent: number;
  heartbeatIntervalMs: number;
  claimIntervalMs: number;
  nightlyCheckIntervalMs: number;
  ramBudgetEnabled: boolean;
  ramReservedMb?: number;
  apiUrl: string;
  apiKey: string;
  maxAutoRetries?: number;
  retryBackoffMs?: number;
  /** Runner-local path to workspace directories (e.g. "/app/repos"). */
  repositoryPath?: string;
};

type RunnerOrchestratorDeps = {
  workerClient: AlmirantWorkerClient;
  containerManager: ContainerManager;
  jobExecutor: JobExecutor;
};

type RunnerContainerHealth = {
  status: "healthy" | "degraded";
  zombieSuspected: number;
  cleanupFailures: number;
  lastCleanupAt?: string;
  lastIssue?: string;
};

const createHealthyContainerHealth = (): RunnerContainerHealth => ({
  status: "healthy",
  zombieSuspected: 0,
  cleanupFailures: 0,
});

const resolveScheduledWorkItemSkillName = (jobType: string): string => {
  if (jobType === "validation") return "validate";
  if (jobType === "bug-fix") return "nightly-fix";
  if (jobType === "planning") return "ideate";
  if (jobType === "review") return "review";
  if (jobType === "integration") return "runner-release-integration";
  return "runner-implement";
};

const DEFAULT_DOD_REVIEW_MIN_AGE_MINUTES = 15;
const DEFAULT_PROJECT_OPEN_TICKET_LIMIT = 1;

type ProjectConcurrencyRule = {
  projectId: string;
  enabled?: boolean;
  maxConcurrentJobs?: number | null;
};

type ProjectConcurrencyConfig = {
  defaultMaxConcurrentJobs?: number | null;
  projects?: ProjectConcurrencyRule[];
};

type ProjectConcurrencyScope = {
  projectId?: string;
  maxActiveItems: number;
};

const finitePositiveInt = (value: number | null | undefined): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : undefined;
};

const resolveQuietPeriodMinutes = (value: number | null | undefined): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_DOD_REVIEW_MIN_AGE_MINUTES;
  }
  return Math.max(0, Math.floor(value));
};

export class RunnerOrchestrator {
  private readonly config: RunnerOrchestratorConfig;
  private readonly workerClient: AlmirantWorkerClient;
  private readonly containerManager: ContainerManager;
  private readonly jobExecutor: JobExecutor;

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private claimTimer: ReturnType<typeof setInterval> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private scheduleTimer: ReturnType<typeof setInterval> | null = null;

  private running = false;
  private draining = false;
  private drainResolve: (() => void) | null = null;
  private readonly startedAt = new Date().toISOString();
  private readonly activeJobs = new Map<string, Promise<void>>();
  private readonly activeJobMeta = new Map<string, ClaimedJob>();
  private readonly jobMemoryMap = new Map<string, number>();
  private containerHealth: RunnerContainerHealth = createHealthyContainerHealth();

  // Optional RAM budget: host-protection guard. When enabled, claims are
  // bounded by *current* MemAvailable plus forecasted per-job reservations.
  // MAX_CONCURRENT remains a CPU/operational safety cap; RAM budgeting
  // adds a second dynamic bound.
  private readonly ramBudgetMb: number;
  private readonly ramReservedMb: number;

  private isWorkerDegraded(): boolean {
    return this.containerHealth.status === "degraded";
  }

  private getRamCommittedMb(): number {
    let total = 0;
    for (const mb of this.jobMemoryMap.values()) total += mb;
    return total;
  }

  private getRamAvailableMb(): number {
    if (!this.config.ramBudgetEnabled) {
      return Math.max(0, this.ramBudgetMb - this.getRamCommittedMb());
    }

    return this.getMemorySnapshot().availableForRunnersMb;
  }

  private getMemorySnapshot(): RunnerMemorySnapshot {
    return calculateRunnerMemorySnapshot({
      system: getSystemMemorySnapshot(),
      committedMb: this.getRamCommittedMb(),
      reservedMb: this.ramReservedMb,
    });
  }

  private getAvailableSlots(memorySnapshot = this.getMemorySnapshot()): number {
    return calculateRamBoundAvailableSlots({
      maxConcurrent: this.config.maxConcurrent,
      activeJobs: this.activeJobs.size,
      ramBudgetEnabled: this.config.ramBudgetEnabled,
      availableForRunnersMb: memorySnapshot.availableForRunnersMb,
      defaultJobMemoryMb: resolveJobMemoryRequirement({
        id: "default-slot",
        workItemId: null,
        projectId: null,
        boardId: null,
        createdByUserId: null,
        organizationId: null,
        provider: "zipu",
        priority: "medium",
        status: "queued",
        retryCount: 0,
        maxRetries: 0,
        availableAt: null,
        config: { skillName: "runner-implement" },
        promptTemplate: "runner-implement",
      }).memoryMb,
    });
  }

  constructor(config: RunnerOrchestratorConfig, deps: RunnerOrchestratorDeps) {
    this.config = config;
    this.workerClient = deps.workerClient;
    this.containerManager = deps.containerManager;
    this.jobExecutor = deps.jobExecutor;

    const hostTotalMb = Math.floor(os.totalmem() / (1024 * 1024));
    this.ramReservedMb = normalizeReservedMemoryMb(this.config.ramReservedMb);
    if (this.config.ramBudgetEnabled) {
      this.ramBudgetMb = Math.max(0, hostTotalMb - this.ramReservedMb);
      console.log(
        `RAM budget: ${this.ramBudgetMb}MB ` +
        `(host: ${hostTotalMb}MB, reserved: ${this.ramReservedMb}MB)`
      );
    } else {
      this.ramBudgetMb = hostTotalMb;
      console.log(`RAM budget disabled (host: ${hostTotalMb}MB, maxConcurrent: ${this.config.maxConcurrent})`);
    }
  }

  public async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;

    // Reconcile stale jobs from previous run before entering the main loop.
    // Then run orphan cleanup once before claiming so stale/zombie containers
    // cannot consume capacity invisibly after a runner restart.
    await this.reconcileOnStartup();
    await this.cleanupOrphans();

    void this.sendHeartbeat();
    void this.claimAndRun();

    this.heartbeatTimer = setInterval(() => {
      void this.sendHeartbeat();
    }, this.config.heartbeatIntervalMs);

    this.claimTimer = setInterval(() => {
      void this.claimAndRun();
    }, this.config.claimIntervalMs);

    this.cleanupTimer = setInterval(() => {
      void this.cleanupOrphans();
    }, 5 * 60 * 1000);

    void this.scheduleValidation();
    void this.processScheduledConfigs();
    this.scheduleTimer = setInterval(() => {
      void this.scheduleValidation();
      void this.processScheduledConfigs();
    }, this.config.nightlyCheckIntervalMs);
  }

  public async stop(): Promise<void> {
    this.running = false;

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.claimTimer) {
      clearInterval(this.claimTimer);
      this.claimTimer = null;
    }

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    if (this.scheduleTimer) {
      clearInterval(this.scheduleTimer);
      this.scheduleTimer = null;
    }

    await Promise.allSettled([...this.activeJobs.values()]);
  }

  /**
   * Initiates graceful drain: stops claiming new jobs and resolves
   * the returned promise once all active jobs have completed.
   */
  public drain(): Promise<void> {
    if (this.draining) {
      // Already draining - return a promise that resolves when done
      return new Promise<void>((resolve) => {
        const prev = this.drainResolve;
        this.drainResolve = () => {
          prev?.();
          resolve();
        };
      });
    }

    this.draining = true;
    console.log("runner entering drain mode - no new jobs will be claimed");

    // If there are no active jobs, resolve immediately
    if (this.activeJobs.size === 0) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.drainResolve = resolve;
    });
  }

  /**
   * Returns true if the runner is draining (not accepting new jobs).
   */
  public get isDraining(): boolean {
    return this.draining;
  }

  public getSnapshot(): RunnerStatusSnapshot {
    const memorySnapshot = this.getMemorySnapshot();
    return {
      workerId: this.config.workerId,
      startedAt: this.startedAt,
      activeJobs: this.activeJobs.size,
      isRunning: this.running,
      isDraining: this.draining || this.isWorkerDegraded(),
      availableSlots: this.draining || this.isWorkerDegraded()
        ? 0
        : this.getAvailableSlots(memorySnapshot),
      ramBudgetMb: this.ramBudgetMb,
      ramCommittedMb: this.getRamCommittedMb(),
      ramAvailableMb: this.getRamAvailableMb(),
      ramReservedMb: memorySnapshot.reservedMb,
      ramSystemAvailableMb: memorySnapshot.systemAvailableMb,
      ramAvailableForRunnersMb: memorySnapshot.availableForRunnersMb,
    };
  }

  private async sendHeartbeat(): Promise<void> {
    if (!this.running) {
      return;
    }

    try {
      const cpus = os.cpus();
      const cpuPercent =
        cpus.length > 0
          ? cpus.reduce((acc, cpu) => {
              const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
              return acc + ((total - cpu.times.idle) / total) * 100;
            }, 0) / cpus.length
          : 0;

      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const memorySnapshot = this.getMemorySnapshot();
      const effectiveAvailableSlots = this.draining || this.isWorkerDegraded()
        ? 0
        : this.getAvailableSlots(memorySnapshot);
      const effectiveMaxConcurrent = this.activeJobs.size + effectiveAvailableSlots;

      // Disk usage (root filesystem)
      let diskTotalGb = 0;
      let diskUsedGb = 0;
      let diskPercent = 0;
      try {
        const fs = statfsSync("/");
        const totalBytes = fs.blocks * fs.bsize;
        const freeBytes = fs.bavail * fs.bsize;
        diskTotalGb = Math.round((totalBytes / 1024 / 1024 / 1024) * 10) / 10;
        diskUsedGb = Math.round(((totalBytes - freeBytes) / 1024 / 1024 / 1024) * 10) / 10;
        diskPercent = Math.round((1 - freeBytes / totalBytes) * 10000) / 100;
      } catch {
        // statfs may fail in some container environments
      }

      const processes: Array<{ jobId: string; skillName: string }> = [];
      for (const [jobId, job] of this.activeJobMeta) {
        processes.push({
          jobId,
          skillName: (job as Record<string, unknown>).promptTemplate as string
            ?? (job.config?.skillName as string)
            ?? "unknown",
        });
      }

      // Collect per-container stats
      let containerMetrics: Array<{
        containerId: string;
        jobId: string;
        jobType: string;
        cpuPercent: number;
        memoryUsageMb: number;
        memoryLimitMb: number;
        memoryPercent: number;
      }> = [];
      try {
        const stats = await this.containerManager.getContainerStats();
        containerMetrics = stats.map((s) => ({
          ...s,
          jobType: this.activeJobMeta.get(s.jobId)?.jobType ?? "unknown",
        }));
      } catch {
        // Non-critical — skip container metrics on failure.
      }

      const heartbeatCpuPercent = Math.round(cpuPercent * 100) / 100;
      const heartbeatRamUsedMb = Math.round(usedMem / 1024 / 1024);
      const heartbeatRamTotalMb = Math.round(totalMem / 1024 / 1024);
      const heartbeatRamPercent = Math.round((usedMem / totalMem) * 10000) / 100;

      await this.workerClient.heartbeat({
        workerId: this.config.workerId,
        hostname: this.config.hostname,
        startedAt: this.startedAt,
        activeJobsCount: this.activeJobs.size,
        maxConcurrentAgents: this.config.ramBudgetEnabled
          ? effectiveMaxConcurrent
          : this.config.maxConcurrent,
        isDraining: this.draining || this.isWorkerDegraded(),
        availableSlots: effectiveAvailableSlots,
        ramBudgetMb: this.ramBudgetMb,
        ramCommittedMb: this.getRamCommittedMb(),
        ramAvailableMb: this.getRamAvailableMb(),
        systemMetrics: {
          cpuPercent: heartbeatCpuPercent,
          cpuCores: cpus.length,
          ramPercent: heartbeatRamPercent,
          ramTotalMb: heartbeatRamTotalMb,
          ramUsedMb: heartbeatRamUsedMb,
          ramSystemAvailableMb: memorySnapshot.systemAvailableMb,
          ramReservedMb: memorySnapshot.reservedMb,
          ramAvailableForRunnersMb: memorySnapshot.availableForRunnersMb,
          ramPressurePercent: memorySnapshot.pressurePercent,
          ramBudgetEnabled: this.config.ramBudgetEnabled,
          memorySource: memorySnapshot.source,
          processes,
          containerMetrics,
          containerHealth: this.containerHealth,
        },
      });

      // Emit to PostHog for dashboards
      emitHeartbeatMetrics({
        workerId: this.config.workerId,
        hostname: this.config.hostname,
        cpuPercent: heartbeatCpuPercent,
        ramUsedMb: heartbeatRamUsedMb,
        ramTotalMb: heartbeatRamTotalMb,
        ramPercent: heartbeatRamPercent,
        diskUsedGb,
        diskTotalGb,
        diskPercent,
        activeJobs: this.activeJobs.size,
        maxConcurrent: this.config.ramBudgetEnabled
          ? effectiveMaxConcurrent
          : this.config.maxConcurrent,
        containerMetrics: containerMetrics.map((c) => ({
          jobId: c.jobId,
          jobType: c.jobType,
          memoryUsageMb: c.memoryUsageMb,
          memoryLimitMb: c.memoryLimitMb,
          cpuPercent: c.cpuPercent,
        })),
      });
    } catch (error) {
      console.error("runner heartbeat failed:", error);
    }
  }

  private async claimAndRun(): Promise<void> {
    if (!this.running || this.draining || this.isWorkerDegraded()) {
      return;
    }

    // Hard cap and dynamic RAM cap both apply.
    if (this.getAvailableSlots() <= 0) {
      return;
    }

    while (this.getAvailableSlots() > 0) {
      if (this.config.ramBudgetEnabled && this.getRamAvailableMb() <= 0) break;
      if (!this.running || this.draining || this.isWorkerDegraded()) break;

      const claimCount = Math.max(1, this.getAvailableSlots());
      let claimed: ClaimedJob[] = [];
      try {
        claimed = await this.workerClient.claimJobs({
          workerId: this.config.workerId,
          count: claimCount,
          activeJobs: this.activeJobs.size,
        });
      } catch (error) {
        console.error("runner claim failed:", error);
        return;
      }

      if (claimed.length === 0) break;
      let startedAny = false;

      for (const job of claimed) {
        if (this.getAvailableSlots() <= 0) {
          try {
            await this.workerClient.updateJobStatus(job.id, {
              status: "queued",
            });
          } catch (err) {
            console.error(`[claim] Failed to release extra claimed job ${job.id}:`, err);
          }
          continue;
        }

        const memoryRequirement = resolveJobMemoryRequirement(job);
        const { label, memoryMb: memoryNeeded, source: memorySource } = memoryRequirement;

        if (this.config.ramBudgetEnabled && memoryNeeded > this.getRamAvailableMb()) {
          // Can't fit — release back to queue and keep evaluating the rest of the
          // claimed batch. This avoids FIFO head-of-line blocking: a large job
          // should wait for memory, but smaller later jobs should still run.
          console.log(
            `[ram-budget] Job ${job.id} (${label}, ${memoryNeeded}MB, source=${memorySource}) ` +
            `exceeds available RAM (${this.getRamAvailableMb()}MB), releasing back to queue and checking next claimed job`
          );
          try {
            await this.workerClient.updateJobStatus(job.id, {
              status: "queued",
            });
          } catch (err) {
            console.error(`[ram-budget] Failed to release job ${job.id}:`, err);
          }
          continue;
        }

        if (this.activeJobs.has(job.id)) continue;

        if (this.config.ramBudgetEnabled) {
          // Track memory commitment
          this.jobMemoryMap.set(job.id, memoryNeeded);
          console.log(
            `[ram-budget] Claimed ${job.id} (${label}, ${memoryNeeded}MB, source=${memorySource}) — ` +
            `RAM: ${this.getRamCommittedMb()}/${this.ramBudgetMb}MB committed`
          );
        } else {
          console.log(
            `[claim] Claimed ${job.id} (${label}) — ` +
            `slots: ${this.activeJobs.size + 1}/${this.config.maxConcurrent}`
          );
        }

        const execution = this.executeJob(job)
          .catch((error) => {
            console.error(`runner execution failed for ${job.id}:`, error);
          })
          .finally(() => {
            this.jobMemoryMap.delete(job.id);
            this.activeJobs.delete(job.id);
            this.activeJobMeta.delete(job.id);
            this.checkDrainComplete();
          });

        this.activeJobs.set(job.id, execution);
        this.activeJobMeta.set(job.id, job);
        startedAny = true;
      }

      if (!startedAny) break;
    }
  }

  /**
   * If draining and all jobs have finished, resolve the drain promise.
   */
  private checkDrainComplete(): void {
    if (this.draining && this.activeJobs.size === 0 && this.drainResolve) {
      console.log("runner drain complete - all active jobs finished");
      this.drainResolve();
      this.drainResolve = null;
    }
  }

  private async executeJob(job: ClaimedJob): Promise<void> {
    const maxRetries = this.config.maxAutoRetries ?? 2;
    const backoffMs = this.config.retryBackoffMs ?? 30_000;

    try {
      if (await this.pauseJobIfQuotaExhausted(job)) {
        return;
      }

      await this.jobExecutor.execute(job);
    } catch (error) {
      const classification = classifyError(error instanceof Error ? error : String(error));
      const retryCount = job.retryCount ?? 0;

      if (isRecoverableError(classification) && retryCount < maxRetries) {
        const delay = backoffMs * (retryCount + 1);
        console.log(
          `[orchestrator] Job ${job.id} failed with recoverable error (${classification}), ` +
          `retry ${retryCount + 1}/${maxRetries} in ${delay}ms`
        );

        await new Promise<void>((resolve) => setTimeout(resolve, delay));

        try {
          await this.workerClient.updateJobStatus(job.id, {
            status: "queued",
            retryCount: retryCount + 1,
            errorMessage: `Auto-retry after ${classification}: ${error instanceof Error ? error.message : String(error)}`,
            errorType: classification,
          });
        } catch (retryErr) {
          console.error(
            `[orchestrator] Failed to enqueue retry for job ${job.id}:`,
            retryErr
          );
        }
      } else {
        // Non-recoverable or max retries exceeded — re-throw so the caller logs it
        throw error;
      }
    }
  }

  private resolveJobAiProvider(job: ClaimedJob): string | null {
    if (typeof job.aiProvider === "string" && job.aiProvider.trim().length > 0) {
      return job.aiProvider.trim();
    }

    const configuredProvider = job.config?.aiProvider;
    if (typeof configuredProvider === "string" && configuredProvider.trim().length > 0) {
      return configuredProvider.trim();
    }

    return null;
  }

  private async pauseJobIfQuotaExhausted(job: ClaimedJob): Promise<boolean> {
    const organizationId = typeof job.organizationId === "string" ? job.organizationId.trim() : "";
    const aiProvider = this.resolveJobAiProvider(job);

    if (!organizationId || !aiProvider) {
      return false;
    }

    try {
      const availability = await this.workerClient.checkQuota(aiProvider, organizationId);
      if (availability.allowed) {
        return false;
      }

      const availableAt = resolveQuotaAvailableAt(availability.resetAt ?? availability.periodEnd);
      const reason = availability.reason ?? "Provider quota exhausted";
      const errorType = availability.blockingQuotaType
        ? `${availability.blockingQuotaType}_quota_exceeded`
        : "provider_quota_exceeded";

      console.log(
        `[quota] Job ${job.id} paused before container start: ${reason}; resumes at ${availableAt}`
      );

      await this.workerClient.updateJobStatus(job.id, {
        status: "paused",
        errorMessage: reason,
        errorType,
        availableAt,
        result: {
          pausedForQuota: true,
          source: "pre_session_quota_check",
          aiProvider,
          resetAt: availability.resetAt ?? availability.periodEnd ?? null,
        },
      });

      return true;
    } catch (error) {
      console.error(
        `[quota] Failed quota preflight for job ${job.id}; continuing fail-open:`,
        error
      );
      return false;
    }
  }

  private async scheduleValidation(): Promise<void> {
    if (!this.running || this.draining) return;

    try {
      // 1. Get all project-level nightly validation configs
      const configs = await this.workerClient.getAllNightlyValidationConfigs();

      console.log(`nightly scheduler: checking ${configs.length} projects`);

      const now = new Date();

      for (const config of configs) {
        // 2. Check if enabled for this project
        if (!config.nightlyValidation.enabled) continue;

        // 3. Check if current time is within the configured window
        const formatter = new Intl.DateTimeFormat("en-US", {
          timeZone: config.nightlyValidation.timezone,
          hour: "numeric",
          hour12: false,
        });
        const currentHour = parseInt(formatter.format(now), 10);

        // Handle wrap-around (e.g., startHour=22, endHour=6)
        let inWindow: boolean;
        if (config.nightlyValidation.startHour <= config.nightlyValidation.endHour) {
          inWindow =
            currentHour >= config.nightlyValidation.startHour &&
            currentHour < config.nightlyValidation.endHour;
        } else {
          inWindow =
            currentHour >= config.nightlyValidation.startHour ||
            currentHour < config.nightlyValidation.endHour;
        }

        if (!inWindow) continue;

        // 4. Get validation candidates for this project
        console.log(`nightly scheduler: project ${config.projectName} — checking candidates`);

        const candidates = await this.workerClient.getValidationCandidates({
          projectId: config.projectId,
        });

        if (candidates.length === 0) continue;

        // 5. Create validation jobs for each candidate
        // The deduplication is handled by the candidates endpoint
        // (it does not return items that already have active validation jobs)

        let created = 0;

        for (const candidate of candidates) {
          try {
            await this.workerClient.createJob({
              workItemId: candidate.id,
              provider: config.nightlyValidation.provider,
              jobType: "validation",
              config: {
                projectId: candidate.projectId,
                skillName: "validate",
                source: "nightly-scheduler",
              },
            });
            created++;
          } catch (error) {
            console.error(
              `nightly scheduler: failed to create job for ${candidate.taskId}:`,
              error
            );
          }
        }

        console.log(
          `nightly scheduler: project ${config.projectName} — ${candidates.length} candidates, created ${created} jobs`
        );

        // 6. Get fix candidates for this project (items in Needs Fix with < 2 attempts)
        const fixCandidates = await this.workerClient.getFixCandidates({
          projectId: config.projectId,
        });

        if (fixCandidates.length > 0) {
          let fixCreated = 0;
          for (const candidate of fixCandidates) {
            try {
              await this.workerClient.createJob({
                workItemId: candidate.id,
                provider: config.nightlyValidation.provider,
                jobType: "bug-fix",
                config: {
                  projectId: candidate.projectId,
                  skillName: "nightly-fix",
                  source: "nightly-scheduler",
                },
              });
              fixCreated++;
            } catch (error) {
              console.error(
                `nightly scheduler: failed to create fix job for ${candidate.taskId}:`,
                error
              );
            }
          }
          console.log(
            `nightly scheduler: project ${config.projectName} — ${fixCandidates.length} fix candidates, created ${fixCreated} fix jobs`
          );
        }
      }
    } catch (error) {
      console.error("nightly scheduler check failed:", error);
    }
  }

  /**
   * Processes scheduled_agent_configs from the API.
   * Supports time_window schedule type; cron is logged as unsupported.
   */
  private async processScheduledConfigs(): Promise<void> {
    if (!this.running || this.draining) return;

    try {
      const configs = await this.workerClient.getScheduledConfigs();
      console.log(`scheduled-configs: checking ${configs.length} scheduled configs`);

      const now = new Date();

      for (const config of configs) {
        try {
          await this.processOneScheduledConfig(config, now);
        } catch (error) {
          console.error(
            `scheduled-configs: error processing config "${config.name}" (${config.id}):`,
            error
          );
        }
      }
    } catch (error) {
      console.error("scheduled-configs: check failed:", error);
    }
  }

  private async processOneScheduledConfig(
    config: ScheduledAgentConfig,
    now: Date
  ): Promise<void> {
    if (config.scheduleType === "cron") {
      if (!this.isCronDue(config, now)) return;
    } else {
      if (!this.isTimeWindowActive(config, now)) return;
    }

    await this.executeScheduledConfig(config);
  }

  private isCronDue(config: ScheduledAgentConfig, now: Date): boolean {
    const cronConfig = config.scheduleConfig as CronScheduleConfig;

    try {
      const job = new Cron(cronConfig.expression, { timezone: config.timezone });

      if (config.lastRunAt) {
        const lastRun = new Date(config.lastRunAt);
        const nextRun = job.nextRun(lastRun);

        if (!nextRun || nextRun > now) {
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error(
        `scheduled-configs: invalid cron expression for "${config.name}": ${cronConfig.expression}`,
        error
      );
      return false;
    }
  }

  private isTimeWindowActive(config: ScheduledAgentConfig, now: Date): boolean {
    const scheduleConfig = config.scheduleConfig as TimeWindowScheduleConfig;

    // Check day of week
    const hourFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: config.timezone,
      hour: "numeric",
      hour12: false,
    });

    // Get current day of week (0=Sunday) in config's timezone
    const dateInTz = new Intl.DateTimeFormat("en-US", {
      timeZone: config.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    const tzDate = new Date(dateInTz);
    const currentDayOfWeek = tzDate.getDay();

    if (
      scheduleConfig.daysOfWeek &&
      scheduleConfig.daysOfWeek.length > 0 &&
      !scheduleConfig.daysOfWeek.includes(currentDayOfWeek)
    ) {
      return false;
    }

    // Check time window
    const currentHour = parseInt(hourFormatter.format(now), 10);
    let inWindow: boolean;
    if (scheduleConfig.startHour <= scheduleConfig.endHour) {
      inWindow =
        currentHour >= scheduleConfig.startHour &&
        currentHour < scheduleConfig.endHour;
    } else {
      // Wrap-around (e.g., startHour=22, endHour=6)
      inWindow =
        currentHour >= scheduleConfig.startHour ||
        currentHour < scheduleConfig.endHour;
    }

    if (!inWindow) return false;

    // Backlog drain is a reconciler, not a one-shot batch. It is safe to run
    // every scheduler tick because candidate selection subtracts active jobs
    // from each project's configured concurrency before creating new jobs.
    if (config.targetConfig?.backlogDrain?.enabled === true) {
      return true;
    }
    if (config.targetConfig?.dodRemediation?.enabled === true) {
      return true;
    }
    if (config.targetConfig?.dodReview?.enabled === true) {
      return true;
    }
    if (config.targetConfig?.releaseIntegration?.enabled === true) {
      return true;
    }

    // Cooldown check: skip if lastRunAt < 5 minutes ago
    const COOLDOWN_MS = 5 * 60 * 1000;
    if (config.lastRunAt) {
      const lastRun = new Date(config.lastRunAt);
      if (now.getTime() - lastRun.getTime() < COOLDOWN_MS) {
        return false;
      }
    }

    return true;
  }

  private async executeScheduledConfig(config: ScheduledAgentConfig): Promise<void> {
    console.log(
      `scheduled-configs: processing "${config.name}" (${config.id}) ` +
      `— jobType=${config.jobType}, project=${config.projectName ?? config.projectId ?? "all"}`
    );

    if (config.targetConfig?.backlogDrain?.enabled === true) {
      await this.executeBacklogDrainConfig(config);
      return;
    }

    if (config.targetConfig?.dodRemediation?.enabled === true) {
      await this.executeDodRemediationConfig(config);
      return;
    }

    if (config.targetConfig?.dodReview?.enabled === true) {
      await this.executeDefinitionOfDoneReviewConfig(config);
      return;
    }

    if (config.targetConfig?.releaseIntegration?.enabled === true) {
      await this.executeReleaseIntegrationConfig(config);
      return;
    }

    // Standalone scheduled jobs: no work item candidates needed
    if (config.jobType === "scheduled") {
      try {
        await this.workerClient.createJob({
          organizationId: config.organizationId,
          provider: config.provider,
          jobType: "scheduled",
          prompt: config.prompt ?? undefined,
          codingAgent: config.codingAgent ?? undefined,
          aiProvider: config.aiProvider ?? undefined,
          model: config.aiModel ?? undefined,
          reasoningLevel: config.reasoningLevel ?? undefined,
          config: {
            projectId: config.projectId ?? undefined,
            scheduledConfigId: config.id,
            scheduledConfigName: config.name,
            source: "scheduled-config",
            prompt: config.prompt ?? undefined,
            reasoningLevel: config.reasoningLevel ?? undefined,
            ...(config.mcpServers ? { mcpServers: config.mcpServers } : {}),
          },
        });
        console.log(`scheduled-configs: "${config.name}" — created standalone job`);
      } catch (error) {
        console.error(
          `scheduled-configs: failed to create standalone job for "${config.name}":`,
          error
        );
      }

      try {
        await this.workerClient.updateScheduledConfigLastRunAt(config.id);
      } catch (error) {
        console.error(
          `scheduled-configs: failed to update lastRunAt for "${config.name}":`,
          error
        );
      }
      return;
    }

    // === Candidate-based flow (validation, bug-fix, implementation, etc.) ===
    const inferredSkillName = resolveScheduledWorkItemSkillName(config.jobType);

    let candidateIds: string[] = [];

    if (config.jobType === "validation") {
      const candidates = await this.workerClient.getValidationCandidates({
        projectId: config.projectId ?? undefined,
        organizationId: config.organizationId,
        requireDodApproved: config.targetConfig?.requireDodApproved === true,
      });
      candidateIds = candidates.map((c) => c.id);
    } else if (config.jobType === "bug-fix") {
      const candidates = await this.workerClient.getFixCandidates({
        projectId: config.projectId ?? undefined,
        organizationId: config.organizationId,
      });
      candidateIds = candidates.map((c) => c.id);
    } else {
      // For other job types (implementation, planning, review, etc.),
      // use validation candidates as a general source of work items
      const candidates = await this.workerClient.getValidationCandidates({
        projectId: config.projectId ?? undefined,
        organizationId: config.organizationId,
      });
      candidateIds = candidates.map((c) => c.id);
    }

    if (candidateIds.length === 0) {
      console.log(`scheduled-configs: "${config.name}" — no candidates found`);
      return;
    }

    // Create jobs up to maxJobsPerRun
    const limit = Math.min(candidateIds.length, config.maxJobsPerRun);
    let created = 0;

    for (let i = 0; i < limit; i++) {
      try {
        await this.workerClient.createJob({
          workItemId: candidateIds[i]!,
          provider: config.provider,
          jobType: config.jobType as "implementation" | "planning" | "review" | "validation" | "bug-fix" | "prewarm",
          codingAgent: config.codingAgent ?? undefined,
          aiProvider: config.aiProvider ?? undefined,
          model: config.aiModel ?? undefined,
          reasoningLevel: config.reasoningLevel ?? undefined,
          config: {
            projectId: config.projectId ?? undefined,
            scheduledConfigId: config.id,
            scheduledConfigName: config.name,
            skillName: inferredSkillName,
            source: "scheduled-config",
            reasoningLevel: config.reasoningLevel ?? undefined,
            ...(config.mcpServers ? { mcpServers: config.mcpServers } : {}),
          },
        });
        created++;
      } catch (error) {
        console.error(
          `scheduled-configs: failed to create job for work item ${candidateIds[i]}:`,
          error
        );
      }
    }

    console.log(
      `scheduled-configs: "${config.name}" — ${candidateIds.length} candidates, created ${created} jobs`
    );

    // Update lastRunAt
    try {
      await this.workerClient.updateScheduledConfigLastRunAt(config.id);
    } catch (error) {
      console.error(
        `scheduled-configs: failed to update lastRunAt for "${config.name}":`,
        error
      );
    }
  }

  private async executeBacklogDrainConfig(config: ScheduledAgentConfig): Promise<void> {
    try {
      const result = await this.workerClient.getBacklogDrainCandidates({ configId: config.id });
      if (result.candidates.length === 0) {
        console.log(
          `scheduled-configs: "${config.name}" — no ready backlog candidates ` +
          `(blocked=${result.skipped.blocked.length}, excluded=${result.skipped.excluded.length}, ` +
          `active=${result.skipped.active.length}, concurrency=${result.skipped.concurrency.length}, ` +
          `recentlyModified=${result.skipped.recentlyModified?.length ?? 0})`
        );
        await this.workerClient.updateScheduledConfigLastRunAt(config.id);
        return;
      }

      const limit = Math.min(result.candidates.length, config.maxJobsPerRun);
      let created = 0;

      for (const candidate of result.candidates.slice(0, limit)) {
        try {
          await this.workerClient.createJob({
            workItemId: candidate.id,
            provider: candidate.provider,
            jobType: "implementation",
            codingAgent: candidate.codingAgent,
            aiProvider: candidate.aiProvider,
            model: candidate.model,
            reasoningLevel: candidate.reasoningLevel ?? undefined,
            config: {
              projectId: candidate.projectId,
              scheduledConfigId: config.id,
              scheduledConfigName: config.name,
              skillName: "runner-implement",
              source: "backlog-drain",
              reasoningLevel: candidate.reasoningLevel ?? undefined,
              ...(config.mcpServers ? { mcpServers: config.mcpServers } : {}),
            },
          });
          created++;
        } catch (error) {
          console.error(
            `scheduled-configs: backlog-drain failed to create job for work item ${candidate.id}:`,
            error
          );
        }
      }

      console.log(
        `scheduled-configs: "${config.name}" — backlog-drain selected ${result.candidates.length}, created ${created}`
      );
      await this.workerClient.updateScheduledConfigLastRunAt(config.id);
    } catch (error) {
      console.error(`scheduled-configs: backlog-drain failed for "${config.name}":`, error);
    }
  }

  private async executeDodRemediationConfig(config: ScheduledAgentConfig): Promise<void> {
    try {
      const result = await this.workerClient.getDodRemediationCandidates({ configId: config.id });
      if (result.candidates.length === 0) {
        console.log(
          `scheduled-configs: "${config.name}" — no ready DoD remediation candidates ` +
          `(blocked=${result.skipped.blocked.length}, excluded=${result.skipped.excluded.length}, ` +
          `active=${result.skipped.active.length}, concurrency=${result.skipped.concurrency.length}, ` +
          `recentlyModified=${result.skipped.recentlyModified?.length ?? 0}, ` +
          `missingReport=${result.skipped.missingDodReport?.length ?? 0})`
        );
        await this.workerClient.updateScheduledConfigLastRunAt(config.id);
        return;
      }

      const limit = Math.min(result.candidates.length, config.maxJobsPerRun);
      let created = 0;

      for (const candidate of result.candidates.slice(0, limit)) {
        const skillName = candidate.skillName ?? "runner-fix-dod";
        try {
          await this.workerClient.createJob({
            workItemId: candidate.id,
            provider: candidate.provider,
            jobType: "implementation",
            codingAgent: candidate.codingAgent,
            aiProvider: candidate.aiProvider,
            model: candidate.model,
            reasoningLevel: candidate.reasoningLevel ?? undefined,
            config: {
              projectId: candidate.projectId,
              scheduledConfigId: config.id,
              scheduledConfigName: config.name,
              skillName,
              source: "dod-remediation",
              dodReport: candidate.dodReport ?? undefined,
              dodReviewedAt: candidate.dodReviewedAt ?? undefined,
              reasoningLevel: candidate.reasoningLevel ?? undefined,
              ...(config.mcpServers ? { mcpServers: config.mcpServers } : {}),
            },
          });
          created++;
        } catch (error) {
          console.error(
            `scheduled-configs: DoD remediation failed to create job for work item ${candidate.id}:`,
            error
          );
        }
      }

      console.log(
        `scheduled-configs: "${config.name}" — DoD remediation selected ${result.candidates.length}, created ${created}`
      );
      await this.workerClient.updateScheduledConfigLastRunAt(config.id);
    } catch (error) {
      console.error(`scheduled-configs: DoD remediation failed for "${config.name}":`, error);
    }
  }

  private async reconcileOnStartup(): Promise<void> {
    try {
      const url = `${this.config.apiUrl}/workers/jobs/mine?workerId=${encodeURIComponent(this.config.workerId)}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
      });
      if (!res.ok) {
        console.log("reconciliation: could not fetch running jobs, starting clean");
        return;
      }
      const body = (await res.json()) as { data?: Array<{ id: string; [key: string]: unknown }> };
      const myJobs = body.data ?? [];

      if (myJobs.length === 0) {
        console.log("reconciliation: no stale jobs found");
        return;
      }

      console.log(`reconciliation: found ${myJobs.length} running job(s) from previous session`);

      for (const job of myJobs) {
        // Check if the container for this job still exists and is running
        const containerId = await this.findContainerForJob(job.id);
        if (containerId) {
          console.log(`reconciliation: re-adopting job ${job.id} with live container ${containerId.slice(0, 12)}`);
          // Re-adopt: track in activeJobs so availableSlots is correct and
          // the heartbeat reports accurate counts.
          const reAdoptedJob = job as ClaimedJob;
          this.activeJobMeta.set(job.id, reAdoptedJob);
          this.jobMemoryMap.set(
            job.id,
            resolveJobMemoryRequirement(reAdoptedJob).memoryMb,
          );
          const monitor = this.monitorOrphanedContainer(job.id)
            .catch((err) => {
              console.error(`reconciliation: monitor failed for ${job.id}:`, err);
            })
            .finally(() => {
              this.activeJobs.delete(job.id);
              this.activeJobMeta.delete(job.id);
              this.jobMemoryMap.delete(job.id);
              this.checkDrainComplete();
            });
          this.activeJobs.set(job.id, monitor);
        } else {
          console.log(`reconciliation: job ${job.id} has no container, marking as failed`);
          try {
            const statusUrl = `${this.config.apiUrl}/workers/jobs/${job.id}/status`;
            await fetch(statusUrl, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${this.config.apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                status: "failed",
                errorMessage: "Runner crashed — container lost during restart",
                errorType: "runner_crash_recovery",
              }),
            });
          } catch (err) {
            console.error(`reconciliation: failed to mark job ${job.id} as failed:`, err);
          }
        }
      }
    } catch (error) {
      console.error("reconciliation failed, continuing with clean state:", error);
    }
  }

  private async findContainerForJob(jobId: string): Promise<string | null> {
    try {
      const containers = await this.containerManager.listManagedContainers();
      const match = containers.find(
        (c) => c.labels["job-id"] === jobId && c.state === "running"
      );
      return match?.id ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Polls until the container for an orphaned job stops running.
   * Used by reconcileOnStartup to track jobs from a previous session.
   */
  private async monitorOrphanedContainer(jobId: string): Promise<void> {
    while (this.running) {
      await new Promise<void>((r) => setTimeout(r, 30_000));
      const containerId = await this.findContainerForJob(jobId);
      if (!containerId) {
        console.log(`reconciliation: orphaned job ${jobId} container stopped`);
        return;
      }
    }
  }

  private async cleanupOrphans(): Promise<void> {
    if (!this.running) {
      return;
    }

    try {
      const cleanup = await this.containerManager.cleanupOrphanedContainers({
        activeJobIds: [...this.activeJobs.keys()],
        repositoryPath: this.config.repositoryPath,
      });
      await this.updateContainerHealth(cleanup);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.containerHealth = {
        status: "degraded",
        zombieSuspected: this.containerHealth.zombieSuspected,
        cleanupFailures: this.containerHealth.cleanupFailures + 1,
        lastCleanupAt: new Date().toISOString(),
        lastIssue: message,
      };
      console.error("runner orphan cleanup failed:", error);
    }
  }

  private async updateContainerHealth(cleanup: ContainerCleanupResult): Promise<void> {
    const anomalies = await this.containerManager.detectManagedContainerAnomalies();
    const zombieContainerIds = new Set<string>();
    for (const issue of cleanup.issues) {
      if (issue.zombieSuspected) zombieContainerIds.add(issue.containerId);
    }
    for (const anomaly of anomalies) {
      if (anomaly.zombieSuspected) zombieContainerIds.add(anomaly.containerId);
    }
    const zombieSuspected = zombieContainerIds.size;
    const cleanupFailures = cleanup.failed;
    const lastIssue = cleanup.issues.at(-1)?.message ?? anomalies.at(-1)?.message;

    this.containerHealth = {
      status: zombieSuspected > 0 || cleanupFailures > 0 ? "degraded" : "healthy",
      zombieSuspected,
      cleanupFailures,
      lastCleanupAt: new Date().toISOString(),
      ...(lastIssue ? { lastIssue } : {}),
    };

    if (this.containerHealth.status === "degraded") {
      console.warn(
        `[container-health] runner degraded: zombies=${zombieSuspected}, ` +
        `cleanupFailures=${cleanupFailures}${lastIssue ? `, lastIssue=${lastIssue}` : ""}`
      );
    }
  }

  private resolveTargetProjectIds(config: ScheduledAgentConfig): string[] {
    const scopedProjectIds = config.targetConfig?.projectIds ?? [];
    const projectIds = scopedProjectIds.length > 0
      ? scopedProjectIds
      : config.projectId
        ? [config.projectId]
        : [];

    return Array.from(new Set(projectIds.filter((projectId) => projectId.length > 0)));
  }

  private resolveProjectConcurrencyScopes(
    config: ScheduledAgentConfig,
    target: ProjectConcurrencyConfig | undefined,
  ): ProjectConcurrencyScope[] {
    const defaultMaxActive =
      finitePositiveInt(target?.defaultMaxConcurrentJobs) ?? DEFAULT_PROJECT_OPEN_TICKET_LIMIT;
    const rules = (target?.projects ?? [])
      .filter((rule) => rule.enabled !== false && typeof rule.projectId === "string" && rule.projectId.length > 0);

    if (rules.length > 0) {
      return rules.map((rule) => ({
        projectId: rule.projectId,
        maxActiveItems: finitePositiveInt(rule.maxConcurrentJobs) ?? defaultMaxActive,
      }));
    }

    const projectIds = this.resolveTargetProjectIds(config);
    if (projectIds.length > 0) {
      return projectIds.map((projectId) => ({
        projectId,
        maxActiveItems: defaultMaxActive,
      }));
    }

    return [{ projectId: undefined, maxActiveItems: defaultMaxActive }];
  }

  private async executeDefinitionOfDoneReviewConfig(config: ScheduledAgentConfig): Promise<void> {
    try {
      const minAgeMinutes = resolveQuietPeriodMinutes(
        config.targetConfig?.dodReview?.minAgeMinutes,
      );

      const projectScopes = this.resolveProjectConcurrencyScopes(
        config,
        config.targetConfig?.dodReview,
      );
      const candidates: DefinitionOfDoneReviewCandidate[] = [];

      for (const scope of projectScopes) {
        const remaining = config.maxJobsPerRun - candidates.length;
        if (remaining <= 0) break;
        const requestLimit = Math.min(remaining, scope.maxActiveItems);

        const projectCandidates = await this.workerClient.getDodReviewCandidates({
          projectId: scope.projectId,
          organizationId: config.organizationId,
          limit: requestLimit,
          maxActiveJobs: scope.maxActiveItems,
          minAgeMinutes,
        });
        candidates.push(...projectCandidates);
      }

      if (candidates.length === 0) {
        console.log(
          `scheduled-configs: "${config.name}" — no Definition of Done review candidates`
        );
        await this.workerClient.updateScheduledConfigLastRunAt(config.id);
        return;
      }

      const limit = Math.min(candidates.length, config.maxJobsPerRun);
      let created = 0;

      for (const candidate of candidates.slice(0, limit)) {
        try {
          await this.workerClient.createJob({
            workItemId: candidate.id,
            provider: config.provider,
            jobType: "review",
            codingAgent: config.codingAgent ?? undefined,
            aiProvider: config.aiProvider ?? undefined,
            model: config.aiModel ?? undefined,
            reasoningLevel: config.reasoningLevel ?? undefined,
            config: {
              projectId: candidate.projectId ?? config.projectId ?? undefined,
              scheduledConfigId: config.id,
              scheduledConfigName: config.name,
              skillName: "dod-review",
              source: "dod-review",
              workspaceIntent: "read-only",
              postSessionPushPolicy: "never",
              reasoningLevel: config.reasoningLevel ?? undefined,
              ...(config.mcpServers ? { mcpServers: config.mcpServers } : {}),
            },
          });
          created++;
        } catch (error) {
          console.error(
            `scheduled-configs: DoD review failed to create job for work item ${candidate.id}:`,
            error
          );
        }
      }

      console.log(
        `scheduled-configs: "${config.name}" — DoD review candidates=${candidates.length}, created=${created}`
      );
      await this.workerClient.updateScheduledConfigLastRunAt(config.id);
    } catch (error) {
      console.error(`scheduled-configs: DoD review failed for "${config.name}":`, error);
    }
  }

  private async executeReleaseIntegrationConfig(config: ScheduledAgentConfig): Promise<void> {
    try {
      const projectScopes = this.resolveProjectConcurrencyScopes(
        config,
        config.targetConfig?.releaseIntegration,
      );
      const minAgeMinutes = resolveQuietPeriodMinutes(
        config.targetConfig?.releaseIntegration?.minAgeMinutes,
      );
      let created = 0;
      let batchCount = 0;

      for (const scope of projectScopes) {
        const remaining = config.maxJobsPerRun - created;
        if (remaining <= 0) break;
        const requestLimit = Math.min(remaining, scope.maxActiveItems);

        const result = await this.workerClient.queueReleaseIntegration({
          projectId: scope.projectId,
          organizationId: config.organizationId,
          limit: requestLimit,
          maxActiveItems: scope.maxActiveItems,
          minAgeMinutes,
        });

        created += result.batches.reduce(
          (sum, batch) => sum + batch.enqueuedItemCount,
          0,
        );
        batchCount += result.batches.length;
      }

      console.log(
        `scheduled-configs: "${config.name}" — release integration enqueued ${created} items ` +
        `across ${batchCount} batch(es)`
      );
      await this.workerClient.updateScheduledConfigLastRunAt(config.id);
    } catch (error) {
      console.error(`scheduled-configs: release integration failed for "${config.name}":`, error);
    }
  }
}

export const createRunnerOrchestrator = (
  config: RunnerOrchestratorConfig,
  deps: RunnerOrchestratorDeps
): RunnerOrchestrator => {
  return new RunnerOrchestrator(config, deps);
};
