/**
 * Completion evaluation logic for agent jobs.
 *
 * Extracted from JobExecutor.handlePostSession() — no logic changes.
 *
 * Handles: loading session events, runner-implement completion validation,
 * failure pattern detection, no-skill-progress detection, session event
 * failure scanning, container OOM detection, late PR creation, and
 * shouldMarkJobAsCompleted / shouldMarkPrReady decisions.
 */

import type {
  AlmirantWorkerClient,
  ClaimedJob,
  SessionEventRecord,
  WorkItemDetails,
} from "@almirant/remote-agent";
import type { ContainerDriver } from "../workspace/container-driver";
import type { RunnerJobEventLogger } from "../observability/job-event-logger";
import type { CreateBranchAndDraftPrResult } from "../delivery/pr-manager";
import { closeDraftPr, createLatePr, markPrReadyForReview, updatePrSummary } from "../delivery/pr-manager";
import type { StreamPublisher } from "@almirant/stream-consumer";
import { nextSequence, publishCanonicalEvent } from "../session/stream-events";
import {
  CANONICAL_SKILL_PROGRESS_EVENT_KINDS,
  RUNNER_IMPLEMENT_COMPLETION_EVENT_KINDS,
  shouldMarkJobAsCompleted,
  shouldMarkPrReady,
  detectKnownFailurePatterns,
  detectSessionEventFailures,
  detectNoSkillProgress,
  extractStructuredSummary,
  validateRunnerImplementCompletion,
  type RunnerImplementCompletionPolicy,
} from "./job-completion-guards";
import { isPromptOnlyIntent, resolveJobIntent } from "./job-intent";
import { resolveJobCodingAgent, retryUpdateJobStatus } from "../shared/job-helpers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionResult = {
  success: boolean;
  summary?: string;
  errorMessage?: string;
  completionState?: "complete" | "incomplete" | "failed";
  incompleteReason?: string;
  missingWorkItemIds?: string[];
  cancelledByUser?: boolean;
  shutdownRequested?: boolean;
  timedOut?: boolean;
  backgroundAgentTimedOut?: boolean;
};

export type CompletionEvaluationDeps = {
  workerClient: AlmirantWorkerClient;
  containerManager: ContainerDriver;
};

export type CompletionEvaluationParams = {
  job: ClaimedJob;
  result: SessionResult;
  skillName: string;
  pushSucceeded: boolean;
  requiresPush: boolean;
  prFirstResult: CreateBranchAndDraftPrResult | null;
  eventLogger: RunnerJobEventLogger;
  startedAtMs: number;
  containerId: string | null;
  extractedBranchName: string | null;
  baseBranch: string;
  workItem?: WorkItemDetails | null;
  injectedEnvRepoUrl?: string;
  streamPublisher?: StreamPublisher;
  webSessionId?: string;
  webWorkspaceId?: string;
  threadId?: string;
  workerId: string;
  apiBaseUrl?: string;
  apiKey?: string;
};

export type CompletionEvaluationResult = {
  jobCompleted: boolean;
  jobStatus: "completed" | "failed" | "incomplete";
  prSummary?: string;
  result: SessionResult;
  prResult: CreateBranchAndDraftPrResult | null;
  /** Return value for re-queue exits (failure pattern / session event failure). */
  earlyReturn?: {
    jobId: string;
    success: false;
    threadId?: string;
    summary?: string;
    errorMessage?: string;
  };
};

