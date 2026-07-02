// ---------------------------------------------------------------------------
// Session runner
//
// Extracted from JobExecutor.runServeSession().
// Pure function — no class dependency, all external calls via deps.
// ---------------------------------------------------------------------------

import {
  createOpenCodeSessionManager,
  createBidirectionalRelay,
  type AlmirantWorkerClient,
  type ClaimedJob,
  type WorkItemDetails,
  type BidirectionalRelay,
} from "@almirant/remote-agent";
import type { StreamPublisher } from "@almirant/stream-consumer";
import {
  nextSequence,
  createStreamChannelAdapter,
  publishCanonicalEvent,
} from "./stream-events";
import { buildSkillValidationCanonicalEvents } from "./skill-validation-events";
import { consumeSseEvents, type EventConsumerDeps } from "./event-consumer";
import type { QuotaPauseRequest } from "../shared/quota-pause";
import {
  buildPlanningPrompt,
  shouldInlinePlanningSkillContent,
} from "./planning-prompt";
import type { ContainerDriver } from "../workspace/container-driver";
import { WORKSPACE_REPO_PATH } from "../workspace/container-spec-builder";
import { startTmpfsWatcher } from "../observability/resource-monitor";
import type { RunnerJobEventLogger } from "../observability/job-event-logger";
import type { RuntimeConfig, RuntimeExecutor } from "../shared/types";
import { normalizeJobConfig, buildRecoveryContext, resolveJobProjectId } from "../shared/job-helpers";
import { augmentSkillContentForRuntime } from "../skills/runtime-augmentation";
import { DEFAULT_PRE_SESSION_TIMEOUT_MS, withPhaseTimeout } from "../shared/timeout";
import {
  augmentWorkspaceSkillForRuntime as augmentWorkspaceSkillForRuntimeFn,
  resolveSkillFromDb as resolveSkillFromDbFn,
  type SkillResolverDeps,
} from "../skills/skill-resolver";
import { resolveJobIntent, isPromptOnlyIntent } from "../orchestration/job-intent";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Dependency injection type
// ---------------------------------------------------------------------------

export type SessionRunnerDeps = {
  workerClient: AlmirantWorkerClient;
  containerManager: ContainerDriver;
  config: {
    apiBaseUrl?: string;
    apiKey?: string;
    platformConfigPath?: string;
    webOutputEnabled?: boolean;
    overallTimeoutMs?: number;
    effortPointDurationMs?: number;
    preSessionTimeoutMs?: number;
  };
};

// ---------------------------------------------------------------------------
// runServeSession
// ---------------------------------------------------------------------------

