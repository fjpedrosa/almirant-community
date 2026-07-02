import {
  createJob,
  getRepositories,
  getOrgPrimaryRepository,
  updateScheduledAgentConfigLastRunAt,
} from "@almirant/database";
import type {
  ScheduledAgentConfigDb,
  CodingAgent,
  AiProvider,
} from "@almirant/database";
import { resolveRuntime } from "@almirant/shared";
import { wsConnectionManager } from "../../../shared/ws/ws-connection-manager";

export interface ExecuteScheduledAgentConfigOptions {
  /** User ID who initiated execution. `null` for unattended (webhook, cron) flows. */
  createdByUserId: string | null;
  /** Optional user-supplied prompt that gets appended to the agent's system prompt. */
  extraUserPrompt?: string | null;
}

/**
 * Compose the final prompt that the runner will execute.
 * The agent's `prompt` field acts as a system prompt; the optional `extraUserPrompt`
 * is appended verbatim under a delimiter so the runner sees one combined string.
 */
const composePrompt = (
  systemPrompt: string | null | undefined,
  extraUserPrompt: string | null | undefined,
): string | null => {
  const sys = systemPrompt?.trim();
  const user = extraUserPrompt?.trim();
  if (!user) return sys ?? null;
  if (!sys) return user;
  return `${sys}\n\n# User input\n${user}`;
};

/**
 * Shared execution path for a scheduled agent config: resolve repo, runtime
 * and create the agent job. Used by:
 *   - POST /scheduled-agents/:id/trigger (manual UI trigger)
 *   - POST /webhooks/agents/:agentId    (incoming webhook trigger)
 *
 * The function:
 *   1. resolves a primary repository (project-scoped, then org-scoped fallback)
 *   2. resolves runtime (provider/codingAgent/model)
 *   3. creates an agent job
 *   4. updates `lastRunAt`
 *   5. broadcasts a `agent-job:status-changed` WebSocket event
 */
export const executeScheduledAgentConfig = async (
  config: ScheduledAgentConfigDb,
  options: ExecuteScheduledAgentConfigOptions,
) => {
  const orgId = config.workspaceId;

  let repoUrl: string | undefined;
  let repositoryId: string | undefined;
  const baseBranch = "main";
  let resolvedProjectId = config.projectId ?? undefined;

  if (resolvedProjectId) {
    try {
      const repos = await getRepositories(orgId, resolvedProjectId);
      const primary = repos[0];
      if (primary) {
        repoUrl = primary.url;
        repositoryId = primary.id;
      }
    } catch {
      // Non-fatal: runner will resolve via API fallback
    }
  }

  if (!repoUrl && orgId) {
    try {
      const orgRepo = await getOrgPrimaryRepository(orgId);
      if (orgRepo) {
        repoUrl = orgRepo.url;
        repositoryId = orgRepo.id;
        resolvedProjectId = resolvedProjectId ?? orgRepo.projectId;
      }
    } catch {
      // Non-fatal: runner will resolve via API fallback
    }
  }

  const resolvedRuntime = resolveRuntime({
    provider: config.provider,
    codingAgent: config.codingAgent ?? undefined,
    model: config.aiModel ?? undefined,
  });

  const finalPrompt = composePrompt(config.prompt, options.extraUserPrompt);

  const job = await createJob({
    projectId: resolvedProjectId ?? null,
    workspaceId: config.workspaceId,
    createdByUserId: options.createdByUserId,
    jobType: config.jobType,
    provider: config.provider,
    priority: "medium",
    config: {
      repoPath: ".",
      baseBranch,
      prompt: finalPrompt ?? undefined,
      projectId: resolvedProjectId,
      scheduledConfigId: config.id,
      scheduledConfigName: config.name,
      source: config.trigger === "webhook" ? "webhook" : "scheduled",
      reasoningLevel: config.reasoningLevel ?? undefined,
      ...(config.mcpServers ? { mcpServers: config.mcpServers } : {}),
      ...(repoUrl ? { repoUrl } : {}),
      ...(repositoryId ? { repositoryId } : {}),
    },
    codingAgent:
      (config.codingAgent as CodingAgent | undefined) ?? resolvedRuntime.codingAgent,
    aiProvider:
      (config.aiProvider as AiProvider | undefined) ?? resolvedRuntime.aiProvider,
    model: config.aiModel ?? resolvedRuntime.model,
    prompt: finalPrompt,
    promptTemplate: null,
    triggerType: "event",
    interactive: false,
  });

  await updateScheduledAgentConfigLastRunAt(config.id);

  wsConnectionManager.broadcastToWorkspace(orgId, {
    type: "agent-job:status-changed",
    payload: {
      jobId: job.id,
      status: job.status,
      workItemId: job.workItemId ?? null,
      planningSessionId: job.planningSessionId ?? null,
    },
  });

  return job;
};
