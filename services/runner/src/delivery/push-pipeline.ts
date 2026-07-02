/**
 * Three-phase push pipeline for delivering agent changes to the remote.
 *
 * Extracted from JobExecutor.handlePostSession() — no logic changes.
 *
 * Phase 1: Serve-based push (works through Docker proxy)
 * Phase 2: Direct exec-based push (works without Docker proxy)
 * Phase 3: Archive-overlay push (last resort)
 */

import {
  createOpenCodeSessionManager,
  type AlmirantWorkerClient,
  type OpenCodeSessionManager,
} from "@almirant/remote-agent";
import type { ContainerDriver } from "../workspace/container-driver";
import type { RunnerJobEventLogger } from "../observability/job-event-logger";
import { WORKSPACE_REPO_PATH } from "../workspace/container-spec-builder";
import { collectAndPushChanges } from "./pr-manager";
import type { ClaimedJob } from "@almirant/remote-agent";

const PROTECTED_PUSH_BRANCHES = new Set(["main", "master"]);

export const isProtectedPushBranch = (branch: string): boolean =>
  PROTECTED_PUSH_BRANCHES.has(branch.trim().toLowerCase());

const RUNNER_MANAGED_GIT_RESTORE_PATHS = [
  "CLAUDE.md",
  "AGENTS.md",
  ".mcp.json",
  "opencode.json",
  ".claude",
  ".agents",
] as const;

const RUNNER_MANAGED_GIT_EXCLUDE_PATHSPECS = [
  ":(exclude)CLAUDE.md",
  ":(exclude)AGENTS.md",
  ":(exclude).mcp.json",
  ":(exclude)opencode.json",
  ":(exclude).claude/**",
  ":(exclude).agents/**",
] as const;

