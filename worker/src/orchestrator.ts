import path from "node:path";
import os from "node:os";
import { z } from "zod";
import type { AgentProgress, AgentTaskInput } from "./providers/types.js";
import { getProvider } from "./providers/provider-factory.js";
import type { ProviderName } from "./providers/provider-factory.js";
import type { AgentProviderConfig, AgentEnvironment } from "./providers/types.js";
import type { QueueAdapter, QueuedJob, AgentJobResult as QueueAgentJobResult } from "./queue/queue-adapter.js";
import { buildImplementationPrompt } from "./providers/prompt-builder.js";
import { ensureGitIdentity, getOriginRepo } from "./git/worktree.js";
import { createWorktree, cleanupWorktree, cloneRepository, cleanupClone } from "./git/worktree-manager.js";
import { runGit } from "./git/git-runner.js";
import { generateBranchName } from "./git/branch-naming.js";
import { findExistingRemoteBranch, commitChanges, pushBranch } from "./git/branch-manager.js";
import { createPullRequest } from "./git/pr-manager.js";
import { logger } from "@almirant/config";
import { createApiClient, NetworkError, ApiError, AuthError, NotFoundError } from "./api-client.js";
import { checkWorkItemDependencies } from "./dependency-checker.js";
import { checkQuotaAvailability } from "./quota-checker.js";

const agentJobConfigSchema = z.object({
  repoPath: z.string().min(1),
  baseBranch: z.string().min(1),
  repoUrl: z.string().min(1).optional(),
  mcpServerUrl: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  skillName: z.string().min(1).optional(),
  repositoryId: z.string().min(1).optional(),
}).strict();

type AgentJobConfig = z.infer<typeof agentJobConfigSchema>;

export type OrchestratorProgress = {
  jobId: string;
  phase: "starting" | "reading" | "implementing" | "testing";
  message: string;
  timestamp: string;
};

export type AdditionalRepoConfig = {
  repositoryId: string;
  repoPath: string;
  baseBranch?: string;
};

export type ProjectConfig = {
  projectId: string;
  repoPath: string;
  baseBranch: string;
  repoUrl?: string;
  additionalRepos?: AdditionalRepoConfig[];
};

export type OrchestratorConfig = {
  workerId: string;
  maxConcurrentAgents: number;
  queue: QueueAdapter;
  apiBaseUrl: string;
  apiKey: string;
  providers: {
    claudeCode?: AgentProviderConfig;
    codex?: AgentProviderConfig;
  };
  onProgress?: (progress: OrchestratorProgress) => void;
  projectConfigs?: ProjectConfig[];
};

type ActiveJob = {
  promise: Promise<void>;
  abort?: () => void;
};

const nowIso = () => new Date().toISOString();

const toProgress = (jobId: string, phase: OrchestratorProgress["phase"], message: string): OrchestratorProgress => ({
  jobId,
  phase,
  message,
  timestamp: nowIso(),
});

type ClassifiedError = {
  type: "transient" | "rate_limit" | "quota_exhausted" | "budget_exceeded" | "agent-error" | "code-error" | "config-error";
  retryable: boolean;
  message: string;
  retryAfterMs?: number;
};

const toMessage = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
};

const extractRetryAfterMs = (message: string): number | null => {
  const patterns = [
    /retry[- ]after:?\s*(\d+)/i,
    /wait\s+(\d+)\s*s/i,
    /(\d+)\s*seconds?\s*(?:until|before)/i,
  ];
  for (const pat of patterns) {
    const match = message.match(pat);
    if (match?.[1]) {
      const seconds = parseInt(match[1], 10);
      if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
    }
  }
  return null;
};

const RATE_LIMIT_THRESHOLD_MS = 300_000; // 5 minutes
const DEFAULT_RATE_LIMIT_RETRY_MS = 60_000; // 1 minute
const DEFAULT_QUOTA_EXHAUSTED_RETRY_MS = 3_600_000; // 1 hour