export async function runServeSession(
  deps: SessionRunnerDeps,
  params: {
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
  },
): Promise<{
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
  pausedForQuota?: QuotaPauseRequest;
}> {
  const { baseUrl, containerId, job, workItem, eventLogger, streamPublisher, threadId, resolvedModel, completedTaskIds, webSessionId, webWorkspaceId, runtimeConfig, runtimeExecutor } = params;

  const sessionManager = createOpenCodeSessionManager({
    baseUrl,
    timeoutMs: 30_000,
  });

  // Build the initial prompt from job config
  const config = normalizeJobConfig(job);
  const intent = resolveJobIntent(job);
  const isPromptOnly = isPromptOnlyIntent(intent);
  let skillName = intent.promptTemplate ?? (isPromptOnly ? "" : "implement");
  const isPlanningSkill = intent.interactive;

  // Create the session inside the repository cloned within the isolated container.
  // Pass the resolved model so that each shim (claude/codex/opencode) uses the
  // model configured in the workspace, not the provider default.
  // For planning jobs, enable interactive mode so the shim keeps the process
  // alive between turns instead of respawning for each prompt.
  const sessionCreateTimeoutMs = Math.min(
    deps.config.preSessionTimeoutMs ?? DEFAULT_PRE_SESSION_TIMEOUT_MS,
    60_000,
  );
  eventLogger.info("session", "session.create_start", "Creating session", {
    cwd: WORKSPACE_REPO_PATH,
    interactive: isPlanningSkill,
    timeoutMs: sessionCreateTimeoutMs,
  });
  const session = await withPhaseTimeout(
    sessionManager.createSession({
      cwd: WORKSPACE_REPO_PATH,
      ...(resolvedModel ? { model: resolvedModel } : {}),
      ...(isPlanningSkill ? { metadata: { interactive: true } } : {}),
    }),
    {
      phase: "session.create",
      timeoutMs: sessionCreateTimeoutMs,
      onTimeout: (error) => {
        eventLogger.error("session", "session.create_timeout", "Session creation timed out", {
          phase: error.phase,
          timeoutMs: error.timeoutMs,
          cwd: WORKSPACE_REPO_PATH,
        });
      },
    },
  );
  console.log(`[job:${job.id}] Session created: ${session.id}${isPlanningSkill ? " (interactive)" : ""}`);
  eventLogger.info("session", "session.created", "Session created", {
    sessionId: session.id,
    cwd: WORKSPACE_REPO_PATH,
    interactive: isPlanningSkill,
  });

  // Start tmpfs watcher for disk space monitoring
  const tmpfsWatcher = containerId
    ? startTmpfsWatcher(deps.containerManager, containerId, job.id, eventLogger)
    : null;

  const isValidationSkill =
    job.jobType === "validation" ||
    /validate/i.test(skillName);
  const taskId = workItem?.taskId ?? "";

  // --- Resolve skill from DB via API (A-1464) ---
  const jobSkillId = !isPromptOnly && typeof config.skillId === "string" ? config.skillId : undefined;
  const jobProjectId = resolveJobProjectId(job);
  let dbSkillContent: string | null = null;
  const canResolveFromDb = containerId && deps.config.apiBaseUrl && deps.config.apiKey;

  // Build skill resolver deps for the standalone functions
  const skillResolverDeps: SkillResolverDeps = {
    workerClient: deps.workerClient,
    containerManager: deps.containerManager,
    apiBaseUrl: deps.config.apiBaseUrl,
    apiKey: deps.config.apiKey,
  };

  if (canResolveFromDb && (jobSkillId || skillName)) {
    // Check if skill already exists in the container (from repo clone or platform injection)
    let skillExistsInContainer = false;
    if (!jobSkillId) {
      try {
        const checkPath = `${WORKSPACE_REPO_PATH}/.claude/skills/${skillName}/SKILL.md`;
        const check = await deps.containerManager.execInContainer(
          containerId,
          ["test", "-f", checkPath],
          WORKSPACE_REPO_PATH,
        );
        skillExistsInContainer = check.exitCode === 0;
      } catch {
        // Best-effort check
      }
    }

    // Only resolve from DB if:
    // 1. We have an explicit skillId (always resolve to get latest content), OR
    // 2. The skill doesn't exist in the container (needs to be fetched)
    if (jobSkillId || !skillExistsInContainer) {
      try {
        const resolved = await resolveSkillFromDbFn(skillResolverDeps, {
          skillId: jobSkillId,
          skillSlug: skillName,
          projectId: jobProjectId,
          workspaceId: job.workspaceId ?? undefined,
          containerId,
          runtimeType: runtimeConfig.type,
          eventLogger,
        });
        // Override skillName with the DB-resolved slug so prompt and validation
        // use the canonical name from the database.
        skillName = resolved.slug;
        dbSkillContent = resolved.content;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (jobSkillId) {
          // Explicit skillId — hard failure
          eventLogger.error("skills", "skill.db_fetch_failed", `Failed to resolve skill from DB: ${msg}`, { skillId: jobSkillId });
          throw new Error(`Skill resolution from DB failed for skillId=${jobSkillId}: ${msg}`);
        }
        // Slug-based fallback — soft failure (skill might be a platform skill)
        eventLogger.info("skills", "skill.db_slug_miss", `Skill "${skillName}" not found in DB (may be a platform skill): ${msg}`, { skillName });
      }
    }
  }

  const promptLocale = typeof config.locale === 'string' ? config.locale : 'es';
  const previousJobRecoveryContext = config.previousJobId && typeof config.previousJobId === "string"
    ? await buildRecoveryContext(deps.workerClient, config.previousJobId)
    : null;
  const planningUserMessage = typeof config.userMessage === "string"
    ? config.userMessage
    : "";
  const planningSeedIds = Array.isArray(config.seedIds)
    ? (config.seedIds as unknown[]).filter(
        (id): id is string => typeof id === "string",
      )
    : [];
  const planningConversationHistory = Array.isArray(config.conversationHistory)
    ? (config.conversationHistory as Array<{ role: unknown; content: unknown }>).filter(
        (message): message is { role: string; content: string } =>
          typeof message.role === "string" && typeof message.content === "string",
      )
    : [];
  const planningSessionRecoveryContext =
    typeof config.recoveryContext === "string" ? config.recoveryContext : null;

  // Planning prompts normally use inline skill content for non-Claude runtimes.
  // Claude also needs the inline path once there is real prompt context because
  // `/skill <args>` can drop the appended request before the skill sees it.
  const isCodexRuntime = runtimeConfig.type === "codex-shim";
  const inlinePlanningSkillContent = isPlanningSkill
    && shouldInlinePlanningSkillContent(runtimeConfig.type, {
      userMessage: planningUserMessage,
      seedIds: planningSeedIds,
      sessionRecoveryContext: planningSessionRecoveryContext,
      previousJobRecoveryContext,
      conversationHistory: planningConversationHistory,
    });
  let skillContent: string | null = dbSkillContent;
  if (
    !skillContent
    && deps.config.platformConfigPath
    && (isCodexRuntime || inlinePlanningSkillContent)
  ) {
    const skillPath = join(deps.config.platformConfigPath, ".claude/skills", skillName, "SKILL.md");
    skillContent = await readFile(skillPath, "utf-8").catch(() => null);
  }

  if (skillContent) {
    const augmented = augmentSkillContentForRuntime({
      skillName,
      runtimeExecutor,
      content: skillContent,
    });
    skillContent = augmented.content;
    if (augmented.applied) {
      eventLogger.info("skills", "skill.runtime_augmented", `Skill "${skillName}" augmented for ${runtimeConfig.type} runtime`, {
        skillName,
        runtimeType: runtimeConfig.type,
        source: dbSkillContent ? "db" : "platform-config",
      });
    }
  }

  if (containerId) {
    await augmentWorkspaceSkillForRuntimeFn(skillResolverDeps, {
      containerId,
      skillName,
      runtimeType: runtimeConfig.type,
      eventLogger,
    });
  }

  let prompt: string;
  if (isPlanningSkill) {
    prompt = buildPlanningPrompt({
      runtimeType: runtimeConfig.type,
      skillName,
      skillContent: inlinePlanningSkillContent ? skillContent : null,
      userMessage: planningUserMessage,
      promptLocale,
      seedIds: planningSeedIds,
      sessionRecoveryContext: planningSessionRecoveryContext,
      previousJobRecoveryContext,
      conversationHistory: planningConversationHistory,
    });
  } else {
    const skillArgs = intent.prompt?.trim() || taskId || "";
    if (isPromptOnly && intent.prompt) {
      // Prompt-only job (e.g. scheduled agent with freeform prompt) — no skill slash command
      prompt = intent.prompt;
    } else if (isCodexRuntime) {
      prompt = skillContent
        ? `<skill name="${skillName}">\n${skillContent}\n</skill>\n\n${skillArgs}`.trim()
        : skillArgs;
    } else {
      prompt = skillArgs ? `/${skillName} ${skillArgs}` : `/${skillName}`;
    }

    const langMap: Record<string, string> = { en: 'English', es: 'Spanish' };
    const langName = langMap[promptLocale] ?? langMap.es!;
    prompt = `IMPORTANT: You MUST respond in ${langName}. All user-facing text (summaries, descriptions, comments, PR bodies, commit messages, progress updates) must be in ${langName}.\n\n${prompt}`;

    // For retry scenarios, inject already-completed task IDs so the agent skips them
    if (completedTaskIds && completedTaskIds.length > 0) {
      prompt += `\n\nIMPORTANT: This is a RETRY. The following tasks were already completed in previous runs on this branch and should be SKIPPED:\n${completedTaskIds.map((id) => `- ${id}`).join("\n")}\n\nOnly implement tasks NOT in this list.`;
      eventLogger.info("session", "prompt.retry_enriched", "Prompt enriched with completed task IDs for retry", {
        completedTaskIds,
      });
    }

    if (previousJobRecoveryContext) {
      prompt = `${previousJobRecoveryContext}\n\n---\n\n${prompt}`;
      eventLogger.info("session", "prompt.recovery_injected", "Recovery context injected from previous job", {
        previousJobId: config.previousJobId,
      });
    }
  }

  if (isPlanningSkill && previousJobRecoveryContext) {
    eventLogger.info("session", "prompt.recovery_injected", "Recovery context injected from previous job", {
      previousJobId: config.previousJobId,
    });
  }

  // Setup BidirectionalRelay for Q&A via backend interactions API
  let relay: BidirectionalRelay | undefined;
  if (streamPublisher && threadId) {
    const streamAdapter = createStreamChannelAdapter({
      streamPublisher,
      jobId: job.id,
      threadId,
      sessionId: webSessionId ?? "",
      workspaceId: webWorkspaceId ?? "",
    });

    relay = createBidirectionalRelay({
      channelAdapter: streamAdapter,
      runtime: {
        sendPrompt: (sid, input) => sessionManager.sendPromptAsync(sid, input),
      },
      threadId,
      sessionId: session.id,
      workerClient: deps.workerClient,
      jobId: job.id,
    });
  }

  // Validate that the target skill exists in the workspace before sending prompt
  if (containerId && skillName) {
    const skillPath = `.claude/skills/${skillName}/SKILL.md`;
    try {
      const skillCheck = await deps.containerManager.execInContainer(
        containerId,
        ["test", "-f", skillPath],
        WORKSPACE_REPO_PATH,
      );
      if (skillCheck.exitCode !== 0) {
        eventLogger.error("skills", "skill.not_found", `Skill "${skillName}" not found at ${skillPath}`, { skillName, skillPath });
        throw new Error(`Skill "${skillName}" not found in workspace at ${skillPath}. Platform injection may have failed.`);
      }
      eventLogger.info("skills", "skill.validated", `Skill "${skillName}" found in workspace`, { skillName });
      for (const canonicalEvent of buildSkillValidationCanonicalEvents({
        jobId: job.id,
        threadId,
        webSessionId,
        webWorkspaceId,
        skillName,
        nextSequence,
      })) {
        await publishCanonicalEvent(streamPublisher, canonicalEvent);
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("not found in workspace")) throw err;
      // exec failure itself — log but don't block
      const msg = err instanceof Error ? err.message : String(err);
      eventLogger.warn("skills", "skill.validation_error", `Could not verify skill "${skillName}": ${msg}`);
    }
  }

  // Build deps for consumeSseEvents
  const eventConsumerDeps: EventConsumerDeps = {
    workerClient: deps.workerClient,
    containerManager: deps.containerManager,
    config: {
      overallTimeoutMs: deps.config.overallTimeoutMs,
      effortPointDurationMs: deps.config.effortPointDurationMs,
      webOutputEnabled: deps.config.webOutputEnabled,
    },
  };

  // Start SSE subscription BEFORE sending the prompt so we don't miss events
  const result = await consumeSseEvents(eventConsumerDeps, {
    sessionManager,
    sessionId: session.id,
    jobId: job.id,
    isPlanningJob: isPlanningSkill,
    eventLogger,
    relay,
    streamPublisher,
    threadId,
    estimatedHours: workItem?.estimatedHours,
    webSessionId,
    webWorkspaceId,
    tmpfsWatcher,
    onStreamReady: async () => {
      // Send the initial prompt once the SSE stream is connected
      await sessionManager.sendPromptAsync(session.id, { prompt });
      console.log(`[job:${job.id}] Prompt sent: ${prompt}`);
      eventLogger.info("session", "prompt.sent", "Initial prompt sent", {
        sessionId: session.id,
        prompt,
      });

      await publishCanonicalEvent(streamPublisher, {
        jobId: job.id,
        sessionId: webSessionId ?? "",
        workspaceId: webWorkspaceId ?? "",
        threadId: threadId ?? "",
        timestamp: Date.now(),
        sequenceNumber: nextSequence(),
        event: { kind: "system.info", message: `Prompt sent: \`${prompt}\`` },
      });
    },
  });

  relay?.stop();

  return result;
}
