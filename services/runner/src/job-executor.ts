import {
  createDiscordChannelAdapter,
  type AlmirantWorkerClient,
  type ClaimedJob,
  type WorkItemDetails,
  type OpenCodeSessionManager,
} from "@almirant/remote-agent";
import {
  createStreamPublisher,
  type StreamPublisher,
} from "@almirant/stream-consumer";
import {
  nextSequence,
  publishStreamEvent,
  publishCanonicalEvent,
  publishJobStarted,
} from "./session/stream-events";
import { createDiscordThreadWithRetry } from "./session/discord-thread";
import { buildInjectedEnv, resolveRuntimeConfig } from "./workspace/config-injector";
import {
  assertRunnableAgentWorkspace,
  getExplicitWorkspaceKind,
  resolveAgentWorkspace,
  toRepositoryOverride,
  withGitWorkspaceRef,
  type ProjectRepository,
  type RepositoryOverride,
  type RunnableAgentWorkspace,
} from "./workspace/agent-workspace";
import { provisionUploadedFilesWorkspace } from "./workspace/uploaded-files-provisioner";
import type { ContainerDriver } from "./workspace/container-driver";
import {
  UUID_RE,
  OPENCODE_SERVE_PORT,
  WORKSPACE_REPO_PATH,
  CONTAINER_USER,
  isWorkspaceBindMountError,
  buildContainerSpec,
} from "./workspace/container-spec-builder";
import {
  setupValidateEnvironment,
  teardownValidateEnvironment,
  waitForServeReady,
} from "./workspace/validate-environment";
import { createCheckpointManager } from "./delivery/checkpoint-manager";
import type { PlatformInjectionResult } from "./workspace/platform-injector";
import { createPlatformInjector } from "./workspace/platform-injector";
import type {
  JobExecutionResult,
  RunnerContainerSpec,
  RuntimeConfig,
  RuntimeExecutor,
  RuntimeExecutorRegistry,
  ValidateEnvironment,
} from "./shared/types";
import { classifyError } from "./shared/types";
import { createRunnerJobEventLogger } from "./observability/job-event-logger";
import type { RunnerJobEventLogger } from "./observability/job-event-logger";
import { logTmpfsUsage } from "./observability/resource-monitor";
// computeOverallTimeout, DEFAULT_OVERALL_TIMEOUT_MS, DEFAULT_EFFORT_POINT_DURATION_MS
// moved to session/event-consumer.ts
import { buildCredentialHelperScript, buildAskpassScript, shouldRefreshToken, TOKEN_REFRESH_INTERVAL_MS } from "./shared/token-refresh";

import {
  createBranchAndDraftPr,
  type CreateBranchAndDraftPrResult,
} from "./delivery/pr-manager";
import {
  extractBranchName,
  executePushPipeline,
  releasePrimarySession,
} from "./delivery/push-pipeline";
import { evaluateCompletion } from "./orchestration/completion-evaluator";
import { shouldPreparePrFirstFlow } from "./orchestration/pr-first-flow";
import {
  resolveReviewTargetBranch,
  shouldUseWorkItemReviewBranch,
} from "./orchestration/review-target-branch";
import { scanRepoForSkillsInContainer } from "./skills/skill-scanner";
// augmentSkillContentForRuntime moved to session/session-runner.ts
import {
  resolveWorkItem as resolveWorkItemFn,
  augmentWorkspaceSkillForRuntime as augmentWorkspaceSkillForRuntimeFn,
  resolveSkillFromDb as resolveSkillFromDbFn,
  type SkillResolverDeps,
} from "./skills/skill-resolver";
import {
  resolvePostSessionPushPolicy,
  templateLabel,
  type SkillResources,
} from "./orchestration/job-intent";
import { mkdir, rm, chown } from "node:fs/promises";
import { join } from "node:path";
import { emitJobTelemetry, captureError, setJobScope } from "./observability/telemetry";
import {
  retryUpdateJobStatus,
  normalizeJobConfig,
  getRequestedModel,
  resolveJobCodingAgent,
  extractRepositoryName,
} from "./shared/job-helpers";
import { DEFAULT_PRE_SESSION_TIMEOUT_MS } from "./shared/timeout";
import type { QuotaPauseRequest } from "./shared/quota-pause";
import { runWithPreSessionWatchdog } from "./orchestration/pre-session-watchdog";

// skillLabel removed — replaced by templateLabel() from job-intent.ts

// Session-related constants and functions extracted to ./session/session-runner.ts
// and ./session/event-consumer.ts
import { runServeSession as runServeSessionFn } from "./session/session-runner";

type JobExecutorConfig = {
  workerId: string;
  opencodeImage: string;
  claudeShimImage: string;
  codexShimImage: string;
  opencodeCommand?: string;
  repositoryPath?: string;
  /** Host-side path equivalent of repositoryPath, used for Docker volume mounts to sibling containers. */
  reposHostPath?: string;
  /** Almirant API base URL (e.g. http://localhost:3001). Used for PR creation. */
  apiBaseUrl?: string;
  /** Almirant API key. Used for authenticated requests (PR creation, etc.). */
  apiKey?: string;
  redis?: {
    url: string;
    queueName?: string;
  };
  discord?: {
    botToken: string;
    channelId: string;
  };
  checkpoint?: {
    s3: {
      accessKey: string;
      secretKey: string;
      region: string;
      bucket: string;
      endpoint?: string;
    };
    intervalMs: number;
  };
  /** Base overall timeout in ms (default: 3h). */
  overallTimeoutMs?: number;
  /** Duration in ms per effort point for dynamic timeout scaling. */
  effortPointDurationMs?: number;
  /** Timeout for guarded startup phases after serve readiness and before session execution. */
  preSessionTimeoutMs?: number;
  /** Enable publishing web output events to the Redis Stream for planning jobs. */
  webOutputEnabled?: boolean;
  /** Path to baked platform config (skills, CLAUDE.md, AGENTS.md). Used to read SKILL.md for Codex. */
  platformConfigPath?: string;
};

type JobExecutorDeps = {
  workerClient: AlmirantWorkerClient;
  containerManager: ContainerDriver;
  platformInjector?: ReturnType<typeof createPlatformInjector>;
  runtimeExecutorRegistry: RuntimeExecutorRegistry;
};

type SessionExecutionResult = {
  success: boolean;
  summary?: string;
  errorMessage?: string;
  cancelledByUser?: boolean;
  shutdownRequested?: boolean;
  timedOut?: boolean;
  backgroundAgentTimedOut?: boolean;
  sessionId: string;
  inputTokens?: number;
  outputTokens?: number;
  tokensUsed?: number;
  completionState?: "complete" | "incomplete" | "failed";
  incompleteReason?: string;
  missingWorkItemIds?: string[];
  pausedForQuota?: QuotaPauseRequest;
};

// ---------------------------------------------------------------------------
// Execution context — mutable state bag threaded through pipeline phases
// ---------------------------------------------------------------------------

type JobExecutionContext = {
  job: ClaimedJob;
  orgId: string;
  startedAtMs: number;
  initialJobConfig: Record<string, unknown>;
  jobConfig: Record<string, unknown>;
  jobLocale: string;
  humanTaskId: string;
  eventLogger: RunnerJobEventLogger;
  streamPublisher?: StreamPublisher;
  threadId?: string;
  webSessionId?: string;
  webWorkspaceId?: string;
  containerId: string | null;
  containerServeBaseUrl: string | null;
  extractedBranchName: string | null;
  cancelledByUser: boolean;
  oomAlreadyDetected: boolean;
  jobWorkspacePath: string | null;
  workspaceMountMode: "bind" | "tmpfs";
  heartbeatInterval?: ReturnType<typeof setInterval>;
  checkpointInterval?: ReturnType<typeof setInterval>;
  tokenRefreshInterval?: ReturnType<typeof setInterval>;
  shutdownRequestedByUser: boolean;
  checkpointManager: ReturnType<typeof createCheckpointManager>;
  // Resolved during execution:
  workItem?: WorkItemDetails | null;
  injectedEnv: Record<string, string>;
  openCodeConfig: Awaited<ReturnType<typeof buildInjectedEnv>>["openCodeConfig"];
  resolvedModel: string;
  runtimeConfig?: RuntimeConfig;
  runtimeExecutor?: RuntimeExecutor;
  repositoryOverride: RepositoryOverride;
  workspace: RunnableAgentWorkspace | null;
  skillName: string;
  prFirstResult: CreateBranchAndDraftPrResult | null;
  jobCodingAgent?: string;
  effectiveJobType: string;
};

// ---------------------------------------------------------------------------
// Skill tag resolution helper
// ---------------------------------------------------------------------------

/**
 * Resolves the skill tag for logging, telemetry, and thread labels.
 * Reads from the new-model top-level column (promptTemplate) first,
 * then legacy top-level skillName, then config.skillName, and finally
 * "prompt-only" for jobs that carry a freeform prompt but no skill identifier.
 */
const resolveSkillTag = (job: ClaimedJob, jobConfig: Record<string, unknown>): string => {
  const hasPrompt =
    (typeof job.prompt === "string" && job.prompt.trim().length > 0) ||
    (typeof jobConfig.prompt === "string" && jobConfig.prompt.trim().length > 0);

  return (
    job.promptTemplate ??
    job.skillName ??
    (typeof jobConfig.skillName === "string" ? jobConfig.skillName : null) ??
    (hasPrompt ? "prompt-only" : "unknown")
  );
};

const shouldReplaceDefaultIntegrationSkill = (value: unknown): boolean => {
  if (typeof value !== "string") return true;
  const normalized = value.trim().toLowerCase();
  return normalized === "" || normalized === "implement" || normalized === "integration";
};

const isPhaseTimeoutError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: unknown }).code === "phase_timeout";

// ---------------------------------------------------------------------------
// JobExecutor
// ---------------------------------------------------------------------------

export type JobExecutor = {
  execute: (job: ClaimedJob) => Promise<JobExecutionResult>;
  setupValidateEnvironment: (jobId: string, repoPath: string) => Promise<ValidateEnvironment>;
  teardownValidateEnvironment: (env: ValidateEnvironment) => Promise<void>;
  injectedSkillPaths: string[];
};

