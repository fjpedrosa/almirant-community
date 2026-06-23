import { loadConfig } from "./config.js";
import { ensureProviderKeysInEnv } from "./provider-keys.js";
import { createQueueAdapter } from "./queue/index.js";
import { createOrchestrator } from "./orchestrator.js";
import { createJob, getActiveJobForWorkItem, db, workItems, eq } from "@almirant/database";

const findWorkItemByTaskId = async (taskId: string) => {
  const [row] = await db
    .select({
      id: workItems.id,
      projectId: workItems.projectId,
      boardId: workItems.boardId,
      title: workItems.title,
    })
    .from(workItems)
    .where(eq(workItems.taskId, taskId))
    .limit(1);
  return row ?? null;
};

export const runTaskId = async (taskId: string): Promise<boolean> => {
  const cfg = await loadConfig();
  const providerKeys = await ensureProviderKeysInEnv(cfg).catch(() => ({
    anthropicApiKey: cfg.anthropicApiKey,
    openaiApiKey: cfg.openaiApiKey,
  }));

  const queue = createQueueAdapter({
    apiBaseUrl: cfg.apiUrl,
    apiKey: cfg.apiKey,
    workerId: cfg.workerId,
    maxClaimCount: 1,
    redisUrl: cfg.redisUrl,
  });

  const orchestrator = createOrchestrator({
    workerId: cfg.workerId,
    maxConcurrentAgents: 1,
    queue,
    apiBaseUrl: cfg.apiUrl,
    apiKey: cfg.apiKey,
    providers: {
      claudeCode: { apiKey: providerKeys.anthropicApiKey },
      codex: { apiKey: providerKeys.openaiApiKey },
    },
    onProgress: (p) => {
      // One-shot runner: keep progress readable in console.
      // Example: [jobId][implementing] Status: working
      console.log(`[${p.jobId}][${p.phase}] ${p.message}`);
    },
    projectConfigs: cfg.projects,
  });

  const item = await findWorkItemByTaskId(taskId);
  if (!item) {
    console.error(`mc-worker run: work item not found for taskId ${taskId}`);
    return false;
  }

  const projectId = item.projectId ?? undefined;
  const projectCfg = projectId ? cfg.projects.find((p) => p.projectId === projectId) : undefined;
  if (!projectCfg) {
    console.error(
      `mc-worker run: no project config for work item projectId=${projectId ?? "(null)"}.\n` +
        `Add it to mc-worker.json projects[] (projectId/repoPath/baseBranch).`
    );
    return false;
  }

  const existing = await getActiveJobForWorkItem(item.id);
  const provider = (cfg.providers[0] ?? "claude-code") as "claude-code" | "codex";

  const job = existing
    ? existing
    : await createJob({
        projectId: projectId ?? null,
        workItemId: item.id,
        boardId: item.boardId,
        provider,
        priority: "medium",
        config: {
          repoPath: projectCfg.repoPath,
          baseBranch: projectCfg.baseBranch,
          mcpServerUrl: `${cfg.apiUrl.replace(/\/+$/, "")}/mcp`,
          projectId,
        },
      });

  await queue.start();
  try {
    await orchestrator.processJob({
      jobId: job.id,
      workItemId: job.workItemId ?? null,
      projectId: job.projectId ?? null,
      boardId: job.boardId ?? null,
      provider: job.provider,
      priority: job.priority,
      retryCount: job.retryCount ?? 0,
      maxRetries: job.maxRetries ?? 2,
      availableAt: job.availableAt ? job.availableAt.toISOString() : null,
      config: ((job.config ?? {}) as unknown) as Record<string, unknown>,
    });
    return true;
  } catch (err) {
    console.error(`mc-worker run: failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  } finally {
    await queue.stop();
  }
};
