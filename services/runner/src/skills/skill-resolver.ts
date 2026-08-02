import type { AlmirantWorkerClient, ClaimedJob, WorkItemDetails } from "@almirant/remote-agent";
import type { ContainerDriver } from "../workspace/container-driver";
import type { RunnerJobEventLogger } from "../observability/job-event-logger";
import {
  augmentSkillContentForRuntime,
  buildRuntimeSkillAugmentation,
} from "./runtime-augmentation";
import type { AgentSelectedSkillReference } from "@almirant/shared";
import { createHash } from "node:crypto";

const WORKSPACE_REPO_PATH = "/workspace/repo";

const SKILL_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CONTENT_HASH_RE = /^[a-f0-9]{64}$/i;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const computeCanonicalSkillContentHash = (content: string): string =>
  createHash("sha256")
    .update(content.replace(/\r\n/g, "\n").trim())
    .digest("hex");

/**
 * Parses the immutable auxiliary-skill snapshot copied into a claimed job.
 *
 * A malformed snapshot is a permanent configuration error. Silently dropping
 * one entry would make a retry execute with a different capability set.
 */
export const parseSelectedSkillReferences = (
  value: unknown,
): AgentSelectedSkillReference[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error("Invalid selected skill snapshot: selectedSkills must be an array");
  }

  const ids = new Set<string>();
  const slugs = new Set<string>();
  return value.map((candidate, index) => {
    if (
      !isRecord(candidate) ||
      typeof candidate.id !== "string" ||
      !UUID_RE.test(candidate.id) ||
      typeof candidate.slug !== "string" ||
      !SKILL_SLUG_RE.test(candidate.slug) ||
      typeof candidate.version !== "number" ||
      !Number.isSafeInteger(candidate.version) ||
      candidate.version < 1 ||
      typeof candidate.contentHash !== "string" ||
      !CONTENT_HASH_RE.test(candidate.contentHash)
    ) {
      throw new Error(
        `Invalid selected skill reference at index ${index}`,
      );
    }
    if (ids.has(candidate.id)) {
      throw new Error(`Duplicate selected skill id: ${candidate.id}`);
    }
    if (slugs.has(candidate.slug)) {
      throw new Error(`Duplicate selected skill slug: ${candidate.slug}`);
    }
    ids.add(candidate.id);
    slugs.add(candidate.slug);
    return {
      id: candidate.id,
      slug: candidate.slug,
      version: candidate.version,
      contentHash: candidate.contentHash.toLowerCase(),
    };
  });
};

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
    expectedVersion?: number;
    expectedContentHash?: string;
    projectId?: string;
    workspaceId?: string;
    containerId: string;
    runtimeType: string;
    eventLogger: RunnerJobEventLogger;
  },
): Promise<{ slug: string; content: string }> => {
  const {
    skillId,
    skillSlug,
    expectedVersion,
    expectedContentHash,
    projectId,
    workspaceId,
    containerId,
    runtimeType,
    eventLogger,
  } = params;

  const identifier = skillId ?? skillSlug ?? "unknown";

  if (!deps.apiBaseUrl || !deps.apiKey) {
    throw new Error(
      `Cannot resolve skill ${identifier} from DB: apiBaseUrl or apiKey not configured on runner`,
    );
  }

  // Use the /resolve endpoint which supports both id and slug lookup with API key auth.
  // Pass workspaceId so the endpoint can scope to the job's org (runners are shared
  // infrastructure and their API key may belong to a different org than the job).
  const resolveUrl = new URL(`${deps.apiBaseUrl.replace(/\/+$/, "")}/api/skills/resolve`);
  if (skillId) resolveUrl.searchParams.set("id", skillId);
  if (skillSlug) resolveUrl.searchParams.set("slug", skillSlug);
  if (expectedVersion !== undefined) {
    resolveUrl.searchParams.set("expectedVersion", String(expectedVersion));
  }
  if (expectedContentHash) {
    resolveUrl.searchParams.set("expectedContentHash", expectedContentHash);
  }
  if (projectId) resolveUrl.searchParams.set("projectId", projectId);
  if (workspaceId) resolveUrl.searchParams.set("workspaceId", workspaceId);

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
    data?: {
      id: string;
      slug: string;
      content: string;
      source?: string;
      version?: number;
      contentHash?: string;
    };
    error?: string;
  };

  if (!envelope.success || !envelope.data?.slug || !envelope.data?.content) {
    throw new Error(
      `Skill ${identifier} API response invalid: ${envelope.error ?? "missing slug or content"}`,
    );
  }

  const { id, slug, content, version, contentHash } = envelope.data;
  if (skillId && id !== skillId) {
    throw new Error(
      `Skill ${identifier} id mismatch: expected ${skillId}, received ${id ?? "missing"}`,
    );
  }
  if (skillSlug && slug !== skillSlug) {
    throw new Error(
      `Skill ${identifier} slug mismatch: expected ${skillSlug}, received ${slug}`,
    );
  }
  if (expectedVersion !== undefined && version !== expectedVersion) {
    throw new Error(
      `Skill ${identifier} version mismatch: expected ${expectedVersion}, received ${version ?? "missing"}`,
    );
  }
  if (
    expectedContentHash &&
    contentHash?.toLowerCase() !== expectedContentHash.toLowerCase()
  ) {
    throw new Error(
      `Skill ${identifier} content hash mismatch: expected ${expectedContentHash}, received ${contentHash ?? "missing"}`,
    );
  }
  if (
    contentHash &&
    computeCanonicalSkillContentHash(content) !== contentHash.toLowerCase()
  ) {
    throw new Error(
      `Skill ${identifier} content bytes and content hash mismatch`,
    );
  }

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

// ---------------------------------------------------------------------------
// materializeSelectedSkills
// ---------------------------------------------------------------------------

/**
 * Materializes pinned auxiliary skills without changing the primary
 * `skillId`/`skillName` used to build the model prompt.
 */
export const materializeSelectedSkills = async (
  deps: SkillResolverDeps,
  params: {
    selectedSkills: AgentSelectedSkillReference[];
    primarySkillId?: string;
    primarySkillSlug?: string;
    projectId?: string;
    workspaceId?: string;
    containerId: string;
    runtimeType: string;
    eventLogger: RunnerJobEventLogger;
  },
): Promise<Array<{ slug: string; content: string }>> => {
  if (params.selectedSkills.length === 0) return [];

  for (const selectedSkill of params.selectedSkills) {
    if (
      selectedSkill.id === params.primarySkillId ||
      selectedSkill.slug === params.primarySkillSlug
    ) {
      throw new Error(
        `Selected auxiliary skill ${selectedSkill.slug} conflicts with the primary skill`,
      );
    }
  }

  const materialized: Array<{ slug: string; content: string }> = [];
  for (const selectedSkill of params.selectedSkills) {
    materialized.push(
      await resolveSkillFromDb(deps, {
        skillId: selectedSkill.id,
        skillSlug: selectedSkill.slug,
        expectedVersion: selectedSkill.version,
        expectedContentHash: selectedSkill.contentHash,
        projectId: params.projectId,
        workspaceId: params.workspaceId,
        containerId: params.containerId,
        runtimeType: params.runtimeType,
        eventLogger: params.eventLogger,
      }),
    );
  }
  return materialized;
};
