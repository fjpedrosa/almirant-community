import type { AlmirantWorkerClient, ClaimedJob, WorkItemDetails } from "@almirant/remote-agent";
import type { ContainerDriver } from "../workspace/container-driver";
import type { RunnerJobEventLogger } from "../observability/job-event-logger";
import {
  augmentSkillContentForRuntime,
  buildRuntimeSkillAugmentation,
} from "./runtime-augmentation";

const WORKSPACE_REPO_PATH = "/workspace/repo";

// ---------------------------------------------------------------------------
// Dependency injection type
// ---------------------------------------------------------------------------

export type SkillResolverDeps = {
  workerClient: AlmirantWorkerClient;
  containerManager: ContainerDriver;
  apiBaseUrl?: string;
  apiKey?: string;
};

// ---------------------------------------------------------------------------
// resolveWorkItem
// ---------------------------------------------------------------------------

/**
 * Fetches work item details from the API for the given job.
 * Returns `null` when the job has no `workItemId` or the fetch fails.
 */
export const resolveWorkItem = async (
  deps: SkillResolverDeps,
  job: ClaimedJob,
): Promise<WorkItemDetails | null> => {
  if (!job.workItemId) {
    return null;
  }

  try {
    return await deps.workerClient.getWorkItem(job.workItemId);
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// augmentWorkspaceSkillForRuntime
// ---------------------------------------------------------------------------

/**
 * Reads a skill file from the container and applies runtime-specific
 * augmentations in-place. Failures are logged as warnings — the method
 * never throws so the caller can always continue.
 */
export const augmentWorkspaceSkillForRuntime = async (
  deps: SkillResolverDeps,
  params: {
    containerId: string;
    skillName: string;
    runtimeType: string;
    eventLogger: RunnerJobEventLogger;
  },
): Promise<void> => {
  const { containerId, skillName, runtimeType, eventLogger } = params;
  const augmentation = buildRuntimeSkillAugmentation({ skillName, runtimeType });
  if (!augmentation) return;

  const skillPath = `${WORKSPACE_REPO_PATH}/.claude/skills/${skillName}/SKILL.md`;

  try {
    const { exitCode, stdout } = await deps.containerManager.execInContainer(
      containerId,
      ["cat", skillPath],
      WORKSPACE_REPO_PATH,
    );

    if (exitCode !== 0 || !stdout.trim()) {
      eventLogger.warn("skills", "skill.runtime_augment_skipped", `Could not read skill "${skillName}" for runtime augmentation`, {
        skillName,
        runtimeType,
        skillPath,
      });
      return;
    }

    const augmented = augmentSkillContentForRuntime({
      skillName,
      runtimeType,
      content: stdout,
    });

    if (!augmented.applied) return;

    await deps.containerManager.writeFileViaExec(containerId, skillPath, augmented.content);
    eventLogger.info("skills", "skill.runtime_augmented", `Skill "${skillName}" augmented for ${runtimeType} runtime`, {
      skillName,
      runtimeType,
      skillPath,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    eventLogger.warn("skills", "skill.runtime_augment_failed", `Failed to augment skill "${skillName}" for ${runtimeType}: ${msg}`, {
      skillName,
      runtimeType,
      skillPath,
    });
  }
};

// ---------------------------------------------------------------------------
// resolveSkillFromDb
// ---------------------------------------------------------------------------

/**
 * Fetches a skill definition from the Almirant API by ID and writes
 * its content as SKILL.md into the container at the provider-appropriate path.
 *
 * Returns the resolved skill slug and content, or null if skillId is not set.
 * Throws if the API call fails so the job can be failed with a descriptive error.
 */
export const resolveSkillFromDb = async (
  deps: SkillResolverDeps,
  params: {
    skillId?: string;
    skillSlug?: string;
    projectId?: string;
    organizationId?: string;
    containerId: string;
    runtimeType: string;
    eventLogger: RunnerJobEventLogger;
  },
): Promise<{ slug: string; content: string }> => {
  const { skillId, skillSlug, projectId, organizationId, containerId, runtimeType, eventLogger } = params;

  const identifier = skillId ?? skillSlug ?? "unknown";

  if (!deps.apiBaseUrl || !deps.apiKey) {
    throw new Error(
      `Cannot resolve skill ${identifier} from DB: apiBaseUrl or apiKey not configured on runner`,
    );
  }

  // Use the /resolve endpoint which supports both id and slug lookup with API key auth.
  // Pass organizationId so the endpoint can scope to the job's org (runners are shared
  // infrastructure and their API key may belong to a different org than the job).
  const resolveUrl = new URL(`${deps.apiBaseUrl.replace(/\/+$/, "")}/api/skills/resolve`);
  if (skillId) resolveUrl.searchParams.set("id", skillId);
  if (skillSlug) resolveUrl.searchParams.set("slug", skillSlug);
  if (projectId) resolveUrl.searchParams.set("projectId", projectId);
  if (organizationId) resolveUrl.searchParams.set("organizationId", organizationId);

  eventLogger.info("skills", "skill.db_fetch_start", `Fetching skill ${identifier} from API`, { skillId: skillId ?? null, skillSlug: skillSlug ?? null });

  const res = await fetch(resolveUrl.toString(), {
    headers: { Authorization: `Bearer ${deps.apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Failed to fetch skill ${identifier} from API: HTTP ${res.status} — ${body.slice(0, 300)}`,
    );
  }

  const envelope = (await res.json()) as {
    success: boolean;
    data?: { id: string; slug: string; content: string; source?: string };
    error?: string;
  };

  if (!envelope.success || !envelope.data?.slug || !envelope.data?.content) {
    throw new Error(
      `Skill ${identifier} API response invalid: ${envelope.error ?? "missing slug or content"}`,
    );
  }

  const { slug, content } = envelope.data;

  // Determine the target path based on the runtime/provider
  const isClaudeCodeRuntime = runtimeType === "claude-shim";
  const skillDir = isClaudeCodeRuntime
    ? `${WORKSPACE_REPO_PATH}/.claude/skills/${slug}`
    : `${WORKSPACE_REPO_PATH}/.agents/skills/${slug}`;
  const skillFilePath = `${skillDir}/SKILL.md`;

  // Create directory and write file
  await deps.containerManager.execInContainer(
    containerId,
    ["mkdir", "-p", skillDir],
    WORKSPACE_REPO_PATH,
  );
  await deps.containerManager.writeFileViaExec(containerId, skillFilePath, content);

  // For runtimes that support both paths (e.g. codex uses .agents/ but
  // Claude Code skill validation checks .claude/), write to both locations
  // so the validation step always passes.
  if (!isClaudeCodeRuntime) {
    const claudeSkillDir = `${WORKSPACE_REPO_PATH}/.claude/skills/${slug}`;
    const claudeSkillPath = `${claudeSkillDir}/SKILL.md`;
    await deps.containerManager.execInContainer(
      containerId,
      ["mkdir", "-p", claudeSkillDir],
      WORKSPACE_REPO_PATH,
    );
    await deps.containerManager.writeFileViaExec(containerId, claudeSkillPath, content);
  }

  eventLogger.info("skills", "skill.db_injected", `Skill "${slug}" (${identifier}) injected into container`, {
    skillId: skillId ?? null,
    skillSlug: skillSlug ?? null,
    slug,
    contentLength: content.length,
    skillFilePath,
  });

  return { slug, content };
};