type DodReviewCompletionState = {
  completed: boolean;
  approved: boolean;
  incompleted: boolean;
  reviewedAt?: string;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const isDodReviewJob = (job: ClaimedJob, skillName: string): boolean => {
  const config = asRecord(job.config);
  const normalizedSkillName = skillName.toLowerCase();

  return (
    normalizedSkillName === "dod-review" ||
    config?.source === "dod-review" ||
    asRecord(config?.targetConfig)?.dodReview !== undefined
  );
};

const isRunnerImplementationSkill = (skillName: string): boolean => {
  return skillName === "runner-implement" || skillName === "runner-fix-dod";
};

const readDodReviewCompletionState = (
  workItem: WorkItemDetails | null | undefined,
): DodReviewCompletionState => {
  const metadata = asRecord(workItem?.metadata);
  const approved = metadata?.dod_approved === true;
  const incompleted = metadata?.dod_incompleted === true;
  const reviewedAt =
    typeof metadata?.dod_reviewed_at === "string" &&
    metadata.dod_reviewed_at.trim().length > 0
      ? metadata.dod_reviewed_at
      : undefined;

  return {
    approved,
    incompleted,
    reviewedAt,
    completed: !!reviewedAt && approved !== incompleted,
  };
};

// ---------------------------------------------------------------------------
// evaluateCompletion
// ---------------------------------------------------------------------------

/**
 * Evaluates the outcome of an agent session post-push and determines whether
 * the job should be marked as completed or failed.
 *
 * Mutates `params.result` in-place (matching the original inline behaviour).
 */
export async function evaluateCompletion(
  deps: CompletionEvaluationDeps,
  params: CompletionEvaluationParams,
): Promise<CompletionEvaluationResult> {
  const {
    job,
    result,
    skillName,
    pushSucceeded,
    requiresPush,
    prFirstResult,
    eventLogger,
    startedAtMs,
    containerId,
    extractedBranchName,
    baseBranch,
    workItem,
    injectedEnvRepoUrl,
    streamPublisher,
    webSessionId,
    webWorkspaceId,
    threadId,
    workerId,
    apiBaseUrl,
    apiKey,
  } = params;
  const jobCodingAgent = resolveJobCodingAgent(job);
  const isRunnerImplementationJob = isRunnerImplementationSkill(skillName);
  const runnerImplementCompletionPolicy: RunnerImplementCompletionPolicy =
    isRunnerImplementationJob && jobCodingAgent?.toLowerCase() === "opencode"
      ? "opencode-runner-implement"
      : "strict-default";
  let effectivePrResult = prFirstResult ? { ...prFirstResult } : null;
  const isPromptOnlyJob = isPromptOnlyIntent(resolveJobIntent(job));

  // Build session-event-kind list
  const completionSessionEventKinds =
    isRunnerImplementationJob
      ? Array.from(
          new Set([
            ...CANONICAL_SKILL_PROGRESS_EVENT_KINDS,
            ...RUNNER_IMPLEMENT_COMPLETION_EVENT_KINDS,
          ]),
        )
      : [...CANONICAL_SKILL_PROGRESS_EVENT_KINDS];

  let completionSessionEvents: SessionEventRecord[] | undefined;
  let completionSessionEventsLoaded = false;
  let runnerImplementCompletion:
    | ReturnType<typeof validateRunnerImplementCompletion>
    | null = null;
  let runnerImplementTranscript: string | undefined;
  let runnerImplementTranscriptLoaded = false;

  // Hybrid completion snapshot (INV-4): expected leaf tasks vs work items
  // that actually received a complete_ai_task call. Loaded lazily for
  // runner implementation jobs only.
  type RunnerImplementSnapshot = {
    expectedWorkItemIds: string[];
    completedWorkItemIds: string[];
  };
  let runnerImplementSnapshot: RunnerImplementSnapshot | null = null;
  let runnerImplementSnapshotLoaded = false;

  const loadRunnerImplementSnapshot = async (): Promise<RunnerImplementSnapshot | null> => {
    if (runnerImplementSnapshotLoaded) return runnerImplementSnapshot;
    runnerImplementSnapshotLoaded = true;
    if (!isRunnerImplementationJob) return null;

    try {
      const snapshot = await deps.workerClient.getJobCompletionSnapshot(job.id);
      runnerImplementSnapshot = {
        expectedWorkItemIds: snapshot.expectedWorkItemIds ?? [],
        completedWorkItemIds: snapshot.completedWorkItemIds ?? [],
      };
    } catch (error) {
      eventLogger.warn(
        "session",
        "session.completion_snapshot_unavailable",
        "Failed to load job completion snapshot — INV-4 skipped",
        {
          errorMessage:
            error instanceof Error ? error.message : String(error),
        },
      );
      runnerImplementSnapshot = null;
    }
    return runnerImplementSnapshot;
  };

  const loadCompletionSessionEvents = async (): Promise<
    SessionEventRecord[] | undefined
  > => {
    if (completionSessionEventsLoaded) {
      return completionSessionEvents;
    }
    if (
      !result.success &&
      !isRunnerImplementationJob &&
      result.backgroundAgentTimedOut !== true
    ) {
      return undefined;
    }

    completionSessionEventsLoaded = true;
    completionSessionEvents = await deps.workerClient
      .getJobSessionEvents(job.id, {
        kinds: completionSessionEventKinds,
        limit: 2000,
      })
      .catch((error) => {
        eventLogger.warn(
          "session",
          "session.completion_events_unavailable",
          "Failed to load canonical session events for completion guards",
          {
            errorMessage:
              error instanceof Error ? error.message : String(error),
            kinds: completionSessionEventKinds,
          },
        );
        return undefined;
      });

    return completionSessionEvents;
  };

  const loadRunnerImplementTranscript = async (): Promise<string | undefined> => {
    if (runnerImplementTranscriptLoaded) return runnerImplementTranscript;
    runnerImplementTranscriptLoaded = true;
    if (runnerImplementCompletionPolicy !== "opencode-runner-implement") {
      return undefined;
    }

    runnerImplementTranscript = await deps.workerClient
      .getJobTranscript(job.id, { limit: 1000, tail: true })
      .then((response) => response.transcript)
      .catch((error) => {
        eventLogger.warn(
          "session",
          "session.opencode_completion_transcript_unavailable",
          "Failed to load OpenCode transcript for runner-implement completion adapter",
          {
            errorMessage:
              error instanceof Error ? error.message : String(error),
          },
        );
        return undefined;
      });

    return runnerImplementTranscript;
  };

  const recoverRunnerImplementCompletion = async (
    stage: "pre_push" | "post_push",
  ): Promise<void> => {
    if (!isRunnerImplementationJob) return;

    const sessionEvents = await loadCompletionSessionEvents();
    const snapshot = await loadRunnerImplementSnapshot();
    const rawTranscript = await loadRunnerImplementTranscript();
    runnerImplementCompletion = validateRunnerImplementCompletion({
      rawSummary: result.summary,
      rawTranscript,
      completionPolicy: runnerImplementCompletionPolicy,
      backgroundAgentTimedOut: result.backgroundAgentTimedOut,
      sessionEvents,
      expectedWorkItemIds: snapshot?.expectedWorkItemIds,
      completedWorkItemIds: snapshot?.completedWorkItemIds,
      sessionTurnEndedCleanly:
        result.success === true &&
        result.cancelledByUser !== true &&
        result.shutdownRequested !== true &&
        result.timedOut !== true &&
        result.backgroundAgentTimedOut !== true,
    });

    if (
      runnerImplementCompletion.ok &&
      result.backgroundAgentTimedOut === true
    ) {
      eventLogger.warn(
        "session",
        "session.background_agent_timeout_recovered",
        "Ignoring background agent timeout because runner-implement already emitted a completion signal and ## Summary",
        {
          stage,
          observedCompletionSignal: runnerImplementCompletion.observedCompletionSignal,
          pendingTaskIds: runnerImplementCompletion.pendingTaskIds,
          hasStructuredSummary:
            !!runnerImplementCompletion.structuredSummary,
        },
      );
      if (
        runnerImplementCompletion.structuredSummary &&
        (!result.summary || result.summary.trim().length === 0)
      ) {
        result.summary = runnerImplementCompletion.structuredSummary;
      }
      result.success = true;
      result.errorMessage = undefined;
      result.backgroundAgentTimedOut = false;
    }
  };

  // Pre-push recovery for runner-implement background agent timeouts
  if (
    isRunnerImplementationJob &&
    result.backgroundAgentTimedOut === true
  ) {
    await recoverRunnerImplementCompletion("pre_push");
  }

  // Detect known failure patterns in the last assistant message
  const failurePattern = detectKnownFailurePatterns(result.summary ?? "");
  if (failurePattern && result.success) {
    result.success = false;
    result.errorMessage = failurePattern.reason;
    eventLogger.warn("session", "session.known_failure_detected", failurePattern.reason, {
      pattern: failurePattern.pattern,
      retryable: failurePattern.retryable ?? false,
      retryDelayMs: failurePattern.retryDelayMs,
    });

    // Pause retryable quota/rate-limit failures so the job stays active without
    // occupying runner resources until the reset window opens.
    if (failurePattern.retryable && failurePattern.retryDelayMs) {
      const availableAt = new Date(Date.now() + failurePattern.retryDelayMs).toISOString();
      eventLogger.info("session", "session.quota_pause", `Pausing job after ${Math.round(failurePattern.retryDelayMs / 1000)}s cooldown`, {
        pattern: failurePattern.pattern,
        retryDelayMs: failurePattern.retryDelayMs,
        availableAt,
      });

      await retryUpdateJobStatus(deps.workerClient, job.id, {
        status: "paused",
        workerId,
        retryCount: job.retryCount ?? 0,
        availableAt,
        errorMessage: failurePattern.reason,
        errorType: failurePattern.pattern,
      });

      return {
        jobCompleted: false,
        jobStatus: "failed",
        result,
        prResult: effectivePrResult,
        earlyReturn: {
          jobId: job.id,
          success: false,
          threadId,
          summary: result.summary,
          errorMessage: failurePattern.reason,
        },
      };
    }
  }

  completionSessionEvents = await loadCompletionSessionEvents();

  // Detect sessions that completed without any skill progress (e.g. skill not found).
  // Skip for prompt-only jobs — they bypass SKILL.md execution and never emit canonical skill progress events.
  if (result.success && !isPromptOnlyJob) {
    const noProgress = detectNoSkillProgress(
      result.summary ?? "",
      Date.now() - startedAtMs,
      job.retryCount ?? 0,
      completionSessionEvents,
    );
    if (noProgress) {
      result.success = false;
      result.errorMessage = noProgress.reason;
      eventLogger.warn("session", "session.no_skill_progress", noProgress.reason, {
        pattern: noProgress.pattern,
        durationMs: Date.now() - startedAtMs,
      });
    }
  }

  if (isRunnerImplementationJob) {
    await recoverRunnerImplementCompletion("post_push");
    if (!runnerImplementCompletion) {
      const snapshot = await loadRunnerImplementSnapshot();
      runnerImplementCompletion = validateRunnerImplementCompletion({
        rawSummary: result.summary,
        rawTranscript: await loadRunnerImplementTranscript(),
        completionPolicy: runnerImplementCompletionPolicy,
        backgroundAgentTimedOut: result.backgroundAgentTimedOut,
        sessionEvents: completionSessionEvents,
        expectedWorkItemIds: snapshot?.expectedWorkItemIds,
        completedWorkItemIds: snapshot?.completedWorkItemIds,
        sessionTurnEndedCleanly:
          result.success === true &&
          result.cancelledByUser !== true &&
          result.shutdownRequested !== true &&
          result.timedOut !== true &&
          result.backgroundAgentTimedOut !== true,
      });
    }
  }
  const prSummary =
    extractStructuredSummary(result.summary) ??
    runnerImplementCompletion?.structuredSummary;

  if (runnerImplementCompletion && !runnerImplementCompletion.ok) {
    if (runnerImplementCompletion.completionState === "incomplete") {
      result.completionState = "incomplete";
      result.incompleteReason = runnerImplementCompletion.reason;
      result.missingWorkItemIds = runnerImplementCompletion.missingWorkItemIds;
      eventLogger.warn(
        "session",
        "session.runner_implement_contract_incomplete",
        runnerImplementCompletion.reason ?? "runner-implement finished with incomplete task reconciliation",
        {
          backgroundAgentTimedOut: result.backgroundAgentTimedOut === true,
          pendingTaskIds: runnerImplementCompletion.pendingTaskIds,
          missingWorkItemIds: runnerImplementCompletion.missingWorkItemIds,
          observedCompletionSignal: runnerImplementCompletion.observedCompletionSignal,
          sawImplicitCompletionSignal: runnerImplementCompletion.sawImplicitCompletionSignal,
          hasStructuredSummary: !!runnerImplementCompletion.structuredSummary,
        },
      );
    } else {
      result.success = false;
      result.completionState = "failed";
      result.errorMessage = runnerImplementCompletion.reason;
      eventLogger.warn(
        "session",
        "session.runner_implement_contract_failed",
        runnerImplementCompletion.reason ?? "runner-implement did not finish cleanly",
        {
          backgroundAgentTimedOut: result.backgroundAgentTimedOut === true,
          pendingTaskIds: runnerImplementCompletion.pendingTaskIds,
          missingWorkItemIds: runnerImplementCompletion.missingWorkItemIds,
          observedCompletionSignal: runnerImplementCompletion.observedCompletionSignal,
          sawImplicitCompletionSignal: runnerImplementCompletion.sawImplicitCompletionSignal,
          hasStructuredSummary: !!runnerImplementCompletion.structuredSummary,
        },
      );
    }
  }

  // Scan session events for failure patterns from subagent output
  if (!result.success && completionSessionEvents) {
    const sessionFailure = detectSessionEventFailures(completionSessionEvents);
    if (sessionFailure) {
      result.errorMessage = result.errorMessage
        ? `${result.errorMessage} [root cause: ${sessionFailure.reason}]`
        : sessionFailure.reason;

      eventLogger.warn("session", "session.event_failure_detected", sessionFailure.reason, {
        pattern: sessionFailure.pattern,
        retryable: sessionFailure.retryable ?? false,
        retryDelayMs: sessionFailure.retryDelayMs,
      });

      if (sessionFailure.retryable && sessionFailure.retryDelayMs) {
        const availableAt = new Date(Date.now() + sessionFailure.retryDelayMs).toISOString();
        eventLogger.info("session", "session.quota_pause", `Pausing job after ${Math.round(sessionFailure.retryDelayMs / 1000)}s cooldown (from session events)`, {
          pattern: sessionFailure.pattern,
          retryDelayMs: sessionFailure.retryDelayMs,
          availableAt,
        });

        await retryUpdateJobStatus(deps.workerClient, job.id, {
          status: "paused",
          workerId,
          retryCount: job.retryCount ?? 0,
          availableAt,
          errorMessage: sessionFailure.reason,
          errorType: sessionFailure.pattern,
        });

        return {
          jobCompleted: false,
          jobStatus: "failed",
          result,
          prResult: effectivePrResult,
          earlyReturn: {
            jobId: job.id,
            success: false,
            threadId,
            summary: result.summary,
            errorMessage: sessionFailure.reason,
          },
        };
      }
    }
  }

  // Detect container-level OOM kills
  if (!result.success && containerId && !result.errorMessage?.includes('[root cause:')) {
    try {
      const containerState = await deps.containerManager.inspectContainer(containerId);
      if (containerState.oomKilled) {
        result.errorMessage = result.errorMessage
          ? `${result.errorMessage} [root cause: Container was OOM-killed by Docker]`
          : 'Container was OOM-killed by Docker';
        eventLogger.error("session", "container.oom_killed", "Container was OOM-killed by Docker", {
          exitCode: containerState.exitCode,
          containerId,
        });
      }
    } catch {
      // Inspection failure is non-fatal
    }
  }

  if (result.success && isDodReviewJob(job, skillName)) {
    let latestWorkItem: WorkItemDetails | null | undefined = workItem;

    if (workItem?.id) {
      latestWorkItem = await deps.workerClient
        .getWorkItem(workItem.id)
        .catch((error) => {
          eventLogger.warn(
            "finish",
            "dod_review.work_item_reload_failed",
            "Failed to reload work item before validating DoD review completion",
            {
              workItemId: workItem.id,
              errorMessage:
                error instanceof Error ? error.message : String(error),
            },
          );
          return workItem;
        });
    }

    const dodReviewState = readDodReviewCompletionState(latestWorkItem);
    if (!dodReviewState.completed) {
      result.success = false;
      result.completionState = "failed";
      result.errorMessage =
        "DoD review session finished without persisting exactly one DoD result via complete_definition_of_done_review";
      eventLogger.error(
        "finish",
        "dod_review.missing_completion_result",
        "DoD review did not persist an approved/incompleted result",
        {
          workItemId: workItem?.id ?? null,
          approved: dodReviewState.approved,
          incompleted: dodReviewState.incompleted,
          reviewedAt: dodReviewState.reviewedAt ?? null,
        },
      );
    }
  }

  const success = result.success;

  // Reset child tasks stuck in transient AI states when the job failed or
  // when runner-implement finished but did not reconcile every expected task.
  // Incomplete is non-fatal for the job, but stale child task state is still
  // operational debt and must be cleared for retry/continuation.
  const shouldResetStaleChildTasks = !success || result.completionState === "incomplete";
  if (workItem && shouldResetStaleChildTasks) {
    try {
      const { resetIds } = await deps.workerClient.resetStaleChildTasks(workItem.id);
      if (resetIds.length > 0) {
        console.log(`[job:${job.id}] Cleanup: reset ${resetIds.length} stale child tasks`);
        eventLogger.info("cleanup", "reset_stale_tasks", "Reset stale child tasks to safe columns", {
          resetCount: resetIds.length,
          resetIds,
        });
      }
    } catch (cleanupErr) {
      const msg = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
      console.warn(`[job:${job.id}] Stale child cleanup failed (non-fatal): ${msg}`);
    }
  }

  // Late PR creation: if code reached a branch but no PR exists yet, create it now.
  if (pushSucceeded && success && injectedEnvRepoUrl && !effectivePrResult?.prNumber) {
    const branchName = effectivePrResult?.branchName ?? extractedBranchName;
    if (!branchName) {
      result.success = false;
      result.errorMessage = result.errorMessage
        ? `${result.errorMessage} [delivery: push succeeded but no branch metadata was available to create a PR]`
        : "Push succeeded but no branch metadata was available to create a pull request";
      eventLogger.error(
        "pr",
        "pr.missing_branch_after_push",
        "Push succeeded but no branch metadata was available to create a PR",
        { extractedBranchName: extractedBranchName ?? null },
      );
    } else {
      try {
        const latePr = await createLatePr(
          { apiBaseUrl, apiKey, workerId },
          {
            repoUrl: injectedEnvRepoUrl,
            branchName,
            baseBranch: effectivePrResult?.baseBranch ?? baseBranch,
            workItem: workItem ?? null,
            eventLogger,
          },
        );
        if (latePr) {
          effectivePrResult = {
            branchName,
            baseBranch: effectivePrResult?.baseBranch ?? baseBranch,
            prUrl: latePr.prUrl,
            prNumber: latePr.prNumber,
            completedTaskIds: effectivePrResult?.completedTaskIds,
            prCreatedByThisJob: effectivePrResult?.prCreatedByThisJob ?? false,
          };
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        eventLogger.warn("pr", "pr.late_create_failed", "Late PR creation failed (non-fatal)", {
          errorMessage: errMsg,
          branchName,
        });
      }
    }
  }

  const hasPullRequest = !!effectivePrResult?.prNumber;
  if (requiresPush && pushSucceeded && success && !hasPullRequest) {
    const branchName = effectivePrResult?.branchName ?? extractedBranchName ?? "unknown";
    result.success = false;
    result.errorMessage = result.errorMessage
      ? `${result.errorMessage} [delivery: changes were pushed to ${branchName} but no pull request exists]`
      : `Changes were pushed to ${branchName} but no pull request exists`;
    eventLogger.error(
      "pr",
      "pr.required_missing_after_push",
      "Changes were pushed but no pull request exists",
      {
        branchName,
        baseBranch: effectivePrResult?.baseBranch ?? baseBranch,
      },
    );
  }

  let prSummaryUpdated = false;
  if (
    effectivePrResult?.prNumber &&
    pushSucceeded &&
    injectedEnvRepoUrl &&
    prSummary?.trim()
  ) {
    try {
      await updatePrSummary(
        { apiBaseUrl, apiKey, workerId },
        {
          repoUrl: injectedEnvRepoUrl,
          prNumber: effectivePrResult.prNumber,
          eventLogger,
          summary: prSummary,
        },
      );
      prSummaryUpdated = true;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.warn(`[job:${job.id}] PR summary update failed (non-fatal): ${errMsg}`);
      eventLogger.warn("pr", "pr.summary_update_failed", "Failed to update PR summary", {
        errorMessage: errMsg,
        prNumber: effectivePrResult.prNumber,
      });
    }
  }

  // Mark draft PR as ready for review — only if code was actually pushed
  const isPrFirstFlow = !!prFirstResult?.prNumber;
  if (
    effectivePrResult &&
    shouldMarkPrReady({
      sessionSuccess: result.success,
      pushSucceeded,
      prNumber: effectivePrResult.prNumber,
      repoUrl: injectedEnvRepoUrl,
      requiresStructuredSummary: isRunnerImplementationJob,
      hasStructuredSummary: !!prSummary,
      backgroundAgentTimedOut: result.backgroundAgentTimedOut,
      hasPendingAgentTasks: (runnerImplementCompletion?.pendingTaskIds.length ?? 0) > 0,
      observedCompletionSignal: runnerImplementCompletion?.observedCompletionSignal,
      hasMissingWorkItems: (runnerImplementCompletion?.missingWorkItemIds.length ?? 0) > 0,
    })
  ) {
    try {
      await markPrReadyForReview(
        { apiBaseUrl, apiKey, workerId },
        {
          repoUrl: injectedEnvRepoUrl!,
          prNumber: effectivePrResult.prNumber!,
          eventLogger,
          summary: prSummaryUpdated ? undefined : prSummary,
        },
      );
      if (effectivePrResult.prUrl && streamPublisher) {
        await publishCanonicalEvent(streamPublisher, {
          jobId: job.id,
          sessionId: webSessionId ?? "",
          workspaceId: webWorkspaceId ?? "",
          threadId: threadId ?? "",
          timestamp: Date.now(),
          sequenceNumber: nextSequence(),
          event: { kind: "system.info", message: `PR marked as ready for review: ${effectivePrResult.prUrl}` },
        });
      }
    } catch (error) {
      // Non-fatal — PR stays as draft
      const errMsg = error instanceof Error ? error.message : String(error);
      console.warn(`[job:${job.id}] Undraft PR failed (non-fatal): ${errMsg}`);
      eventLogger.warn("pr", "pr.undraft_failed", "Failed to mark PR as ready for review", {
        errorMessage: errMsg,
        prNumber: effectivePrResult.prNumber,
      });
      if (streamPublisher) {
        await publishCanonicalEvent(streamPublisher, {
          jobId: job.id,
          sessionId: webSessionId ?? "",
          workspaceId: webWorkspaceId ?? "",
          threadId: threadId ?? "",
          timestamp: Date.now(),
          sequenceNumber: nextSequence(),
          event: { kind: "system.warn", message: `\u26a0\ufe0f Failed to mark PR as ready for review: ${errMsg}` },
        });
      }
    }
  }

  // Close orphaned draft PR if job failed without pushing and PR was freshly created
  if (
    prFirstResult?.prNumber &&
    prFirstResult.prCreatedByThisJob &&
    !result.success &&
    !pushSucceeded &&
    injectedEnvRepoUrl
  ) {
    try {
      await closeDraftPr(
        { apiBaseUrl, apiKey, workerId },
        {
          repoUrl: injectedEnvRepoUrl,
          prNumber: prFirstResult.prNumber,
          eventLogger,
        },
      );
      eventLogger.info("pr", "pr.orphan_closed", "Closed orphaned draft PR (job failed without push)", {
        prNumber: prFirstResult.prNumber,
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.warn(`[job:${job.id}] Close orphaned draft PR failed (non-fatal): ${errMsg}`);
      eventLogger.warn("pr", "pr.orphan_close_failed", "Failed to close orphaned draft PR (non-fatal)", {
        errorMessage: errMsg,
        prNumber: prFirstResult.prNumber,
      });
    }
  }

  const jobCompleted = shouldMarkJobAsCompleted({
    sessionSuccess: result.success,
    isPrFirstFlow,
    pushSucceeded,
    requiresPush,
    requiresPullRequest: requiresPush,
    hasPullRequest,
    requiresStructuredSummary: isRunnerImplementationJob,
    hasStructuredSummary: !!prSummary,
    backgroundAgentTimedOut: result.backgroundAgentTimedOut,
    hasPendingAgentTasks: (runnerImplementCompletion?.pendingTaskIds.length ?? 0) > 0,
    observedCompletionSignal: runnerImplementCompletion?.observedCompletionSignal,
    hasMissingWorkItems: (runnerImplementCompletion?.missingWorkItemIds.length ?? 0) > 0,
  });

  const jobStatus: "completed" | "failed" | "incomplete" =
    jobCompleted
      ? "completed"
      : success && result.completionState === "incomplete"
        ? "incomplete"
        : "failed";

  if (!jobCompleted && success) {
    eventLogger.warn(
      "finish",
      jobStatus === "incomplete" ? "job.incomplete" : "job.push_lost",
      jobStatus === "incomplete"
        ? "Session succeeded but runner-implement did not reconcile every expected task — marking as incomplete"
        : "Session succeeded but delivery requirements were not satisfied — marking as failed",
      {
        pushSucceeded,
        isPrFirstFlow,
        hasPullRequest,
        requiresPush,
        missingWorkItemIds: runnerImplementCompletion?.missingWorkItemIds ?? [],
      },
    );
  }

  return {
    jobCompleted,
    jobStatus,
    prSummary,
    result,
    prResult: effectivePrResult,
  };
}