export const classifyError = (err: unknown): ClassifiedError => {
  const message = toMessage(err);
  const lower = message.toLowerCase();

  // 1) Budget exceeded: per-job budget cap set by the user, not retryable.
  if (lower.includes("error_max_budget_usd") || lower.includes("max budget") || lower.includes("budget exceeded")) {
    return { type: "budget_exceeded", retryable: false, message };
  }

  // 2) Rate limit vs quota exhausted: distinguish transient 429 from long-window depletion.
  const isRateLimitSignal =
    lower.includes("rate limit") ||
    lower.includes("rate_limit") ||
    lower.includes("429") ||
    lower.includes("too many requests") ||
    lower.includes("resource_exhausted");

  if (isRateLimitSignal) {
    const retryAfterMs = extractRetryAfterMs(message);

    if (retryAfterMs !== null && retryAfterMs > RATE_LIMIT_THRESHOLD_MS) {
      // Long wait indicates quota/resource depletion, not a momentary spike.
      return { type: "quota_exhausted", retryable: true, message, retryAfterMs };
    }

    // Short or absent retry-after: transient rate limit.
    return {
      type: "rate_limit",
      retryable: true,
      message,
      retryAfterMs: retryAfterMs ?? DEFAULT_RATE_LIMIT_RETRY_MS,
    };
  }

  // 2b) Explicit quota exhaustion keywords (even without 429).
  if (
    lower.includes("quota") ||
    lower.includes("insufficient_quota") ||
    lower.includes("billing") ||
    lower.includes("credit")
  ) {
    const retryAfterMs = extractRetryAfterMs(message);
    return {
      type: "quota_exhausted",
      retryable: true,
      message,
      retryAfterMs: retryAfterMs ?? DEFAULT_QUOTA_EXHAUSTED_RETRY_MS,
    };
  }

  // 3) Network / API transient failures (non-rate-limit).
  if (
    err instanceof NetworkError ||
    lower.includes("timed out") ||
    lower.includes("timeout") ||
    lower.includes("econnreset") ||
    lower.includes("enotfound") ||
    lower.includes("eai_again") ||
    lower.includes("502") ||
    lower.includes("503")
  ) {
    return { type: "transient", retryable: true, message };
  }

  // 4) Auth / not-found / config issues: requires manual intervention.
  if (err instanceof AuthError || err instanceof NotFoundError) {
    return { type: "config-error", retryable: false, message };
  }
  if (err instanceof ApiError) {
    // Heuristic: treat server errors as transient; client errors as config.
    if (lower.includes("http 5") || lower.includes("internal server error")) {
      return { type: "transient", retryable: true, message };
    }
    return { type: "config-error", retryable: false, message };
  }

  // 5) Code errors: failing type-check/lint/tests should not be retried.
  if (
    lower.includes("type-check") ||
    lower.includes("typecheck") ||
    lower.includes("tsc") ||
    lower.includes("typescript") ||
    lower.includes("eslint") ||
    lower.includes("lint") ||
    lower.includes("test failed") ||
    lower.includes("vitest") ||
    lower.includes("jest") ||
    lower.includes("build failed")
  ) {
    return { type: "code-error", retryable: false, message };
  }

  // 6) Agent errors: provider couldn't complete; allow retry.
  if (lower.includes("provider execution failed") || lower.includes("agent")) {
    return { type: "agent-error", retryable: true, message };
  }

  // 7) Fallback: assume config unless it looks transient.
  if (lower.includes("worktree") || lower.includes("branch") || lower.includes("repo")) {
    return { type: "config-error", retryable: false, message };
  }

  return { type: "config-error", retryable: false, message };
};

const inferProvider = (job: QueuedJob): ProviderName => {
  if (job.provider === "claude-code") return "claude-code";
  if (job.provider === "codex") return "codex";
  // Exhaustive check: queue adapter must normalize provider values.
  const exhaustive: never = job.provider;
  return exhaustive;
};

const providerConfigFor = (provider: ProviderName, config: OrchestratorConfig): AgentProviderConfig => {
  if (provider === "claude-code") return config.providers.claudeCode ?? {};
  return config.providers.codex ?? {};
};