const shellQuote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`;

export const buildUnstageRunnerManagedPathsCommand = (): string =>
  `(git reset -q -- ${RUNNER_MANAGED_GIT_RESTORE_PATHS.map(shellQuote).join(" ")} 2>/dev/null || true)`;

export const buildStageUserChangesCommand = (): string =>
  `git add -A -- . ${RUNNER_MANAGED_GIT_EXCLUDE_PATHSPECS.map(shellQuote).join(" ")}`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PushPipelineDeps = {
  containerManager: ContainerDriver;
  workerClient: AlmirantWorkerClient;
};

export type PushPipelineParams = {
  containerId: string;
  job: ClaimedJob;
  repoUrl: string;
  pushBranch: string;
  repositoryId?: string;
  containerServeBaseUrl: string | null;
  eventLogger: RunnerJobEventLogger;
};

// ---------------------------------------------------------------------------
// releasePrimarySession
// ---------------------------------------------------------------------------

export type ReleasePrimarySessionParams = {
  jobId: string;
  sessionId: string;
  containerServeBaseUrl: string | null;
  eventLogger: RunnerJobEventLogger;
  /** Optional override for testing — by default, uses createOpenCodeSessionManager. */
  sessionManagerFactory?: (baseUrl: string) => Pick<OpenCodeSessionManager, "deleteSession">;
};

/**
 * Best-effort deletion of the primary LLM session on the OpenCode serve process.
 *
 * WHY: After `session.idle` fires, the push pipeline may create a second LLM
 * session on the same container to drive a serve-based git push. Two coexisting
 * sessions hold KV caches and message history in memory at the same time,
 * which has been observed to push the 2028 MB container limit into the cgroup
 * OOM-killer (28/33 post-completion OOMs in a 14-day window).
 *
 * Session events for completion evaluation are consumed from the persisted
 * event store (`workerClient.getJobSessionEvents`), not the live serve, so
 * deleting the primary session here is safe.
 *
 * Returns `true` if the deletion succeeded, `false` if it was skipped or
 * failed. Never throws — the push must not be gated on successful teardown.
 */
export async function releasePrimarySession(
  params: ReleasePrimarySessionParams,
): Promise<boolean> {
  const { jobId, sessionId, containerServeBaseUrl, eventLogger, sessionManagerFactory } = params;

  if (!containerServeBaseUrl || !sessionId) {
    return false;
  }

  try {
    const manager = sessionManagerFactory
      ? sessionManagerFactory(containerServeBaseUrl)
      : createOpenCodeSessionManager({
          baseUrl: containerServeBaseUrl,
          timeoutMs: 10_000,
        });
    await manager.deleteSession(sessionId);
    console.log(`[job:${jobId}] Primary session ${sessionId} deleted before push`);
    eventLogger.info(
      "finish",
      "session.primary_deleted",
      "Primary LLM session deleted before push to free KV cache",
      { sessionId },
    );
    return true;
  } catch (deleteErr) {
    const message = deleteErr instanceof Error ? deleteErr.message : String(deleteErr);
    console.warn(`[job:${jobId}] Failed to delete primary session (non-fatal): ${message}`);
    eventLogger.warn(
      "finish",
      "session.primary_delete_failed",
      "Failed to delete primary LLM session before push (non-fatal)",
      { sessionId, errorMessage: message },
    );
    return false;
  }
}

// ---------------------------------------------------------------------------
// extractBranchName
// ---------------------------------------------------------------------------

/**
 * Extract the current branch name from a container.
 *
 * Tries exec first, falls back to archive-based detection (works through proxy).
 * Returns null if both methods fail or the branch is "main".
 */
export async function extractBranchName(
  containerManager: ContainerDriver,
  containerId: string,
): Promise<string | null> {
  try {
    const { exitCode, stdout } = await containerManager.execInContainer(
      containerId,
      ["git", "rev-parse", "--abbrev-ref", "HEAD"],
      "/workspace/repo",
    );
    if (exitCode === 0 && stdout.trim() && stdout.trim() !== "main") {
      return stdout.trim();
    }
  } catch {
    // Exec failed (e.g. Docker proxy doesn't support hijack).
    // Fall back to reading .git/HEAD from the container archive.
    try {
      const headArchive = await containerManager.extractWorkspaceArchive(
        containerId,
        "/workspace/repo/.git/HEAD",
      );
      const { tmpdir } = await import("node:os");
      const { mkdtemp, rm, readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const { createWriteStream } = await import("node:fs");
      const { pipeline } = await import("node:stream/promises");
      const { Readable } = await import("node:stream");

      const tmpDir = await mkdtemp(join(tmpdir(), "almirant-head-"));
      try {
        const headTarPath = join(tmpDir, "head.tar");
        await pipeline(Readable.from(headArchive), createWriteStream(headTarPath));
        await promisify(execFile)("tar", ["xf", headTarPath, "-C", tmpDir]);
        const headContent = await readFile(join(tmpDir, "HEAD"), "utf8");
        const match = headContent.match(/^ref: refs\/heads\/(.+)/);
        if (match?.[1]?.trim() && match[1].trim() !== "main") {
          return match[1].trim();
        }
      } finally {
        await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
      }
    } catch {
      // Both methods failed — branch detection is best-effort
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// executePushPipeline
// ---------------------------------------------------------------------------

/**
 * Execute the three-phase push pipeline to deliver agent changes to the remote.
 *
 * Returns whether the push ultimately succeeded via any of the three phases.
 */
export async function executePushPipeline(
  deps: PushPipelineDeps,
  params: PushPipelineParams,
): Promise<{ pushSucceeded: boolean }> {
  const { containerManager, workerClient } = deps;
  const { containerId, job, repoUrl, pushBranch, repositoryId, containerServeBaseUrl, eventLogger } = params;

  let pushSucceeded = false;

  const containerRunning = await containerManager.isContainerRunning(containerId);
  console.log(`[job:${job.id}] Container running: ${containerRunning}`);

  if (isProtectedPushBranch(pushBranch)) {
    console.warn(`[job:${job.id}] Blocking post-session push to protected branch "${pushBranch}"`);
    eventLogger.warn("push", "push.blocked_protected_branch", "Blocked post-session push to protected branch", {
      branch: pushBranch,
      containerId,
    });
    return { pushSucceeded: false };
  }

  // --- Push Phase 1: Serve-based push (works through Docker proxy) ---
  if (!pushSucceeded && containerRunning && containerServeBaseUrl) {
    try {
      console.log(`[job:${job.id}] Pushing via serve session at ${containerServeBaseUrl}...`);
      const serveSessionManager = createOpenCodeSessionManager({
        baseUrl: containerServeBaseUrl,
        timeoutMs: 30_000,
      });

      const pushSession = await serveSessionManager.createSession({
        cwd: WORKSPACE_REPO_PATH,
      });
      console.log(`[job:${job.id}] Push session created: ${pushSession.id}`);

      const pushPrompt = [
        "Run these bash commands exactly as shown. Do NOT explain or ask — just run them and report raw output.",
        "",
        "```bash",
        "echo '=== GIT STATUS ==='",
        "git status",
        "echo '=== GIT LOG ==='",
        "git log --oneline -5",
        "echo '=== UNPUSHED COMMITS ==='",
        `git log --oneline origin/${pushBranch}..HEAD 2>/dev/null || echo 'No remote tracking branch'`,
        "echo '=== GIT DIFF STAT ==='",
        "git diff --stat",
        "echo '=== UNSTAGE RUNNER-MANAGED FILES ==='",
        buildUnstageRunnerManagedPathsCommand(),
        "echo '=== STAGING ==='",
        buildStageUserChangesCommand(),
        "git diff --cached --stat",
        "echo '=== COMMITTING ==='",
        `git diff --cached --quiet && echo 'Nothing to commit' || git commit -m "chore: apply uncommitted changes from agent session"`,
        "echo '=== PUSHING ==='",
        `git push origin ${pushBranch} 2>&1`,
        "echo \"PUSH_EXIT_CODE=$?\"",
        "```",
      ].join("\n");

      await serveSessionManager.sendPromptAsync(pushSession.id, { prompt: pushPrompt });

      // Wait for the push session to complete by consuming SSE events
      const pushAbort = new AbortController();
      const pushTimeout = setTimeout(() => pushAbort.abort(), 120_000); // 2min timeout
      let pushSessionOutput = "";

      try {
        const eventStream = serveSessionManager.streamSessionEvents(
          undefined,
          pushAbort.signal,
        );

        let idle = false;
        for await (const event of eventStream) {
          if (pushAbort.signal.aborted) break;

          let eventData: Record<string, unknown> = {};
          try { eventData = JSON.parse(event.data); } catch { /* skip */ }
          const eventType = typeof eventData.type === "string" ? eventData.type : event.event ?? "";
          const props = typeof eventData.properties === "object" && eventData.properties !== null
            ? (eventData.properties as Record<string, unknown>)
            : eventData;

          if (eventType === "message.part.delta" && typeof props.delta === "string") {
            pushSessionOutput += props.delta;
          }
          // Also capture tool results (Bash command output)
          if (eventType === "message.part.updated") {
            const part = typeof props.part === "object" && props.part !== null
              ? (props.part as Record<string, unknown>)
              : null;
            if (part && typeof part.text === "string") {
              pushSessionOutput += part.text;
            }
          }
          if (eventType === "session.idle") {
            idle = true;
            break;
          }
        }

        if (idle) {
          // Log the FULL output for debugging
          console.log(`[job:${job.id}] Push session output (${pushSessionOutput.length} chars):\n${pushSessionOutput.slice(-2000)}`);

          // Check for explicit exit code marker from our command
          const exitCodeMatch = pushSessionOutput.match(/PUSH_EXIT_CODE=(\d+)/);
          const gitPushErrors = /fatal:|rejected|failed to push|non-fast-forward|Permission denied/i.test(pushSessionOutput);
          const gitPushSuccess = /->|Everything up-to-date/i.test(pushSessionOutput);

          if (exitCodeMatch && exitCodeMatch[1] === "0") {
            pushSucceeded = true;
            console.log(`[job:${job.id}] Serve-based push confirmed EXIT_CODE=0`);
            eventLogger.info("push", "push.serve_success", "Serve-based push succeeded (EXIT_CODE=0)", { branch: pushBranch });
          } else if (gitPushSuccess && !gitPushErrors) {
            pushSucceeded = true;
            console.log(`[job:${job.id}] Serve-based push succeeded (output pattern match)`);
            eventLogger.info("push", "push.serve_success", "Serve-based push succeeded", { branch: pushBranch });
          } else if (gitPushErrors) {
            console.warn(`[job:${job.id}] Serve-based push had errors: ${pushSessionOutput.slice(-500)}`);
            eventLogger.warn("push", "push.serve_error", "Serve-based push had errors", {
              output: pushSessionOutput.slice(-500),
            });
          } else {
            // No clear indicators — DON'T assume success
            console.warn(`[job:${job.id}] Serve-based push: could not determine outcome`);
            eventLogger.warn("push", "push.serve_unknown", "Could not determine push outcome from output");
          }
        } else {
          console.warn(`[job:${job.id}] Push session timed out or was aborted`);
        }
      } finally {
        clearTimeout(pushTimeout);
      }
    } catch (serveError) {
      const serveErr = serveError instanceof Error ? serveError.message : String(serveError);
      console.warn(`[job:${job.id}] Serve-based push failed: ${serveErr}`);
      eventLogger.warn("push", "push.serve_failed", "Serve-based push failed", { errorMessage: serveErr });
    }
  }

  // --- Push Phase 2: Direct exec-based push (works without Docker proxy) ---
  if (!pushSucceeded && containerRunning) {
    try {
      const unstageManagedPathsCommand = buildUnstageRunnerManagedPathsCommand();
      const stageUserChangesCommand = buildStageUserChangesCommand();
      const pushResult = await containerManager.execInContainer(
        containerId,
        ["sh", "-c", `cd ${WORKSPACE_REPO_PATH} && ${unstageManagedPathsCommand} && ${stageUserChangesCommand} && (git diff --cached --quiet || git commit -m "chore: apply remaining changes") && git push origin ${pushBranch}`],
        WORKSPACE_REPO_PATH,
      );
      if (pushResult.exitCode === 0) {
        pushSucceeded = true;
        console.log(`[job:${job.id}] Exec-based push succeeded`);
      } else {
        console.warn(`[job:${job.id}] Exec-based push failed: ${pushResult.stderr || pushResult.stdout}`);
      }
    } catch (execError) {
      console.warn(`[job:${job.id}] Exec not available: ${execError instanceof Error ? execError.message : String(execError)}`);
    }
  }

  // --- Push Phase 3: Archive-overlay push (last resort) ---
  if (!pushSucceeded && containerRunning) {
    try {
      // Verify workspace exists before attempting archive extraction.
      const workspaceCheck = await containerManager.execInContainer(
        containerId,
        ["test", "-d", WORKSPACE_REPO_PATH],
        "/",
      ).catch(() => ({ exitCode: 1, stdout: "", stderr: "exec failed" }));

      if (workspaceCheck.exitCode !== 0) {
        console.warn(`[job:${job.id}] Workspace ${WORKSPACE_REPO_PATH} not accessible, skipping archive-overlay push`);
        eventLogger.warn("push", "push.workspace_gone", "Workspace not accessible for archive-overlay push", {
          containerId,
        });
      } else {
        console.log(`[job:${job.id}] Falling back to archive-overlay push...`);
        await collectAndPushChanges(
          { workerClient, containerManager },
          {
            containerId,
            job,
            repositoryId,
            repoUrl,
            branch: pushBranch,
            eventLogger,
          },
        );
        pushSucceeded = true;
        console.log(`[job:${job.id}] Archive-overlay push succeeded`);
      }
    } catch (error) {
      const pushErr = error instanceof Error ? error.message : String(error);
      console.warn(`[job:${job.id}] Archive-overlay push failed: ${pushErr}`);
      eventLogger.warn("push", "push.archive_failed", "Archive-overlay push failed", {
        errorMessage: pushErr,
        containerId,
      });
    }
  }

  if (!pushSucceeded) {
    const reason = containerRunning ? "all push methods failed" : "container dead (tmpfs lost)";
    console.error(`[job:${job.id}] PUSH FAILED: ${reason}`);
    eventLogger.warn("push", "push.all_failed", `Push failed: ${reason}`, {
      containerId,
      containerRunning,
    });
  }

  return { pushSucceeded };
}