export const createJobExecutor = (
  config: JobExecutorConfig,
  deps: JobExecutorDeps,
): JobExecutor => {
  let injectedSkillPaths: string[] = [];

  const workerClient = deps.workerClient;
  const containerManager = deps.containerManager;
  const platformInjector = deps.platformInjector;
  const runtimeExecutorRegistry = deps.runtimeExecutorRegistry;

  const skillResolverDeps: SkillResolverDeps = {
    workerClient,
    containerManager,
    apiBaseUrl: config.apiBaseUrl,
    apiKey: config.apiKey,
  };

  const augmentWorkspaceSkillForRuntime = async (params: {
    containerId: string;
    skillName: string;
    runtimeType: string;
    eventLogger: RunnerJobEventLogger;
  }): Promise<void> => {
    return augmentWorkspaceSkillForRuntimeFn(skillResolverDeps, params);
  };

  const getPreSessionTimeoutMs = (): number =>
    config.preSessionTimeoutMs ?? DEFAULT_PRE_SESSION_TIMEOUT_MS;

  const runPreSessionGuarded = async <T>(
    ctx: JobExecutionContext,
    phase: string,
    operation: () => Promise<T>,
  ): Promise<T> => {
    const timeoutMs = getPreSessionTimeoutMs();

    ctx.eventLogger.info("startup", "startup.pre_session_started", "Pre-session guarded phase started", {
      phase,
      timeoutMs,
    });

    return runWithPreSessionWatchdog(
      {
        phase,
        timeoutMs,
        pollIntervalMs: Math.min(5_000, Math.max(1_000, Math.floor(timeoutMs / 10))),
        getJobStatus: () => workerClient.getJobStatus(ctx.job.id),
        onTimeout: (error) => {
          ctx.eventLogger.error("startup", "startup.pre_session_timeout", "Pre-session phase timed out", {
            phase: error.phase,
            timeoutMs: error.timeoutMs,
            containerId: ctx.containerId,
            baseUrl: ctx.containerServeBaseUrl,
          });
        },
        onCancelled: (error) => {
          ctx.cancelledByUser = true;
          ctx.shutdownRequestedByUser = error.shutdownRequested;
          ctx.eventLogger.warn("startup", "startup.pre_session_cancelled", "Pre-session phase cancelled by backend", {
            phase: error.phase,
            shutdownRequested: error.shutdownRequested,
            containerId: ctx.containerId,
          });
        },
      },
      operation,
    );
  };

  // ---------------------------------------------------------------------------
  // execute() — orchestrator that delegates to named pipeline phases
  // ---------------------------------------------------------------------------

  const execute = async (job: ClaimedJob): Promise<JobExecutionResult> => {
    injectedSkillPaths = [];

    // Integration batch jobs are driven by the **Release Integration agent**:
    // a coding agent (Claude/Codex) running inside a regular job container,
    // following the `runner-release-integration` skill. It rebases each item
    // of the batch onto the integration branch, resolves conflicts using its
    // own intelligence, regenerates migrations, runs type-check, merges, and
    // ensures/refreshes/merges the release PR via MCP tools.
    //
    // To wire that, integration jobs go through the same execution path as
    // any other agent job — we just pre-configure the skill, the workspace
    // branch and the agent-facing env so the standard flow does the right
    // thing without a special case.
    if (job.jobType === "integration") {
      const cfg = (job.config ?? {}) as {
        batchId?: string;
        integrationPhase?: "process" | "merge";
        repositoryId?: string;
        baseBranch?: string;
      } & Record<string, unknown>;

      if (!cfg.batchId) {
        return {
          jobId: job.id,
          success: false,
          errorMessage: "integration job missing batchId in config",
        };
      }

      // Default the skill so the agent knows what playbook to follow. Any
      // explicit override on the job (e.g. for one-off experiments) wins.
      const mutableJob = job as ClaimedJob & {
        skillName?: string | null;
        promptTemplate?: string | null;
      };
      if (shouldReplaceDefaultIntegrationSkill(mutableJob.skillName)) {
        mutableJob.skillName = "runner-release-integration";
      }
      if (shouldReplaceDefaultIntegrationSkill(mutableJob.promptTemplate)) {
        mutableJob.promptTemplate = "runner-release-integration";
      }

      // The standard flow creates a per-task draft PR via PR-first; the
      // release flow has its own long-lived PR managed by the agent + MCP
      // tools, so we opt out explicitly.
      cfg.selfManagesPr = true;
      // Tell the agent which phase + batch to drive via env vars (the agent
      // also calls `get_integration_batch` for the full snapshot).
      cfg.env = {
        ...((cfg.env as Record<string, string> | undefined) ?? {}),
        ALMIRANT_BATCH_ID: cfg.batchId,
        ALMIRANT_INTEGRATION_PHASE: cfg.integrationPhase ?? "process",
      };
      cfg.skillName = "runner-release-integration";
      job.config = cfg;
    }

    const ctx = initializeContext(job);

    try {
      await claimAndResolve(ctx);
      await preparePrFirstFlow(ctx);
      await prepareContainer(ctx);
      setupIntervals(ctx);

      if (ctx.initialJobConfig.isPrewarm === true) {
        const prewarmResult = await handlePrewarm(ctx);
        if (prewarmResult) return prewarmResult;
      }

      const result = await executeSession(ctx);
      return await handlePostSession(ctx, result);
    } catch (error) {
      return await handleExecutionError(ctx, error);
    } finally {
      await cleanupExecution(ctx);
    }
  };


  // ---------------------------------------------------------------------------
  // Phase 1: Initialize context — create loggers, resolve metadata
  // ---------------------------------------------------------------------------

  const initializeContext = (job: ClaimedJob): JobExecutionContext => {
    const initialJobConfig = normalizeJobConfig(job);
    const jobLocale = typeof initialJobConfig.locale === 'string' ? initialJobConfig.locale : 'es';
    const humanTaskId: string =
      typeof initialJobConfig.taskId === "string"
        ? initialJobConfig.taskId
        : job.id.slice(0, 8);
    const eventLogger = createRunnerJobEventLogger({
      jobId: job.id,
      workerClient,
      debugEnabled: initialJobConfig.debugLogging === true,
      seqOffset: (job.retryCount ?? 0) * 10_000,
    });

    const threadId =
      typeof initialJobConfig.threadId === "string"
        ? initialJobConfig.threadId
        : undefined;

    let streamPublisher: StreamPublisher | undefined;
    if (config.redis?.url) {
      streamPublisher = createStreamPublisher({
        redisUrl: config.redis.url,
      });
    }

    const webSessionId =
      typeof initialJobConfig.planningSessionId === "string"
        ? initialJobConfig.planningSessionId
        : undefined;
    const webWorkspaceId = job.workspaceId ?? undefined;

    eventLogger.info("claim", "job.claimed", "Job claimed by runner", {
      workerId: config.workerId,
      provider: job.provider,
      jobType: job.jobType ?? "implementation",
      priority: job.priority,
      threadId: threadId ?? null,
    });

    return {
      job,
      orgId: job.workspaceId ?? job.id,
      startedAtMs: Date.now(),
      initialJobConfig,
      jobConfig: normalizeJobConfig(job),
      jobLocale,
      humanTaskId,
      eventLogger,
      streamPublisher,
      threadId,
      webSessionId,
      webWorkspaceId,
      containerId: null,
      containerServeBaseUrl: null,
      extractedBranchName: null,
      cancelledByUser: false,
      oomAlreadyDetected: false,
      jobWorkspacePath: null,
      workspaceMountMode: config.reposHostPath ? "bind" : "tmpfs",
      shutdownRequestedByUser: false,
      checkpointManager: createCheckpointManager(config.checkpoint, containerManager),
      injectedEnv: {},
      openCodeConfig: {} as Awaited<ReturnType<typeof buildInjectedEnv>>["openCodeConfig"],
      resolvedModel: "",
      repositoryOverride: {},
      workspace: null,
      skillName: resolveSkillTag(job, initialJobConfig),
      prFirstResult: null,
      effectiveJobType: job.jobType ?? "implementation",
    };
  };

  // ---------------------------------------------------------------------------
  // Phase 2: Claim job, resolve work item, repository, env, runtime config
  // ---------------------------------------------------------------------------

  const claimAndResolve = async (ctx: JobExecutionContext): Promise<void> => {
    const { job, eventLogger } = ctx;

    const workItem = await resolveWorkItem(job);
    ctx.workItem = workItem;

    // Refine humanTaskId as soon as the work item is available so any
    // auto-created Discord thread uses the canonical task identifier.
    if (workItem?.taskId) {
      ctx.humanTaskId = workItem.taskId;
    }

    await workerClient.updateJobStatus(job.id, {
      status: "running",
      workerId: config.workerId,
    });

    // Set Sentry scope for this job
    setJobScope({
      "job.id": job.id,
      "job.type": job.jobType ?? "unknown",
      "job.skill": resolveSkillTag(job, ctx.initialJobConfig),
      "runner.worker_id": config.workerId,
    });
    eventLogger.info("claim", "job.running", "Job status moved to running");

    if (!ctx.threadId && config.discord) {
      try {
        const adapter = createDiscordChannelAdapter({
          botToken: config.discord.botToken,
        });
        const earlySkill = ctx.initialJobConfig.isPrewarm === true ? "prewarm" : resolveSkillTag(job, ctx.initialJobConfig);
        const { emoji: startEmoji, text: startSkill } = templateLabel(earlySkill, "gerund", ctx.jobLocale);
        const thread = await createDiscordThreadWithRetry({
          adapter,
          channelId: config.discord.channelId,
          name: `${startEmoji} ${startSkill} ${ctx.humanTaskId}`,
          jobId: job.id,
        });
        ctx.threadId = thread.id;
        console.log(`[job:${job.id}] Auto-created Discord thread ${ctx.threadId}`);
      } catch (error) {
        console.warn(
          `[job:${job.id}] Failed to auto-create Discord thread: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Emit job.started as the FIRST canonical event of every attempt (initial
    // and resumed). The web-bridge consumer uses it to reset its per-job dedup
    // high-water mark, so a resumed attempt on a fresh ephemeral runner — whose
    // producer sequence restarts low after a quota pause or pre-session-timeout
    // retry — is not silently dropped.
    await publishJobStarted(ctx.streamPublisher, {
      jobId: job.id,
      sessionId: ctx.webSessionId ?? "",
      organizationId: ctx.webOrganizationId ?? "",
      threadId: ctx.threadId ?? "",
    });

    await publishCanonicalEvent(ctx.streamPublisher, {
      jobId: job.id,
      sessionId: ctx.webSessionId ?? "",
      workspaceId: ctx.webWorkspaceId ?? "",
      threadId: ctx.threadId ?? "",
      timestamp: Date.now(),
      sequenceNumber: nextSequence(),
      event: { kind: "system.info", message: `Runner claimed ${ctx.humanTaskId}. Preparing workspace...` },
    });

    const { jobConfig } = ctx;

    ctx.effectiveJobType = job.jobType ?? "implementation";

    const explicitWorkspaceKind = getExplicitWorkspaceKind(jobConfig);
    const rawWorkspace =
      typeof jobConfig.workspace === "object" && jobConfig.workspace !== null && !Array.isArray(jobConfig.workspace)
        ? (jobConfig.workspace as Record<string, unknown>)
        : null;
    const explicitWorkspaceHasRepoUrl =
      typeof rawWorkspace?.repoUrl === "string" && rawWorkspace.repoUrl.trim().length > 0;
    const hasLegacyRepositoryUrl =
      (typeof jobConfig.repoUrl === "string" && jobConfig.repoUrl.trim().length > 0) ||
      (typeof jobConfig.repositoryUrl === "string" && jobConfig.repositoryUrl.trim().length > 0);
    const nonProjectWorkspaceKinds = new Set([
      "empty_workspace",
      "uploaded_files",
      "mounted_volume",
      "memory_only",
    ]);

    let projectRepository: ProjectRepository | undefined;
    const shouldResolveProjectRepository =
      Boolean(job.projectId) &&
      !hasLegacyRepositoryUrl &&
      !(explicitWorkspaceKind === "git_repo" && explicitWorkspaceHasRepoUrl) &&
      !nonProjectWorkspaceKinds.has(explicitWorkspaceKind ?? "");

    if (shouldResolveProjectRepository && job.projectId) {
      try {
        const repoConfig = await workerClient.getRepoConfig(job.projectId);
        projectRepository = {
          repositoryId: repoConfig.repositoryId,
          url: repoConfig.url,
          branch: repoConfig.branch,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        eventLogger.error("config", "repo.resolution_failed", `Failed to resolve repo for project ${job.projectId}: ${msg}`);
      }
    }

    ctx.workspace = assertRunnableAgentWorkspace(
      resolveAgentWorkspace({
        job,
        jobConfig,
        projectRepository,
      }),
    );
    ctx.repositoryOverride = toRepositoryOverride(ctx.workspace);

    if (ctx.workspace.kind === "empty_workspace") {
      eventLogger.info("config", "repo.skipped", `No repository for project ${job.projectId ?? "unknown"} — proceeding with empty workspace (${ctx.effectiveJobType} job)`);
    }

    if (
      ctx.repositoryOverride.url &&
      shouldUseWorkItemReviewBranch({
        jobType: ctx.effectiveJobType,
        skillName: ctx.skillName,
        source: jobConfig.source,
        workspaceIntent: jobConfig.workspaceIntent,
      })
    ) {
      const reviewBranch = resolveReviewTargetBranch({
        workItem,
        fallbackBranch: ctx.repositoryOverride.branch ?? "main",
      });

      ctx.workspace = withGitWorkspaceRef(ctx.workspace!, reviewBranch.branch);
      ctx.repositoryOverride = toRepositoryOverride(ctx.workspace);
      ctx.jobConfig = {
        ...ctx.jobConfig,
        reviewTargetBranch: reviewBranch.branch,
        reviewTargetBranchSource: reviewBranch.source,
        reviewTargetBranchReason: reviewBranch.reason,
      };

      eventLogger.info(
        "config",
        "repo.review_branch_resolved",
        reviewBranch.source === "pull-request"
          ? "Review job will analyze the work item's pull request branch"
          : "Review job will analyze the base repository branch",
        {
          branch: reviewBranch.branch,
          source: reviewBranch.source,
          reason: reviewBranch.reason,
          pullRequest: reviewBranch.pullRequest ?? null,
        },
      );
    }

    const { env: injectedEnv, openCodeConfig, resolvedModel, keyDebug } = await buildInjectedEnv({
      workerClient: workerClient,
      job,
      repository: ctx.repositoryOverride,
      apiBaseUrl: config.apiBaseUrl,
      model: getRequestedModel(job),
      requestSessionToken: config.apiBaseUrl && config.apiKey
        ? async (params) => {

            const url = `${config.apiBaseUrl!.replace(/\/+$/, "")}/workers/session-token`;
            const res = await fetch(url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${config.apiKey}`,
              },
              body: JSON.stringify({
                projectId: params.projectId,
                workspaceId: params.workspaceId,
                jobId: params.jobId,
                permissions: params.permissions ?? ["mcp:read", "mcp:write"],
                ttlSeconds: 7200, // 2 hours — covers most job durations
              }),
              signal: AbortSignal.timeout(10_000),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body = await res.json() as { data?: { token: string; expiresAt: string } };
            if (!body.data?.token) throw new Error("No token in response");
            return { token: body.data.token, expiresAt: body.data.expiresAt };
          }
        : undefined,
    });

    ctx.injectedEnv = injectedEnv;
    ctx.openCodeConfig = openCodeConfig;
    ctx.resolvedModel = resolvedModel;

    // Log provider key debug metadata for troubleshooting auth/rate-limit issues
    if (keyDebug) {
      eventLogger.info("config", "provider_key.resolved", "Provider key resolved for session", keyDebug);
    }

    // Update job with the actual resolved model (may differ from the requested model)
    try {
      await workerClient.updateJobStatus(job.id, {
        status: "running",
        model: resolvedModel,
      });
    } catch {
      // Non-critical — model metadata is best-effort
    }

    ctx.jobCodingAgent = resolveJobCodingAgent(job);
    ctx.runtimeExecutor = runtimeExecutorRegistry.resolve({
      provider: String(job.provider ?? ""),
      codingAgent: ctx.jobCodingAgent,
    });
    ctx.runtimeConfig = ctx.runtimeExecutor.resolveRuntimeConfig({
      opencodeImage: config.opencodeImage,
      claudeShimImage: config.claudeShimImage,
      codexShimImage: config.codexShimImage,
      servePort: OPENCODE_SERVE_PORT,
    });
    ctx.skillName =
      jobConfig.isPrewarm === true ? "prewarm" : resolveSkillTag(job, jobConfig);
  }

  // ---------------------------------------------------------------------------
  // Phase 3: PR-first flow — create branch + draft PR before agent starts
  // ---------------------------------------------------------------------------

  const preparePrFirstFlow = async (ctx: JobExecutionContext): Promise<void> => {
    const { job, injectedEnv, eventLogger } = ctx;

    const needsBranchAndPr = shouldPreparePrFirstFlow({
      jobType: ctx.effectiveJobType,
      interactive: job.interactive,
      skillName: job.skillName ?? null,
      promptTemplate: job.promptTemplate ?? null,
      isPrewarm: ctx.initialJobConfig.isPrewarm === true,
      repoUrl: injectedEnv.REPO_URL,
      config: ctx.jobConfig,
    });

    if (needsBranchAndPr) {
      try {
        ctx.prFirstResult = await createBranchAndDraftPr(
          { workerClient: workerClient, containerManager: containerManager },
          { apiBaseUrl: config.apiBaseUrl, apiKey: config.apiKey, workerId: config.workerId },
          {
            job,
            workItem: ctx.workItem ?? null,
            repositoryId: ctx.repositoryOverride.id,
            repoUrl: injectedEnv.REPO_URL,
            baseBranch: injectedEnv.REPO_BRANCH ?? "main",
            eventLogger,
          },
        );

        if (ctx.prFirstResult) {
          // Override the branch so the container clones the feature branch directly
          injectedEnv.REPO_BRANCH = ctx.prFirstResult.branchName;
          // Track the branch for final status update
          ctx.extractedBranchName = ctx.prFirstResult.branchName;
          // Expose PR metadata to the agent inside the container
          if (ctx.prFirstResult.prUrl) {
            injectedEnv.ALMIRANT_PR_URL = ctx.prFirstResult.prUrl;
          }
          if (ctx.prFirstResult.prNumber) {
            injectedEnv.ALMIRANT_PR_NUMBER = String(ctx.prFirstResult.prNumber);
          }

          if (ctx.streamPublisher) {
            const prLink = ctx.prFirstResult.prUrl
              ? ` — [PR](${ctx.prFirstResult.prUrl})`
              : "";
            await publishCanonicalEvent(ctx.streamPublisher, {
              jobId: job.id,
              sessionId: ctx.webSessionId ?? "",
              workspaceId: ctx.webWorkspaceId ?? "",
              threadId: ctx.threadId ?? "",
              timestamp: Date.now(),
              sequenceNumber: nextSequence(),
              event: { kind: "system.info", message: `Branch \`${ctx.prFirstResult.branchName}\` created${prLink}` },
            });
          }
        }
      } catch (error) {
        // PR-first failure is non-fatal — agent proceeds without it
        const errMsg = error instanceof Error ? error.message : String(error);
        console.warn(`[job:${job.id}] PR-first flow failed (non-fatal): ${errMsg}`);
        eventLogger.warn("pr", "pr.flow_failed", "PR-first flow failed (non-fatal)", {
          errorMessage: errMsg,
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Phase 4: Prepare container — workspace, image, start, inject config
  // ---------------------------------------------------------------------------

  const prepareContainer = async (ctx: JobExecutionContext): Promise<void> => {
    const { job, injectedEnv, eventLogger, runtimeConfig } = ctx;

    if (!runtimeConfig) throw new Error("runtimeConfig not resolved");

    const repositoryName = extractRepositoryName(injectedEnv.REPO_URL);

    eventLogger.info("context", "job.execution_context", "Resolved execution context", {
      workerId: config.workerId,
      repositoryId: ctx.repositoryOverride.id ?? null,
      repositoryName: repositoryName ?? null,
      repositoryUrl: injectedEnv.REPO_URL ?? null,
      workspaceKind: ctx.workspace?.kind ?? null,
      branch: injectedEnv.REPO_BRANCH ?? "main",
      runtimeType: runtimeConfig.type,
      runtimeImage: runtimeConfig.image,
      model: ctx.resolvedModel,
      configModel: ctx.openCodeConfig.model,
      provider: job.provider,
      skillName: ctx.skillName,
      jobType: job.jobType ?? "implementation",
      createdByUserId: job.createdByUserId ?? null,
      requesterDiscordUserId:
        typeof ctx.jobConfig.requesterDiscordUserId === "string"
          ? ctx.jobConfig.requesterDiscordUserId
          : null,
    });
    eventLogger.info(
      "workspace",
      "workspace.preparation_started",
      "Preparing isolated workspace inside container",
      {
        repositoryName: repositoryName ?? null,
        workspaceKind: ctx.workspace?.kind ?? null,
        branch: injectedEnv.REPO_BRANCH ?? "main",
        workspacePath: WORKSPACE_REPO_PATH,
        runtimeType: runtimeConfig.type,
        isolation: {
          user: CONTAINER_USER,
          readOnlyRootFs: true,
          tmpfsPaths: ctx.workspaceMountMode === "tmpfs"
            ? ["/tmp", "/home/opencode", "/workspace"]
            : ["/tmp", "/home/opencode"],
          diskBackedPaths: ctx.workspaceMountMode === "bind" ? ["/workspace"] : [],
          capDrop: ["ALL"],
        },
        workspaceMountMode: ctx.workspaceMountMode,
      }
    );
    if (ctx.workspace?.kind === "git_repo") {
      eventLogger.info("git", "git.clone_started", "Container will clone repository internally", {
        repositoryId: ctx.repositoryOverride.id ?? null,
        repositoryName: repositoryName ?? null,
        branch: injectedEnv.REPO_BRANCH ?? "main",
        workspacePath: WORKSPACE_REPO_PATH,
      });
    } else if (ctx.workspace?.kind === "uploaded_files") {
      eventLogger.info("workspace", "workspace.uploaded_files_started", "Container will start empty before uploaded files are materialized", {
        workspacePath: WORKSPACE_REPO_PATH,
        fileCount: ctx.workspace.fileIds.length,
        unpackMode: ctx.workspace.unpackMode ?? "flat",
      });
    } else {
      eventLogger.info("workspace", "workspace.empty_started", "Container will start with an empty workspace", {
        workspacePath: WORKSPACE_REPO_PATH,
      });
    }
    console.log(
      `[job:${job.id}] Preparing isolated ${ctx.workspace?.kind ?? "unknown"} workspace for ${repositoryName ?? "no repository"} on ${injectedEnv.REPO_BRANCH ?? "no branch"} using ${ctx.resolvedModel}`
    );

    // Pre-create the runner-local side of the bind mount. Only host-bind drivers
    // mount host directories (driver-managed workspaces provision their own
    // storage). Some dev Docker setups reject this path with EROFS; in that
    // case we fall back to a tmpfs workspace.
    if (
      containerManager.capabilities.workspace === "host-bind" &&
      ctx.workspaceMountMode === "bind" &&
      config.repositoryPath &&
      config.reposHostPath
    ) {
      if (!UUID_RE.test(job.id)) {
        throw new Error(`Invalid job ID format: ${job.id}`);
      }
      try {
        ctx.jobWorkspacePath = `${config.repositoryPath}/${job.id}`;
        await mkdir(ctx.jobWorkspacePath, { mode: 0o700, recursive: true });
        await chown(ctx.jobWorkspacePath, 1001, 1001);
        // Create disk-backed dirs for /tmp and /home/opencode (avoids tmpfs RAM overhead)
        const tmpPath = `${ctx.jobWorkspacePath}/.tmp`;
        const homePath = `${ctx.jobWorkspacePath}/.home`;
        await mkdir(tmpPath, { mode: 0o1777, recursive: true });
        await chown(tmpPath, 1001, 1001);
        await mkdir(homePath, { mode: 0o700, recursive: true });
        await chown(homePath, 1001, 1001);
      } catch (error) {
        if (!isWorkspaceBindMountError(error)) {
          throw error;
        }

        ctx.workspaceMountMode = "tmpfs";
        ctx.jobWorkspacePath = null;
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn(
          `[job:${job.id}] Workspace bind mount unavailable (${errorMessage}); falling back to tmpfs /workspace`,
        );
        eventLogger.warn(
          "workspace",
          "workspace.bind_fallback",
          "Workspace bind mount unavailable, falling back to tmpfs /workspace",
          { errorMessage },
        );
      }
    }

    let spec = buildContainerSpecForJob(
      job,
      ctx.workItem ?? null,
      runtimeConfig,
      injectedEnv,
      ctx.openCodeConfig,
      ctx.workspaceMountMode,
    );
    await containerManager.pullImage(spec.image);
    try {
      ctx.containerId = await containerManager.createContainer(job.id, spec);
    } catch (error) {
      if (ctx.workspaceMountMode !== "bind" || !isWorkspaceBindMountError(error)) {
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(
        `[job:${job.id}] Docker bind-mounted workspace failed (${errorMessage}); retrying with tmpfs /workspace`,
      );
      eventLogger.warn(
        "workspace",
        "workspace.bind_retry_tmpfs",
        "Docker bind-mounted workspace failed, retrying with tmpfs /workspace",
        { errorMessage },
      );
      ctx.workspaceMountMode = "tmpfs";
      ctx.jobWorkspacePath = null;
      spec = buildContainerSpecForJob(
        job,
        ctx.workItem ?? null,
        runtimeConfig,
        injectedEnv,
        ctx.openCodeConfig,
        ctx.workspaceMountMode,
      );
      ctx.containerId = await containerManager.createContainer(job.id, spec);
    }

    // Rename the thread to the canonical format on job start.
    if (ctx.streamPublisher) {
      const { emoji: renameEmoji, text: renameSkill } = templateLabel(ctx.skillName, "gerund", ctx.jobLocale);
      if (ctx.threadId) {
        const threadName = `${renameEmoji} ${renameSkill} ${ctx.humanTaskId}`;
        await publishCanonicalEvent(ctx.streamPublisher, {
          jobId: job.id,
          sessionId: ctx.webSessionId ?? "",
          workspaceId: ctx.webWorkspaceId ?? "",
          threadId: ctx.threadId,
          timestamp: Date.now(),
          sequenceNumber: nextSequence(),
          event: { kind: "system.info", message: "thread_rename", payload: { threadRename: true, name: threadName } },
        });

        // Send the thread opening embed with resolved model & branch info.
        const branch = injectedEnv.REPO_BRANCH ?? "main";
        const embedFields = [
          { name: "Model", value: ctx.resolvedModel, inline: true },
          { name: "Branch", value: branch, inline: true },
        ];
        if (ctx.prFirstResult?.prUrl) {
          embedFields.push({
            name: "PR",
            value: `[#${ctx.prFirstResult.prNumber}](${ctx.prFirstResult.prUrl})`,
            inline: true,
          });
        }
        await publishStreamEvent(ctx.streamPublisher, {
          type: "rich_message",
          jobId: job.id,
          threadId: ctx.threadId,
          sessionId: ctx.webSessionId ?? "",
          workspaceId: ctx.webWorkspaceId ?? "",
          payload: {
            embeds: [{
              title: "Remote Agent session started",
              description: `Skill: ${ctx.skillName}\nTasks: ${ctx.humanTaskId}`,
              color: 0x5865f2,
              fields: embedFields,
              timestamp: new Date().toISOString(),
            }],
          },
          timestamp: Date.now(),
        });
      }
      if (ctx.webSessionId && ctx.webWorkspaceId) {
        await publishCanonicalEvent(ctx.streamPublisher, {
          jobId: job.id,
          sessionId: ctx.webSessionId,
          workspaceId: ctx.webWorkspaceId,
          threadId: ctx.threadId ?? "",
          timestamp: Date.now(),
          sequenceNumber: nextSequence(),
          event: { kind: "agent.step", description: `Session started — Skill: ${ctx.skillName}, Tasks: ${ctx.humanTaskId}` },
        });
      }
    }

    // Connect sibling container to the runner's Docker network so they can communicate.
    const runnerNetwork =
      await containerManager.getRunnerNetworkName();
    if (runnerNetwork) {
      await containerManager.connectToNetwork(ctx.containerId, runnerNetwork);
    }

    // Start the container, which prepares the isolated workspace and then starts the runtime server.
    await containerManager.startContainer(ctx.containerId);

    // Get container IP for HTTP communication.
    const containerIp =
      await containerManager.getContainerIp(ctx.containerId, runnerNetwork ?? undefined);
    const baseUrl = `http://${containerIp}:${OPENCODE_SERVE_PORT}`;
    ctx.containerServeBaseUrl = baseUrl;

    console.log(
      `[job:${job.id}] Container started, serve URL: ${baseUrl}`
    );
    eventLogger.info("serve", "serve.starting", "Container started, waiting for serve", {
      baseUrl,
      workspacePath: WORKSPACE_REPO_PATH,
    });

    await publishCanonicalEvent(ctx.streamPublisher, {
      jobId: job.id,
      sessionId: ctx.webSessionId ?? "",
      workspaceId: ctx.webWorkspaceId ?? "",
      threadId: ctx.threadId ?? "",
      timestamp: Date.now(),
      sequenceNumber: nextSequence(),
      event: { kind: "system.info", message: "Container started. Preparing workspace and waiting for serve..." },
    });

    // Wait for serve to become healthy
    try {
      await waitForServeReadyFn(baseUrl);
    } catch (error) {
      eventLogger.error("serve", "serve.failed", "Serve readiness failed", {
        baseUrl,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    console.log(`[job:${job.id}] Serve is ready`);
    if (ctx.workspace?.kind === "git_repo") {
      eventLogger.info("git", "git.clone_completed", "Repository clone completed inside container", {
        repositoryName: repositoryName ?? null,
        branch: injectedEnv.REPO_BRANCH ?? "main",
        workspacePath: WORKSPACE_REPO_PATH,
      });
    }

    if (ctx.workspace?.kind === "uploaded_files" && ctx.containerId) {
      const provisioned = await provisionUploadedFilesWorkspace({
        containerId: ctx.containerId,
        workspacePath: WORKSPACE_REPO_PATH,
        workspace: ctx.workspace,
        containerManager,
        downloadFile: (fileId) => workerClient.getWorkspaceFile(job.id, fileId),
      });

      eventLogger.info("workspace", "workspace.uploaded_files_materialized", "Uploaded files materialized into workspace", {
        workspacePath: WORKSPACE_REPO_PATH,
        filesWritten: provisioned.filesWritten,
        totalBytes: provisioned.totalBytes,
      });
    }

    eventLogger.info(
      "workspace",
      "workspace.ready",
      "Workspace is ready inside isolated container",
      {
        repositoryName: repositoryName ?? null,
        workspaceKind: ctx.workspace?.kind ?? null,
        workspacePath: WORKSPACE_REPO_PATH,
      }
    );
    eventLogger.info("serve", "serve.ready", "Serve is ready", {
      baseUrl,
      workspacePath: WORKSPACE_REPO_PATH,
    });

    await runPreSessionGuarded(ctx, "post-serve setup", async () => {
      // Restore checkpoint if a previous attempt left one (A-860: also check previousJobId).
      const previousJobId = typeof ctx.jobConfig.previousJobId === "string" ? ctx.jobConfig.previousJobId : undefined;
      if (ctx.containerId && await ctx.checkpointManager.hasCheckpoint(ctx.orgId, job.id, previousJobId)) {
        eventLogger.info("workspace", "checkpoint.restore_start", "Restoring checkpoint from previous attempt...", {
          jobId: job.id,
          orgId: ctx.orgId,
          previousJobId: previousJobId ?? null,
        });
        await ctx.checkpointManager.restoreCheckpoint(ctx.containerId, ctx.orgId, job.id, previousJobId);
        eventLogger.info("workspace", "checkpoint.restore_done", "Checkpoint restored", {
          jobId: job.id,
          orgId: ctx.orgId,
          previousJobId: previousJobId ?? null,
        });
      }

      // Inject platform config (skills, agents, CLAUDE.md/AGENTS.md) into container.
      if (platformInjector && ctx.containerId) {
        const MAX_INJECTION_ATTEMPTS = 3;
        let injectionResult: PlatformInjectionResult | null = null;

        for (let attempt = 1; attempt <= MAX_INJECTION_ATTEMPTS; attempt++) {
          try {
            injectionResult = await platformInjector.inject({
              containerId: ctx.containerId,
              workspacePath: WORKSPACE_REPO_PATH,
              runtime: ctx.runtimeExecutor!.platformRuntime,
              containerManager: containerManager,
            });

            if (injectionResult.injectedPaths.length > 0) {
              break; // Success
            }

            // Zero files injected — treat as failure
            const diagnosticDetail = injectionResult.diagnostics.length > 0
              ? `, diagnostics=${injectionResult.diagnostics.join(" | ")}`
              : "";
            const detail =
              `claudeMd=${injectionResult.claudeMdAction}, agentsMd=${injectionResult.agentsMdAction}` +
              diagnosticDetail;
            if (attempt < MAX_INJECTION_ATTEMPTS) {
              eventLogger.warn("skills", "platform.injection_empty", `Platform injection returned 0 files (attempt ${attempt}/${MAX_INJECTION_ATTEMPTS}), retrying...`, { detail });
              await new Promise(r => setTimeout(r, 1000 * attempt));
              injectionResult = null;
            } else {
              throw new Error(`Platform injection returned 0 files after ${MAX_INJECTION_ATTEMPTS} attempts (${detail})`);
            }
          } catch (err) {
            if (attempt < MAX_INJECTION_ATTEMPTS) {
              const msg = err instanceof Error ? err.message : String(err);
              eventLogger.warn("skills", "platform.injection_retry", `Platform injection failed (attempt ${attempt}/${MAX_INJECTION_ATTEMPTS}): ${msg}`);
              await new Promise(r => setTimeout(r, 1000 * attempt));
            } else {
              const msg = err instanceof Error ? err.message : String(err);
              eventLogger.error("skills", "platform.injection_failed", `Platform injection failed fatally: ${msg}`);
              throw new Error(`Platform config injection failed after ${MAX_INJECTION_ATTEMPTS} attempts: ${msg}`);
            }
          }
        }

        if (injectionResult) {
          injectedSkillPaths = injectionResult.injectedPaths;
          eventLogger.info("skills", "platform.injected", "Platform config injected into container", {
            injectedCount: injectionResult.injectedPaths.length,
            assumeUnchangedCount: injectionResult.trackedPathsAssumedUnchanged.length,
            excludedCount: injectionResult.excludedPaths.length,
            claudeMd: injectionResult.claudeMdAction,
            agentsMd: injectionResult.agentsMdAction,
          });
        }
      }

      // Append job-specific agent instructions to CLAUDE.md / AGENTS.md if provided
      if (ctx.containerId && ctx.jobConfig.agentInstructions && typeof ctx.jobConfig.agentInstructions === "string") {
        const instructionsBlock = `\n\n## Project Instructions\n\n${ctx.jobConfig.agentInstructions}\n`;
        const targetFiles = ctx.runtimeExecutor!.instructionTargets.map(
          (targetFile) => `${WORKSPACE_REPO_PATH}/${targetFile}`,
        );

        for (const targetFile of targetFiles) {
          try {
            let existingContent = "";
            try {
              const { exitCode, stdout } = await containerManager.execInContainer(
                ctx.containerId,
                ["cat", targetFile],
                WORKSPACE_REPO_PATH,
              );
              if (exitCode === 0) {
                existingContent = stdout;
              }
            } catch {
              // File doesn't exist — will create it
            }

            const updatedContent = existingContent + instructionsBlock;
            await containerManager.writeFileViaExec(ctx.containerId, targetFile, updatedContent);
            eventLogger.info("workspace", "instructions.appended", "Agent instructions appended to workspace file", {
              targetFile,
              instructionsLength: (ctx.jobConfig.agentInstructions as string).length,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[job:${job.id}] Failed to append instructions to ${targetFile}: ${msg}`);
          }
        }
      }

      // Scan repo for skills and import them via API (best-effort, A-1463).
      if (ctx.containerId && job.projectId && config.apiBaseUrl && config.apiKey) {
        try {
          const scannedSkills = await scanRepoForSkillsInContainer(
            containerManager,
            ctx.containerId,
            WORKSPACE_REPO_PATH,
          );

          if (scannedSkills.length > 0) {
            const importUrl = `${config.apiBaseUrl.replace(/\/+$/, "")}/api/skills/import-from-repo`;
            const importRes = await fetch(importUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${config.apiKey}`,
              },
              body: JSON.stringify({
                projectId: job.projectId,
                skills: scannedSkills,
              }),
              signal: AbortSignal.timeout(15_000),
            });

            if (importRes.ok) {
              const payload = await importRes.json().catch(() => null) as { data?: { created?: number; updated?: number; skipped?: number } } | null;
              const data = payload?.data;
              eventLogger.info("skills", "skills.repo_import_done", "Repo skill import completed", {
                total: scannedSkills.length,
                created: data?.created ?? 0,
                updated: data?.updated ?? 0,
                skipped: data?.skipped ?? 0,
              });
            } else {
              const text = await importRes.text().catch(() => "");
              console.warn(`[job:${job.id}] Skill import API returned ${importRes.status}: ${text.slice(0, 200)}`);
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[job:${job.id}] Repo skill scan/import failed (non-fatal): ${msg}`);
        }
    }
    });
  }

  // ---------------------------------------------------------------------------
  // Phase 5: Setup intervals — checkpoint, heartbeat, token refresh
  // ---------------------------------------------------------------------------

  const setupIntervals = (ctx: JobExecutionContext): void => {
    const { job, eventLogger } = ctx;

    // Start checkpoint interval — persists workspace to S3 periodically.
    {
      const checkpointContainerId = ctx.containerId;
      const checkpointJobId = job.id;
      const checkpointOrgId = ctx.orgId;
      ctx.checkpointInterval = setInterval(() => {
        ctx.checkpointManager
          .createCheckpoint(checkpointContainerId!, checkpointOrgId, checkpointJobId)
          .catch(() => undefined);
      }, config.checkpoint?.intervalMs ?? 300_000);
    }

    // Start heartbeat interval — publishes heartbeat to the stream every 1s.
    if (ctx.streamPublisher) {
      const heartbeatPublisher = ctx.streamPublisher;
      const heartbeatJobId = job.id;
      ctx.heartbeatInterval = setInterval(() => {
        const elapsedMs = Date.now() - ctx.startedAtMs;
        publishCanonicalEvent(heartbeatPublisher, {
          jobId: heartbeatJobId,
          sessionId: ctx.webSessionId ?? "",
          workspaceId: ctx.webWorkspaceId ?? "",
          threadId: ctx.threadId ?? "",
          timestamp: Date.now(),
          sequenceNumber: nextSequence(),
          event: { kind: "heartbeat", elapsedMs },
        }).catch(() => undefined);
      }, 1_000);
    }

    // Refresh the GitHub token inside the container periodically.
    // GitHub App installation tokens expire after 1h; this interval
    // overwrites the credential helpers and the shell-visible token file
    // every 25 min so git push and gh CLI calls keep working.
    if (ctx.containerId && ctx.repositoryOverride.id) {
      const refreshContainerId = ctx.containerId;
      const refreshRepoId = ctx.repositoryOverride.id;
      let lastTokenRefreshMs = Date.now(); // token was just fetched during buildInjectedEnv

      ctx.tokenRefreshInterval = setInterval(async () => {
        if (!shouldRefreshToken(lastTokenRefreshMs)) return;

        try {
          const { token } = await workerClient.getGithubToken(refreshRepoId);

          // Update both credential helper scripts inside the container
          const credentialScript = buildCredentialHelperScript(token);
          const askpassScript = buildAskpassScript(token);

          await containerManager.writeFileViaExec(
            refreshContainerId,
            "/tmp/git-credential-almirant.sh",
            credentialScript,
          );
          await containerManager.writeFileViaExec(
            refreshContainerId,
            "/tmp/git-askpass.sh",
            askpassScript,
          );
          await containerManager.writeFileBufferViaExec(
            refreshContainerId,
            "/tmp/github-token",
            Buffer.from(token, "utf8"),
            "0600",
          );

          lastTokenRefreshMs = Date.now();
          console.log(`[job:${job.id}] GitHub token refreshed inside container`);
          eventLogger.info("session", "token.refreshed", "GitHub token refreshed inside container");
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[job:${job.id}] Token refresh failed (non-fatal): ${msg}`);
          eventLogger.warn("session", "token.refresh_failed", "Token refresh failed (non-fatal)", {
            errorMessage: msg,
          });
        }
      }, TOKEN_REFRESH_INTERVAL_MS);
    }
  }

  // ---------------------------------------------------------------------------
  // Phase 6: Handle prewarm — wait for job conversion before running session
  // ---------------------------------------------------------------------------

  const handlePrewarm = async (ctx: JobExecutionContext): Promise<JobExecutionResult | null> => {
    const { job, jobConfig, eventLogger } = ctx;

    eventLogger.info("prewarm", "prewarm.ready", "Container ready, waiting for planning conversion", {
      sessionId: typeof jobConfig.planningSessionId === "string" ? jobConfig.planningSessionId : null,
    });

    const prewarmLocale = typeof jobConfig.locale === 'string' ? jobConfig.locale : 'es';
    const prewarmMessages: Record<string, { waiting: string; timeout: string }> = {
      es: {
        waiting: "⏳ Container listo. Esperando a que el usuario envíe su petición...",
        timeout: "⏱️ Timeout: el usuario no envió ningún mensaje. Cerrando.",
      },
      en: {
        waiting: "⏳ Container ready. Waiting for the user to send their request...",
        timeout: "⏱️ Timeout: the user did not send any message. Closing.",
      },
    };
    const prewarmMsgs = prewarmMessages[prewarmLocale] ?? prewarmMessages.en!;

    await publishCanonicalEvent(ctx.streamPublisher, {
      jobId: job.id,
      sessionId: ctx.webSessionId ?? "",
      workspaceId: ctx.webWorkspaceId ?? "",
      threadId: ctx.threadId ?? "",
      timestamp: Date.now(),
      sequenceNumber: nextSequence(),
      event: { kind: "system.info", message: prewarmMsgs.waiting },
    });

    const PREWARM_POLL_INTERVAL_MS = 2_000;
    const PREWARM_TIMEOUT_MS = 5 * 60 * 1_000; // 5 minutes
    const prewarmStart = Date.now();
    let converted = false;

    while (!converted) {
      if (Date.now() - prewarmStart > PREWARM_TIMEOUT_MS) {
        eventLogger.warn("prewarm", "prewarm.timeout", "Prewarm timed out waiting for conversion");
        await publishCanonicalEvent(ctx.streamPublisher, {
          jobId: job.id,
          sessionId: ctx.webSessionId ?? "",
          workspaceId: ctx.webWorkspaceId ?? "",
          threadId: ctx.threadId ?? "",
          timestamp: Date.now(),
          sequenceNumber: nextSequence(),
          event: { kind: "system.info", message: prewarmMsgs.timeout },
        });
        await workerClient.updateJobStatus(job.id, {
          status: "completed",
          result: { reason: "prewarm_timeout" },
        });
        return { jobId: job.id, success: true, threadId: ctx.threadId, summary: "prewarm_timeout" };
      }

      // Check if shutdown was requested
      try {
        const statusCheck = await workerClient.getJobStatus(job.id);
        if (statusCheck.shutdownRequested) {
          eventLogger.info("prewarm", "prewarm.shutdown", "Shutdown requested during prewarm");
          return { jobId: job.id, success: false, threadId: ctx.threadId, summary: "shutdown" };
        }
      } catch {
        // Best-effort status check
      }

      // Poll for job conversion
      try {
        const updated = await workerClient.getJobConfig(job.id);
        if (updated.jobType === "planning") {
          // Job was converted — update local state with real config
          const newConfig = (updated.config ?? {}) as Record<string, unknown>;
          Object.assign(jobConfig, newConfig);
          ctx.skillName = typeof newConfig.skillName === "string" ? newConfig.skillName : "ideate";
          converted = true;

          // Propagate converted fields to ctx.job so that runServeSession's
          // resolveJobIntent and normalizeJobConfig read the planning values,
          // not the original prewarm values. getJobConfig only returns
          // {jobType, config, status}, so we derive interactive/promptTemplate
          // from the known conversion: prewarm→planning is always interactive=true.
          (ctx.job as Record<string, unknown>).jobType = "planning";
          (ctx.job as Record<string, unknown>).skillName = ctx.skillName;
          (ctx.job as Record<string, unknown>).promptTemplate = ctx.skillName;
          (ctx.job as Record<string, unknown>).interactive = true;

          eventLogger.info("prewarm", "prewarm.converted", "Prewarm converted to planning", {
            skillName: ctx.skillName,
            hasUserMessage: typeof newConfig.userMessage === "string",
          });

          // Update webSessionId from prewarm conversion config
          if (typeof newConfig.planningSessionId === "string") {
            ctx.webSessionId = newConfig.planningSessionId;
          }

          if (ctx.threadId) {
            const { emoji, text } = templateLabel(ctx.skillName, "gerund", ctx.jobLocale);
            const threadName = `${emoji} ${text} ${ctx.humanTaskId}`;
            await publishCanonicalEvent(ctx.streamPublisher, {
              jobId: job.id,
              sessionId: ctx.webSessionId ?? "",
              workspaceId: ctx.webWorkspaceId ?? "",
              threadId: ctx.threadId,
              timestamp: Date.now(),
              sequenceNumber: nextSequence(),
              event: { kind: "system.info", message: "thread_rename", payload: { threadRename: true, name: threadName } },
            });
          }
          break;
        }
      } catch {
        // Best-effort poll — retry on next interval
      }

      await new Promise<void>((resolve) => setTimeout(resolve, PREWARM_POLL_INTERVAL_MS));
    }

    return null; // Continue to session
  }

  // ---------------------------------------------------------------------------
  // Phase 7: Execute session — run the serve session
  // ---------------------------------------------------------------------------

  const executeSession = async (ctx: JobExecutionContext): Promise<SessionExecutionResult> => {
    return runServeSessionWrapper({
      baseUrl: ctx.containerServeBaseUrl!,
      containerId: ctx.containerId,
      job: ctx.job,
      workItem: ctx.workItem ?? null,
      eventLogger: ctx.eventLogger,
      streamPublisher: ctx.streamPublisher,
      threadId: ctx.threadId,
      resolvedModel: ctx.resolvedModel,
      completedTaskIds: ctx.prFirstResult?.completedTaskIds,
      webSessionId: ctx.webSessionId,
      webWorkspaceId: ctx.webWorkspaceId,
      runtimeConfig: ctx.runtimeConfig!,
      runtimeExecutor: ctx.runtimeExecutor!,
    });
  }

  // ---------------------------------------------------------------------------
  // Phase 8: Post-session — cancel handling, push, completion, PR, status
  // ---------------------------------------------------------------------------

  const handlePostSession = async (
    ctx: JobExecutionContext,
    result: SessionExecutionResult,
  ): Promise<JobExecutionResult> => {
    const { job, injectedEnv, eventLogger, runtimeConfig } = ctx;

    // Stop heartbeat once the session ends.
    if (ctx.heartbeatInterval) clearInterval(ctx.heartbeatInterval);

    ctx.cancelledByUser = result.cancelledByUser === true;
    ctx.shutdownRequestedByUser = result.shutdownRequested === true;

    if (ctx.cancelledByUser) {
      eventLogger.warn(
        "finish",
        ctx.shutdownRequestedByUser ? "job.shutdown_requested" : "job.cancelled",
        ctx.shutdownRequestedByUser ? "Job shutdown requested by user" : "Job cancelled by user"
      );

      {
        if (ctx.threadId) {
          const threadName = `⏸️ ${templateLabel(ctx.skillName, "infinitive", ctx.jobLocale).text} ${ctx.humanTaskId}`;
          await publishCanonicalEvent(ctx.streamPublisher, {
            jobId: job.id,
            sessionId: ctx.webSessionId ?? "",
            workspaceId: ctx.webWorkspaceId ?? "",
            threadId: ctx.threadId,
            timestamp: Date.now(),
            sequenceNumber: nextSequence(),
            event: { kind: "system.info", message: "thread_rename", payload: { threadRename: true, name: threadName } },
          });
        }
        await publishCanonicalEvent(ctx.streamPublisher, {
          jobId: job.id,
          sessionId: ctx.webSessionId ?? "",
          workspaceId: ctx.webWorkspaceId ?? "",
          threadId: ctx.threadId ?? "",
          timestamp: Date.now(),
          sequenceNumber: nextSequence(),
          event: {
            kind: "job.cancelled",
            reason: ctx.shutdownRequestedByUser ? "Job shutdown by user." : "Job cancelled by user.",
          },
        });
      }

      // Fire-and-forget PostHog telemetry
      emitJobTelemetry({
        jobId: job.id,
        skillName: ctx.skillName,
        provider: String(job.provider ?? ""),
        codingAgent: ctx.jobCodingAgent ?? runtimeConfig!.type,
        model: ctx.resolvedModel ?? "",
        durationMs: Date.now() - ctx.startedAtMs,
        status: "cancelled",
        retryCount: job.retryCount ?? 0,
        workspaceId: ctx.orgId,
      });

      return {
        jobId: job.id,
        success: false,
        threadId: ctx.threadId,
        summary: ctx.shutdownRequestedByUser ? "shutdown" : "cancelled",
      };
    }

    if (result.pausedForQuota) {
      const pause = result.pausedForQuota;
      eventLogger.warn("finish", "job.paused_for_quota", pause.reason, {
        errorType: pause.errorType,
        retryDelayMs: pause.retryDelayMs,
        availableAt: pause.availableAt,
        sourceEventType: pause.sourceEventType,
      });

      if (ctx.threadId) {
        const threadName = `⏸️ ${templateLabel(ctx.skillName, "infinitive", ctx.jobLocale).text} ${ctx.humanTaskId}`;
        await publishCanonicalEvent(ctx.streamPublisher, {
          jobId: job.id,
          sessionId: ctx.webSessionId ?? "",
          workspaceId: ctx.webWorkspaceId ?? "",
          threadId: ctx.threadId,
          timestamp: Date.now(),
          sequenceNumber: nextSequence(),
          event: { kind: "system.info", message: "thread_rename", payload: { threadRename: true, name: threadName } },
        });
      }

      await publishCanonicalEvent(ctx.streamPublisher, {
        jobId: job.id,
        sessionId: ctx.webSessionId ?? "",
        workspaceId: ctx.webWorkspaceId ?? "",
        threadId: ctx.threadId ?? "",
        timestamp: Date.now(),
        sequenceNumber: nextSequence(),
        event: {
          kind: "system.warn",
          message: `Job paused until quota resets: ${pause.reason}`,
          payload: {
            errorType: pause.errorType,
            availableAt: pause.availableAt,
          },
        },
      });

      await retryUpdateJobStatus(workerClient, job.id, {
        status: "paused",
        workerId: config.workerId,
        result: {
          threadId: ctx.threadId,
          summary: result.summary ?? null,
          pausedForQuota: true,
          availableAt: pause.availableAt,
          errorType: pause.errorType,
          sourceEventType: pause.sourceEventType ?? null,
        },
        errorMessage: pause.reason,
        errorType: pause.errorType,
        availableAt: pause.availableAt,
        sessionId: result.sessionId,
        model: ctx.resolvedModel ?? undefined,
        tokensUsed: result.tokensUsed,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      });

      emitJobTelemetry({
        jobId: job.id,
        skillName: ctx.skillName,
        provider: String(job.provider ?? ""),
        codingAgent: ctx.jobCodingAgent ?? runtimeConfig!.type,
        model: ctx.resolvedModel ?? "",
        durationMs: Date.now() - ctx.startedAtMs,
        status: "paused",
        errorCategory: "quota",
        retryCount: job.retryCount ?? 0,
        workspaceId: ctx.orgId,
      });

      return {
        jobId: job.id,
        success: false,
        threadId: ctx.threadId,
        summary: "paused_quota",
        errorMessage: pause.reason,
      };
    }

    await retryUpdateJobStatus(workerClient, job.id, {
      status: "finalizing",
      workerId: config.workerId,
      result: {
        threadId: ctx.threadId,
        summary: result.summary ?? null,
      },
      sessionId: result.sessionId,
      model: ctx.resolvedModel ?? undefined,
      tokensUsed: result.tokensUsed,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    });
    eventLogger.info("finish", "job.finalizing", "Session ended; finalizing post-session work", {
      sessionSuccess: result.success,
      durationMs: Date.now() - ctx.startedAtMs,
    });

    // Free the primary LLM session (KV cache / message history) on the serve
    // process BEFORE the push phase potentially creates a second session on
    // the same container. Two coexisting sessions can push the container past
    // its 2028 MB memory cap and trigger the cgroup OOM-killer.
    await releasePrimarySession({
      jobId: job.id,
      sessionId: result.sessionId,
      containerServeBaseUrl: ctx.containerServeBaseUrl,
      eventLogger,
    });

    // Extract branch name from container before reporting status.
    if (ctx.containerId) {
      ctx.extractedBranchName = await extractBranchName(containerManager, ctx.containerId);
    }

    // Ensure only write-capable jobs are allowed to push post-session.
    let pushSucceeded = false;
    const pushBranch = ctx.extractedBranchName ?? injectedEnv.REPO_BRANCH ?? "main";
    // Keep explicit runner-implement / runner-document skill names here for deployment validation.
    const postSessionPushPolicy = resolvePostSessionPushPolicy({
      promptTemplate: job.promptTemplate ?? null,
      skillName: job.skillName ?? null,
      jobType: ctx.effectiveJobType,
      interactive: job.interactive,
      config: ctx.jobConfig,
    });
    const shouldPush =
      postSessionPushPolicy === "on-success" &&
      ctx.workspace?.kind === "git_repo" &&
      Boolean(injectedEnv.REPO_URL);

    console.log(`[job:${job.id}] Post-session push check: containerId=${!!ctx.containerId} success=${result.success} repoUrl=${!!injectedEnv.REPO_URL} serveUrl=${ctx.containerServeBaseUrl} shouldPush=${shouldPush} policy=${postSessionPushPolicy} skill=${ctx.skillName}`);

    if (!shouldPush) {
      console.log(`[job:${job.id}] Skipping post-session push: skill "${ctx.skillName}" is not push-eligible`);
      eventLogger.info("push", "push.skipped_non_implementation", "Skipping push — skill is not push-eligible", {
        skillName: ctx.skillName,
        jobType: ctx.effectiveJobType,
        postSessionPushPolicy,
      });
    } else if (ctx.containerId && result.success && injectedEnv.REPO_URL) {
      // Refresh token just before push attempts to ensure credentials are fresh.
      if (ctx.repositoryOverride.id) {
        try {
          const { token } = await workerClient.getGithubToken(ctx.repositoryOverride.id);
          const credentialScript = buildCredentialHelperScript(token);
          const askpassScript = buildAskpassScript(token);
          await containerManager.writeFileViaExec(ctx.containerId, "/tmp/git-credential-almirant.sh", credentialScript);
          await containerManager.writeFileViaExec(ctx.containerId, "/tmp/git-askpass.sh", askpassScript);
          console.log(`[job:${job.id}] Token refreshed before push`);
        } catch (err) {
          // Non-fatal: push may still work if token hasn't expired yet
          console.warn(`[job:${job.id}] Pre-push token refresh failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      const pushResult = await executePushPipeline(
        { containerManager: containerManager, workerClient: workerClient },
        {
          containerId: ctx.containerId,
          job,
          repoUrl: injectedEnv.REPO_URL,
          pushBranch,
          repositoryId: ctx.repositoryOverride.id,
          containerServeBaseUrl: ctx.containerServeBaseUrl,
          eventLogger,
        },
      );
      pushSucceeded = pushResult.pushSucceeded;
    } else {
      console.warn(`[job:${job.id}] Skipping post-session push: containerId=${!!ctx.containerId} success=${result.success} repoUrl=${!!injectedEnv.REPO_URL}`);
    }

    // Evaluate completion: failure patterns, runner-implement validation, PR marking
    const completion = await evaluateCompletion(
      { workerClient: workerClient, containerManager: containerManager },
      {
        job,
        result,
        skillName: ctx.skillName,
        pushSucceeded,
        requiresPush: shouldPush,
        prFirstResult: ctx.prFirstResult,
        eventLogger,
        startedAtMs: ctx.startedAtMs,
        containerId: ctx.containerId,
        extractedBranchName: ctx.extractedBranchName,
        baseBranch: ctx.repositoryOverride.branch ?? "main",
        workItem: ctx.workItem,
        injectedEnvRepoUrl: injectedEnv.REPO_URL,
        streamPublisher: ctx.streamPublisher,
        webSessionId: ctx.webSessionId,
        webWorkspaceId: ctx.webWorkspaceId,
        threadId: ctx.threadId,
        workerId: config.workerId,
        apiBaseUrl: config.apiBaseUrl,
        apiKey: config.apiKey,
      },
    );

    // Handle early returns (re-queued retryable failures)
    if (completion.earlyReturn) {
      return completion.earlyReturn;
    }

    ctx.prFirstResult = completion.prResult;

    const { jobCompleted, jobStatus, prSummary } = completion;

    // Update final job status
    await retryUpdateJobStatus(workerClient, job.id, {
      status: jobStatus,
      workerId: config.workerId,
      result: {
        threadId: ctx.threadId,
        summary: result.summary ?? null,
        prSummary: prSummary ?? null,
        completionState: result.completionState ?? (jobCompleted ? "complete" : "failed"),
        incompleteReason: result.incompleteReason ?? null,
        missingWorkItemIds: result.missingWorkItemIds ?? [],
        backgroundAgentTimedOut: result.backgroundAgentTimedOut === true,
        runnerImplementPendingTaskIds: [],
        runnerImplementObservedCompletionSignal: null,
      },
      errorMessage: jobStatus === "failed" ? result.errorMessage : undefined,
      branchName: ctx.extractedBranchName ?? undefined,
      durationMs: Date.now() - ctx.startedAtMs,
      prUrl: ctx.prFirstResult?.prUrl,
      prNumber: ctx.prFirstResult?.prNumber,
      sessionId: result.sessionId,
      model: ctx.resolvedModel ?? undefined,
      tokensUsed: result.tokensUsed,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    });
    eventLogger.info(
      "finish",
      jobStatus === "completed" ? "job.completed" : jobStatus === "incomplete" ? "job.incomplete" : "job.failed",
      jobStatus === "completed" ? "Job completed successfully" : jobStatus === "incomplete" ? "Job finished incomplete" : "Job finished with failure",
      {
        durationMs: Date.now() - ctx.startedAtMs,
        summary: result.summary ?? null,
        errorMessage: result.errorMessage ?? null,
        incompleteReason: result.incompleteReason ?? null,
      }
    );

    // Fire-and-forget PostHog telemetry
    emitJobTelemetry({
      jobId: job.id,
      skillName: ctx.skillName,
      provider: String(job.provider ?? ""),
      codingAgent: ctx.jobCodingAgent ?? runtimeConfig!.type,
      model: ctx.resolvedModel ?? "",
      durationMs: Date.now() - ctx.startedAtMs,
      status: jobStatus,
      errorCategory: result.errorMessage ? classifyError(result.errorMessage) : undefined,
      retryCount: job.retryCount ?? 0,
      workspaceId: ctx.orgId,
    });

    {
      if (ctx.threadId) {
        const threadPrefix = jobStatus === "completed" ? "\u2705" : jobStatus === "incomplete" ? "\u26a0\ufe0f" : "\u274c";
        const threadName = `${threadPrefix} ${templateLabel(ctx.skillName, "infinitive", ctx.jobLocale).text} ${ctx.humanTaskId}`;
        await publishCanonicalEvent(ctx.streamPublisher, {
          jobId: job.id,
          sessionId: ctx.webSessionId ?? "",
          workspaceId: ctx.webWorkspaceId ?? "",
          threadId: ctx.threadId,
          timestamp: Date.now(),
          sequenceNumber: nextSequence(),
          event: { kind: "system.info", message: "thread_rename", payload: { threadRename: true, name: threadName } },
        });
      }
      if (jobCompleted) {
        await publishCanonicalEvent(ctx.streamPublisher, {
          jobId: job.id,
          sessionId: ctx.webSessionId ?? "",
          workspaceId: ctx.webWorkspaceId ?? "",
          threadId: ctx.threadId ?? "",
          timestamp: Date.now(),
          sequenceNumber: nextSequence(),
          event: {
            kind: "job.completed",
            summary: prSummary ?? result.summary ?? "Execution completed.",
            elapsedMs: Date.now() - ctx.startedAtMs,
          },
        });
      } else if (jobStatus === "incomplete") {
        await publishCanonicalEvent(ctx.streamPublisher, {
          jobId: job.id,
          sessionId: ctx.webSessionId ?? "",
          workspaceId: ctx.webWorkspaceId ?? "",
          threadId: ctx.threadId ?? "",
          timestamp: Date.now(),
          sequenceNumber: nextSequence(),
          event: {
            kind: "job.incomplete",
            summary: result.incompleteReason ?? prSummary ?? result.summary ?? "Execution finished incomplete.",
            elapsedMs: Date.now() - ctx.startedAtMs,
            missingWorkItemIds: result.missingWorkItemIds ?? [],
          },
        });
      } else {
        await publishCanonicalEvent(ctx.streamPublisher, {
          jobId: job.id,
          sessionId: ctx.webSessionId ?? "",
          workspaceId: ctx.webWorkspaceId ?? "",
          threadId: ctx.threadId ?? "",
          timestamp: Date.now(),
          sequenceNumber: nextSequence(),
          event: {
            kind: "job.failed",
            errorMessage: result.errorMessage ?? "Job finished with failure",
            elapsedMs: Date.now() - ctx.startedAtMs,
          },
        });
      }
    }

    // On success, clean up the checkpoint — it's no longer needed.
    if (jobCompleted) {
      await ctx.checkpointManager.deleteCheckpoint(ctx.orgId, job.id).catch(() => undefined);
    }

    return {
      jobId: job.id,
      success: jobCompleted,
      threadId: ctx.threadId,
      summary: result.summary,
      errorMessage: result.errorMessage,
    };
  }

  // ---------------------------------------------------------------------------
  // Error handler — catch block extracted
  // ---------------------------------------------------------------------------

  const handleExecutionError = async (ctx: JobExecutionContext, error: unknown): Promise<JobExecutionResult> => {
    const { job, eventLogger } = ctx;
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    // Classify the error for retry decisions (A-863)
    const errorClassification = classifyError(error instanceof Error ? error : errorMessage);

    console.error(`[job:${job.id}] Execution failed: ${errorMessage} [classification: ${errorClassification}]`);
    captureError(error, {
      jobId: job.id,
      skillName: resolveSkillTag(job, ctx.initialJobConfig),
      workerId: config.workerId,
      errorClassification,
      durationMs: Date.now() - ctx.startedAtMs,
    });
    eventLogger.error("finish", "job.failed", "Execution failed", {
      errorMessage,
      errorClassification,
      durationMs: Date.now() - ctx.startedAtMs,
    });

    const retryCount = job.retryCount ?? 0;
    const maxRetries = job.maxRetries ?? 0;
    if (!ctx.cancelledByUser && isPhaseTimeoutError(error) && retryCount < maxRetries) {
      const nextRetryCount = retryCount + 1;
      eventLogger.warn("startup", "startup.pre_session_retry_queued", "Pre-session timeout queued for retry", {
        retryCount: nextRetryCount,
        maxRetries,
        errorMessage,
      });

      await retryUpdateJobStatus(workerClient, job.id, {
        status: "queued",
        retryCount: nextRetryCount,
        errorMessage: `Auto-retry after pre-session timeout: ${errorMessage}`,
        errorType: errorClassification,
        result: { threadId: ctx.threadId, retryReason: "pre_session_timeout" },
        branchName: ctx.extractedBranchName ?? undefined,
      }).catch(() => undefined);

      return {
        jobId: job.id,
        success: false,
        threadId: ctx.threadId,
        summary: "retry_queued",
        errorMessage,
      };
    }

    if (!ctx.cancelledByUser) {
      await retryUpdateJobStatus(workerClient, job.id, {
        status: "failed",
        workerId: config.workerId,
        errorMessage,
        errorType: errorClassification,
        result: { threadId: ctx.threadId },
        branchName: ctx.extractedBranchName ?? undefined,
      }).catch(() => undefined);
    }

    {
      const catchSkill = resolveSkillTag(job, ctx.initialJobConfig);
      if (ctx.threadId) {
        const threadName = `❌ ${templateLabel(catchSkill, "infinitive", ctx.jobLocale).text} ${ctx.humanTaskId}`;
        await publishCanonicalEvent(ctx.streamPublisher, {
          jobId: job.id,
          sessionId: ctx.webSessionId ?? "",
          workspaceId: ctx.webWorkspaceId ?? "",
          threadId: ctx.threadId,
          timestamp: Date.now(),
          sequenceNumber: nextSequence(),
          event: { kind: "system.info", message: "thread_rename", payload: { threadRename: true, name: threadName } },
        });
      }
      await publishCanonicalEvent(ctx.streamPublisher, {
        jobId: job.id,
        sessionId: ctx.webSessionId ?? "",
        workspaceId: ctx.webWorkspaceId ?? "",
        threadId: ctx.threadId ?? "",
        timestamp: Date.now(),
        sequenceNumber: nextSequence(),
        event: {
          kind: "job.failed",
          errorMessage: errorMessage,
        },
      });
    }

    // Fire-and-forget PostHog telemetry (catch block — use initialJobConfig as fallback)
    emitJobTelemetry({
      jobId: job.id,
      skillName: resolveSkillTag(job, ctx.initialJobConfig),
      provider: String(job.provider ?? ""),
      codingAgent: resolveJobCodingAgent(job) ?? "",
      model: "",
      durationMs: Date.now() - ctx.startedAtMs,
      status: errorClassification.startsWith("recoverable_timeout") ? "timeout" : "failed",
      errorCategory: errorClassification,
      retryCount: job.retryCount ?? 0,
      workspaceId: ctx.orgId,
    });

    return {
      jobId: job.id,
      success: false,
      threadId: ctx.threadId,
      errorMessage,
    };
  }

  // ---------------------------------------------------------------------------
  // Cleanup — finally block extracted
  // ---------------------------------------------------------------------------

  const cleanupExecution = async (ctx: JobExecutionContext): Promise<void> => {
    const { job, eventLogger } = ctx;

    if (ctx.heartbeatInterval) clearInterval(ctx.heartbeatInterval);
    if (ctx.checkpointInterval) clearInterval(ctx.checkpointInterval);
    if (ctx.tokenRefreshInterval) clearInterval(ctx.tokenRefreshInterval);

    if (ctx.containerId) {
      // Inspect container for OOM detection before teardown (A-861)
      const containerState = await containerManager.inspectContainer(ctx.containerId);
      if (containerState.oomKilled && !ctx.oomAlreadyDetected) {
        console.warn(`[job:${job.id}] Container was OOM-killed (exit code: ${containerState.exitCode})`);
        eventLogger.error("session", "container.oom_killed", "Container was OOM-killed by Docker", {
          exitCode: containerState.exitCode,
          containerId: ctx.containerId,
        });
      } else if (!containerState.running && containerState.exitCode !== null && containerState.exitCode !== 0) {
        eventLogger.warn("session", "container.unexpected_exit", "Container exited unexpectedly", {
          exitCode: containerState.exitCode,
          containerId: ctx.containerId,
        });
      }

      // Final checkpoint before teardown if job did not complete successfully (A-862)
      if (containerState.running && ctx.checkpointManager.active) {
        await Promise.race([
          ctx.checkpointManager.createCheckpoint(ctx.containerId, ctx.orgId, job.id),
          new Promise<void>((_, reject) => setTimeout(() => reject(new Error("checkpoint timeout")), 10_000)),
        ]).then(() => {
          console.log(`[job:${job.id}] Final checkpoint created before teardown`);
          // Notify about preserved checkpoint (A-865)
          void publishCanonicalEvent(ctx.streamPublisher, {
            jobId: job.id,
            sessionId: ctx.webSessionId ?? "",
            workspaceId: ctx.webWorkspaceId ?? "",
            threadId: ctx.threadId ?? "",
            timestamp: Date.now(),
            sequenceNumber: nextSequence(),
            event: { kind: "system.info", message: "\uD83D\uDCBE Checkpoint preservado \u2014 puedes reintentar sin perder trabajo." },
          });
        }).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[job:${job.id}] Final checkpoint failed: ${msg}`);
        });
      }

      // Log resource usage before teardown for capacity planning + PostHog
      await logTmpfsUsage(containerManager, ctx.containerId, job.id, eventLogger, {
        skillName: resolveSkillTag(job, ctx.initialJobConfig),
        workspaceId: ctx.orgId,
        workerId: config.workerId,
        workspaceMountMode: ctx.workspaceMountMode,
      });

      await containerManager.stopContainer(ctx.containerId, 5000);
      await containerManager.removeContainer(ctx.containerId, true);
    }

    // Clean up disk-backed workspace directory
    if (ctx.jobWorkspacePath) {
      try {
        await rm(ctx.jobWorkspacePath, { recursive: true, force: true });
      } catch (cleanupErr) {
        console.warn(
          `[workspace-cleanup] Failed to remove ${ctx.jobWorkspacePath}: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`
        );
      }
    }

    await ctx.streamPublisher?.close().catch(() => undefined);
    await eventLogger.stop().catch(() => undefined);
  }

  // runServeSession, consumeSseEvents, and waitForPlanningInteractionAnswer
  // extracted to ./session/session-runner.ts and ./session/event-consumer.ts

  const runServeSessionWrapper = (params: {
    baseUrl: string;
    containerId?: string | null;
    job: ClaimedJob;
    workItem: WorkItemDetails | null;
    eventLogger: RunnerJobEventLogger;
    streamPublisher?: StreamPublisher;
    threadId?: string;
    resolvedModel?: string;
    completedTaskIds?: string[];
    webSessionId?: string;
    webWorkspaceId?: string;
    runtimeConfig: RuntimeConfig;
    runtimeExecutor: RuntimeExecutor;
  }): Promise<SessionExecutionResult> => {
    return runServeSessionFn(
      {
        workerClient,
        containerManager,
        config: {
          apiBaseUrl: config.apiBaseUrl,
          apiKey: config.apiKey,
          platformConfigPath: config.platformConfigPath,
          webOutputEnabled: config.webOutputEnabled,
          overallTimeoutMs: config.overallTimeoutMs,
          effortPointDurationMs: config.effortPointDurationMs,
          preSessionTimeoutMs: config.preSessionTimeoutMs,
        },
      },
      params,
    );
  };

  const buildContainerSpecForJob = (
    job: ClaimedJob,
    workItem: WorkItemDetails | null,
    runtimeConfig: RuntimeConfig,
    injectedEnv: Record<string, string>,
    openCodeConfig: Awaited<ReturnType<typeof buildInjectedEnv>>["openCodeConfig"],
    workspaceMountMode: "bind" | "tmpfs",
  ): RunnerContainerSpec => {
    return buildContainerSpec({
      job,
      workItem,
      runtimeConfig,
      injectedEnv,
      openCodeConfig,
      workspaceMountMode,
      reposHostPath: config.reposHostPath,
    });
  };

  // createBranchAndDraftPr, markPrReadyForReview, createLatePr, collectAndPushChanges
  // extracted to ./delivery/pr-manager.ts

  // startTmpfsWatcher and logTmpfsUsage extracted to ./observability/resource-monitor.ts

  const waitForServeReadyFn = (baseUrl: string): Promise<void> => {
    return waitForServeReady(baseUrl);
  };

  const resolveWorkItem = (
    job: ClaimedJob
  ): Promise<WorkItemDetails | null> => {
    return resolveWorkItemFn(skillResolverDeps, job);
  };

  const resolveSkillFromDb = (params: {
    skillId?: string;
    skillSlug?: string;
    projectId?: string;
    workspaceId?: string;
    containerId: string;
    runtimeType: string;
    eventLogger: RunnerJobEventLogger;
  }): Promise<{ slug: string; content: string }> => {
    return resolveSkillFromDbFn(skillResolverDeps, params);
  };

  return {
    execute,
    setupValidateEnvironment: (jobId: string, repoPath: string) =>
      setupValidateEnvironment({ containerManager }, jobId, repoPath),
    teardownValidateEnvironment: (env: ValidateEnvironment) =>
      teardownValidateEnvironment({ containerManager }, env),
    get injectedSkillPaths() { return injectedSkillPaths; },
  };
};

// Legacy exports removed — resource allocation now in job-intent.ts
export type { SkillResources };