const computeCommitStats = async (
  repoPath: string,
  commitSha: string
): Promise<{ linesAdded: number; linesRemoved: number; filesChanged: string[] }> => {
  const proc = Bun.spawn({
    cmd: ["git", "-C", repoPath, "show", "--numstat", "--name-only", "--format=", commitSha],
    cwd: repoPath,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;

  let added = 0;
  let removed = 0;
  const files: string[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    // numstat lines: "<added>\t<removed>\t<path>"
    if (parts.length >= 3 && /^[0-9-]+$/.test(parts[0] ?? "") && /^[0-9-]+$/.test(parts[1] ?? "")) {
      const aN = Number(parts[0]);
      const rN = Number(parts[1]);
      if (Number.isFinite(aN)) added += aN;
      if (Number.isFinite(rN)) removed += rN;
      continue;
    }

    // name-only lines: "<path>"
    files.push(trimmed);
  }
  return { linesAdded: added, linesRemoved: removed, filesChanged: Array.from(new Set(files)) };
};

const loadWorkItemForJob = async (job: QueuedJob) => {
  if (!job.workItemId) throw new Error(`Job ${job.jobId} has no workItemId`);
  return job.workItemId;
};

export const createOrchestrator = (config: OrchestratorConfig) => {
  const active = new Map<string, ActiveJob>();

  const availableSlots = () => Math.max(0, config.maxConcurrentAgents - active.size);

  const getActiveJobIds = () => Array.from(active.keys());

  const waitForIdle = async () => {
    await Promise.allSettled(Array.from(active.values()).map((a) => a.promise));
  };

  const processJob = async (job: QueuedJob): Promise<void> => {
    if (active.has(job.jobId)) return;
    if (active.size >= config.maxConcurrentAgents) {
      throw new Error(`No available slots (maxConcurrentAgents=${config.maxConcurrentAgents})`);
    }

    const work = (async () => {
      const startedAt = Date.now();
      config.onProgress?.(toProgress(job.jobId, "starting", "Starting job pipeline"));

      const parsedConfig = agentJobConfigSchema.safeParse(job.config);
      if (!parsedConfig.success) {
        const msg = parsedConfig.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        throw new Error(`Invalid job config: ${msg}`);
      }
      const jobConfig: AgentJobConfig = parsedConfig.data;

      // Resolve repoPath/baseBranch from repositoryId if present.
      // When the job specifies a repositoryId, look it up in the project's
      // additionalRepos config to override repoPath and baseBranch.
      let effectiveRepoPath = jobConfig.repoPath;
      let effectiveBaseBranch = jobConfig.baseBranch;

      if (jobConfig.repositoryId && config.projectConfigs) {
        const projectCfg = job.projectId
          ? config.projectConfigs.find((p) => p.projectId === job.projectId)
          : undefined;

        if (projectCfg?.additionalRepos) {
          const repoEntry = projectCfg.additionalRepos.find(
            (r) => r.repositoryId === jobConfig.repositoryId
          );
          if (repoEntry) {
            effectiveRepoPath = repoEntry.repoPath;
            effectiveBaseBranch = repoEntry.baseBranch ?? projectCfg.baseBranch;
            logger.info(
              { jobId: job.jobId, repositoryId: jobConfig.repositoryId, repoPath: effectiveRepoPath },
              "Resolved additional repo for job"
            );
          } else {
            logger.warn(
              { jobId: job.jobId, repositoryId: jobConfig.repositoryId },
              "repositoryId not found in project additionalRepos, falling back to default repoPath"
            );
          }
        }
      }

      const providerName = inferProvider(job);
      const provider = getProvider(providerName);

      const workItemId = await loadWorkItemForJob(job);
      const apiClient = createApiClient({ apiBaseUrl: config.apiBaseUrl, apiKey: config.apiKey });

      // ── Dependency check ──────────────────────────────────────
      // If the job has a workItemId, check whether its dependencies are satisfied.
      // Blocked jobs are rescheduled with a 5-minute delay (without incrementing retry count).
      if (job.workItemId) {
        const depCheck = await checkWorkItemDependencies(apiClient, job.workItemId);
        if (depCheck.status === "blocked") {
          const delayMs = 5 * 60_000; // 5 minutes
          const availableAt = new Date(Date.now() + delayMs).toISOString();
          logger.info(
            { jobId: job.jobId, workItemId: job.workItemId, blockedBy: depCheck.blockedBy, availableAt },
            `Job blocked by ${depCheck.blockedBy.length} unfinished dependencies, rescheduling in 5min`
          );

          await config.queue.scheduleRetry(job.jobId, {
            retryCount: job.retryCount, // keep the same retry count (don't penalize for dependency waits)
            availableAt,
            error: { message: `Blocked by dependencies: ${depCheck.blockedBy.join(", ")}`, type: "dependency-blocked" },
          });
          return;
        }
      }

      // ── Quota check ──────────────────────────────────────────
      // Verify the organization has available quota for this provider before executing.
      // If quota is exceeded, postpone the job until the reset period ends.
      // Fail-open: if the quota service is unreachable, the job proceeds normally.
      const quotaCheck = await checkQuotaAvailability(apiClient, job.provider);
      if (quotaCheck.status === "quota_exceeded") {
        // If periodEnd is available, schedule retry for that time; otherwise default 1 hour
        const delayMs = quotaCheck.periodEnd
          ? Math.max(new Date(quotaCheck.periodEnd).getTime() - Date.now(), 60_000)
          : 3_600_000;
        const availableAt = new Date(Date.now() + delayMs).toISOString();
        logger.info(
          { jobId: job.jobId, provider: job.provider, reason: quotaCheck.reason, availableAt },
          `Job postponed due to quota: ${quotaCheck.reason ?? "quota exceeded"}`
        );
        await config.queue.scheduleRetry(job.jobId, {
          retryCount: job.retryCount, // don't increment - this is a postpone, not a failure
          availableAt,
          error: { message: quotaCheck.reason ?? "Quota exceeded", type: "quota-exceeded" },
        });
        return;
      }

      const item = await apiClient.getWorkItemDetails(workItemId);
      const taskId = item.taskId ?? job.jobId;
      const branchName = generateBranchName(taskId, item.title);

      // ── Resolve repoUrl (clone-on-demand) ──────────────────────
      // Check job config first, then fall back to project config.
      let effectiveRepoUrl: string | undefined = jobConfig.repoUrl;
      if (!effectiveRepoUrl && config.projectConfigs) {
        const projectCfg = job.projectId
          ? config.projectConfigs.find((p) => p.projectId === job.projectId)
          : undefined;
        if (projectCfg?.repoUrl) {
          effectiveRepoUrl = projectCfg.repoUrl;
        }
      }

      // ── Inject GitHub App installation token into clone URL ──────
      // If a repositoryId is set and the repo URL is an https GitHub URL,
      // fetch a short-lived installation token and embed it so git can clone
      // private repositories without requiring SSH keys on the worker host.
      if (effectiveRepoUrl && jobConfig.repositoryId) {
        try {
          const { token } = await apiClient.getInstallationToken(jobConfig.repositoryId);
          // Convert https://github.com/owner/repo.git
          //      to https://x-access-token:TOKEN@github.com/owner/repo.git
          effectiveRepoUrl = effectiveRepoUrl.replace(
            /^https:\/\/(github\.com\/)/,
            `https://x-access-token:${token}@$1`
          );
          logger.debug(
            { jobId: job.jobId, repositoryId: jobConfig.repositoryId },
            "Injected GitHub App installation token into clone URL"
          );
        } catch (err) {
          logger.warn(
            { jobId: job.jobId, repositoryId: jobConfig.repositoryId, err },
            "Failed to fetch installation token; attempting clone without credentials"
          );
        }
      }

      const isCloneOnDemand = !!effectiveRepoUrl;
      let workspacePath: string;

      if (isCloneOnDemand) {
        // ── Clone-on-demand flow ─────────────────────────────────
        // Clone into an isolated temp directory so parallel jobs never interfere.
        const cloneDir = path.join(os.tmpdir(), "mc-worker-jobs", job.jobId);
        config.onProgress?.(toProgress(job.jobId, "reading", `Cloning repository: ${effectiveRepoUrl?.replace(/x-access-token:[^@]+@/, "x-access-token:***@")}`));
        await cloneRepository(effectiveRepoUrl!, effectiveBaseBranch, cloneDir);

        // Detect existing remote branch or create a new one inside the clone.
        const existingBranch = await findExistingRemoteBranch(cloneDir, taskId);
        if (existingBranch) {
          logger.info(
            { jobId: job.jobId, taskId, existingBranch },
            "Found existing remote branch in clone, reusing"
          );
          const localRef = existingBranch.replace(/^origin\//, "");
          await runGit(["checkout", "-b", localRef, existingBranch], { cwd: cloneDir });
        } else {
          await runGit(["checkout", "-b", branchName, `origin/${effectiveBaseBranch}`], { cwd: cloneDir });
        }

        // Install dependencies so the agent can build/test.
        config.onProgress?.(toProgress(job.jobId, "reading", "Installing dependencies (bun install)"));
        const bunProc = Bun.spawn({
          cmd: ["bun", "install"],
          cwd: cloneDir,
          stdout: "pipe",
          stderr: "pipe",
        });
        const bunExit = await bunProc.exited;
        if (bunExit !== 0) {
          const bunStderr = await new Response(bunProc.stderr).text();
          throw new Error(`bun install failed in clone (exit ${bunExit})${bunStderr ? `\n${bunStderr}` : ""}`);
        }

        workspacePath = cloneDir;
      } else {
        // ── Existing worktree flow (unchanged) ───────────────────
        const existingBranch = await findExistingRemoteBranch(effectiveRepoPath, taskId);
        if (existingBranch) {
          logger.info(
            { jobId: job.jobId, taskId, existingBranch },
            "Found existing remote branch, reusing"
          );
        }

        config.onProgress?.(toProgress(job.jobId, "reading", existingBranch
          ? `Reusing existing branch: ${existingBranch}`
          : `Creating worktree: ${branchName}`));
        workspacePath = await createWorktree(
          effectiveRepoPath,
          branchName,
          effectiveBaseBranch,
          existingBranch ?? undefined
        );
      }

      try {
        try {
          await config.queue.reportRunning(job.jobId, { branchName, worktreePath: workspacePath });
        } catch (reportErr) {
          logger.debug({ jobId: job.jobId, err: reportErr }, "Failed to report running job metadata");
        }

        await ensureGitIdentity(workspacePath);

        const task: AgentTaskInput = {
          workItemId: item.id,
          taskId,
          title: item.title,
          description: item.description ?? "",
          type: item.type as AgentTaskInput["type"],
          priority: item.priority,
          metadata: (item.metadata ?? {}) as Record<string, unknown>,
        };

        const env: AgentEnvironment = {
          repoPath: workspacePath,
          branchName,
          mcpServerUrl: jobConfig.mcpServerUrl,
          mcpApiKey: config.apiKey,
          projectId: jobConfig.projectId,
        };

        // Keep prompt deterministic; providers may re-format it, but we log the intent here.
        void buildImplementationPrompt(task, env);

        config.onProgress?.(toProgress(job.jobId, "implementing", `Executing provider: ${providerName}`));

        // Build provider config, injecting resumeSessionId for retried jobs that have one.
        const effectiveProviderConfig: AgentProviderConfig = {
          ...providerConfigFor(providerName, config),
        };
        if (job.sessionId) {
          effectiveProviderConfig.resumeSessionId = job.sessionId;
        }

        const { result, handle } = await provider.execute(
          task,
          env,
          effectiveProviderConfig,
          (p: AgentProgress) => {
            config.onProgress?.(toProgress(job.jobId, p.phase, p.message));
          }
        );

        // Persist the sessionId via reportRunning so retries can resume the session.
        if (result.sessionId) {
          try {
            await config.queue.reportRunning(job.jobId, { sessionId: result.sessionId });
          } catch (sessionErr) {
            logger.debug({ jobId: job.jobId, err: sessionErr }, "Failed to persist sessionId");
          }
        }

        if (!result.success) {
          throw new Error(result.summary || "Provider execution failed");
        }

        config.onProgress?.(toProgress(job.jobId, "testing", "Committing changes"));

        const commit = await commitChanges(workspacePath, taskId, item.title);
        if (!commit.hasChanges) {
          const completion: QueueAgentJobResult = {
            summary: "No changes to commit (nothing to push / no PR created).",
            filesChanged: [],
            linesAdded: 0,
            linesRemoved: 0,
            cost: result.cost,
            tokensUsed: result.tokens,
          };
          await config.queue.reportCompletion(job.jobId, completion);
          return;
        }

        const commitSha = commit.commitSha ?? "";

        config.onProgress?.(toProgress(job.jobId, "testing", `Pushing branch: ${branchName}`));
        await pushBranch(workspacePath, branchName);

        if (!config.apiBaseUrl || !config.apiKey) {
          throw new Error("Missing MC API config for PR creation (apiBaseUrl/apiKey)");
        }

        config.onProgress?.(toProgress(job.jobId, "testing", "Creating PR"));
        const { owner, repo } = await getOriginRepo(workspacePath);
        const repoFullName = `${owner}/${repo}`;
        const pr = await createPullRequest({
          apiBaseUrl: config.apiBaseUrl,
          apiKey: config.apiKey,
          repoFullName,
          branchName,
          baseBranch: effectiveBaseBranch,
          taskId,
          title: item.title,
          summary: result.summary,
          filesChanged: result.filesChanged,
          workItemId: item.id,
        });

        const stats = await computeCommitStats(workspacePath, commitSha);

        const completion: QueueAgentJobResult = {
          summary: `PR created: ${pr.prUrl}\nCommit: ${commitSha}`,
          filesChanged: stats.filesChanged,
          linesAdded: stats.linesAdded,
          linesRemoved: stats.linesRemoved,
          prUrl: pr.prUrl,
          prNumber: pr.prNumber,
          commitSha,
          cost: result.cost,
          tokensUsed: result.tokens,
        };

        await config.queue.reportCompletion(job.jobId, completion);

        const durationMs = Date.now() - startedAt;
        logger.info(
          { jobId: job.jobId, taskId, provider: providerName, prUrl: pr.prUrl, durationMs },
          "mc-worker job completed"
        );
      } catch (err) {
        const classified = classifyError(err);
        const currentRetryCount = job.retryCount ?? 0;
        const maxRetries = job.maxRetries ?? 2;

        if (classified.retryable && currentRetryCount < maxRetries) {
          const nextRetryCount = currentRetryCount + 1;

          let delayMs: number;
          if (classified.retryAfterMs) {
            // Use the specific delay from the error classification (rate limit / quota).
            delayMs = classified.retryAfterMs;
          } else {
            // Default backoff schedule for generic transient errors.
            const delaysMs = [30_000, 60_000, 120_000];
            delayMs = delaysMs[nextRetryCount - 1] ?? delaysMs[delaysMs.length - 1]!;
          }

          const availableAt = new Date(Date.now() + delayMs).toISOString();

          logger.warn(
            {
              jobId: job.jobId,
              retryCount: nextRetryCount,
              maxRetries,
              delayMs,
              availableAt,
              classified,
            },
            `Job ${job.jobId} failed (${classified.type}), retrying (${nextRetryCount}/${maxRetries}) in ${Math.round(delayMs / 1000)}s`
          );

          await config.queue.scheduleRetry(job.jobId, {
            retryCount: nextRetryCount,
            availableAt,
            error: { message: classified.message, type: classified.type },
          });
          return;
        }

        await config.queue.reportFailure(job.jobId, { message: classified.message, type: classified.type });
        logger.error(
          { jobId: job.jobId, err, classified },
          `Job ${job.jobId} failed permanently: ${classified.message}`
        );
      } finally {
        if (isCloneOnDemand) {
          config.onProgress?.(toProgress(job.jobId, "starting", "Cleaning up clone"));
          await cleanupClone(workspacePath);
        } else {
          config.onProgress?.(toProgress(job.jobId, "starting", "Cleaning up worktree"));
          try {
            await cleanupWorktree(workspacePath, branchName);
          } catch (cleanupErr) {
            logger.warn({ jobId: job.jobId, err: cleanupErr }, "Failed to cleanup worktree");
          }
        }
      }
    })();

    active.set(job.jobId, { promise: work });

    try {
      await work;
    } finally {
      active.delete(job.jobId);
    }
  };

  const processJobs = async (jobs: QueuedJob[]) => {
    const ready = jobs.slice(0, availableSlots());
    await Promise.all(
      ready.map(async (job) => {
        await processJob(job);
      })
    );
  };

  return {
    availableSlots,
    getActiveJobIds,
    waitForIdle,
    processJob,
    processJobs,
  };
};
