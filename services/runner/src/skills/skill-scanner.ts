import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import type { ContainerDriver } from "../workspace/container-driver";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScannedSkill = {
  name: string;
  slug: string;
  content: string;
  contentHash: string;
  sizeBytes: number;
  sourcePath: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum skill file size in bytes (50 KB). Files larger than this are skipped. */
const MAX_SKILL_SIZE_BYTES = 50 * 1024;

/** Directories to scan for skills, relative to the repo root. */
const SKILL_DIRECTORIES = [".claude/skills", ".agents/skills"];

/** The expected skill file name inside each skill directory. */
const SKILL_FILENAME = "SKILL.md";

const LOG_PREFIX = "[skill-scanner]";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const computeHash = (content: string): string =>
  createHash("sha256").update(content.trim()).digest("hex");

/**
 * Converts a kebab-case or snake_case slug into a human-readable name.
 * Examples:
 *   "code-review"   -> "Code Review"
 *   "test_runner"   -> "Test Runner"
 *   "my-cool-skill" -> "My Cool Skill"
 */
const slugToName = (slug: string): string =>
  slug
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();

// ---------------------------------------------------------------------------
// Local filesystem scanner (direct access to repo on host)
// ---------------------------------------------------------------------------

const tryReadSkillLocal = async (
  skillDir: string,
  basePath: string,
): Promise<ScannedSkill | null> => {
  try {
    const info = await stat(skillDir);
    if (!info.isDirectory()) return null;
  } catch {
    return null;
  }

  const skillFilePath = join(skillDir, SKILL_FILENAME);

  let fileInfo;
  try {
    fileInfo = await stat(skillFilePath);
  } catch {
    return null;
  }

  if (fileInfo.size > MAX_SKILL_SIZE_BYTES) {
    console.warn(
      `${LOG_PREFIX} Skipping skill at ${skillFilePath} — size ${fileInfo.size} bytes exceeds ${MAX_SKILL_SIZE_BYTES} byte limit`,
    );
    return null;
  }

  let content: string;
  try {
    content = await readFile(skillFilePath, "utf-8");
  } catch {
    return null;
  }

  if (!content.trim()) return null;

  const slug = basename(skillDir);
  const sizeBytes = Buffer.byteLength(content, "utf8");

  const sourcePath = skillFilePath.startsWith(basePath)
    ? skillFilePath.slice(basePath.length).replace(/^\//, "")
    : skillFilePath;

  return {
    name: slugToName(slug),
    slug,
    content,
    contentHash: computeHash(content),
    sizeBytes,
    sourcePath,
  };
};

// ---------------------------------------------------------------------------
// Container-based scanner (exec into Docker container)
// ---------------------------------------------------------------------------

/**
 * Lists subdirectories inside a path within a container.
 * Returns an array of directory names (not full paths).
 */
const listDirsInContainer = async (
  containerManager: ContainerDriver,
  containerId: string,
  dirPath: string,
  cwd: string,
): Promise<string[]> => {
  try {
    // Use find to list only immediate subdirectories
    const { exitCode, stdout } = await containerManager.execInContainer(
      containerId,
      ["find", dirPath, "-maxdepth", "1", "-mindepth", "1", "-type", "d", "-printf", "%f\\n"],
      cwd,
    );
    if (exitCode !== 0 || !stdout.trim()) return [];
    return stdout.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
};

/**
 * Reads a file from inside a container. Returns null if the file doesn't
 * exist, is empty, or exceeds the size limit.
 */
const readFileInContainer = async (
  containerManager: ContainerDriver,
  containerId: string,
  filePath: string,
  cwd: string,
): Promise<string | null> => {
  try {
    // Check size first using stat
    const { exitCode: statExit, stdout: statOut } = await containerManager.execInContainer(
      containerId,
      ["stat", "-c", "%s", filePath],
      cwd,
    );
    if (statExit !== 0) return null;

    const sizeBytes = parseInt(statOut.trim(), 10);
    if (isNaN(sizeBytes) || sizeBytes === 0) return null;
    if (sizeBytes > MAX_SKILL_SIZE_BYTES) {
      console.warn(
        `${LOG_PREFIX} Skipping skill at ${filePath} — size ${sizeBytes} bytes exceeds ${MAX_SKILL_SIZE_BYTES} byte limit`,
      );
      return null;
    }

    // Read file content
    const { exitCode, stdout } = await containerManager.execInContainer(
      containerId,
      ["cat", filePath],
      cwd,
    );
    if (exitCode !== 0 || !stdout.trim()) return null;

    return stdout;
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// Main scanner — local filesystem
// ---------------------------------------------------------------------------

/**
 * Scans a cloned repository for skill definitions on the local filesystem.
 *
 * Looks for `SKILL.md` files under:
 *   - `<repoPath>/.claude/skills/<slug>/SKILL.md`
 *   - `<repoPath>/.agents/skills/<slug>/SKILL.md`
 *
 * Returns an array of scanned skills with their content, hash, and metadata.
 * Gracefully handles missing directories, unreadable files, and oversized content.
 */
export const scanRepoForSkills = async (
  repoPath: string,
): Promise<ScannedSkill[]> => {
  const skills: ScannedSkill[] = [];
  const seenSlugs = new Set<string>();

  for (const skillsDir of SKILL_DIRECTORIES) {
    const fullDir = join(repoPath, skillsDir);

    let entries: string[];
    try {
      entries = await readdir(fullDir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const skillDir = join(fullDir, entry);
      const skill = await tryReadSkillLocal(skillDir, repoPath);

      if (!skill) continue;

      if (seenSlugs.has(skill.slug)) {
        console.info(
          `${LOG_PREFIX} Duplicate skill slug "${skill.slug}" found in ${skillsDir}, skipping (already seen)`,
        );
        continue;
      }

      seenSlugs.add(skill.slug);
      skills.push(skill);
    }
  }

  return skills;
};

// ---------------------------------------------------------------------------
// Main scanner — container-based
// ---------------------------------------------------------------------------

/**
 * Scans a cloned repository for skill definitions inside a Docker container.
 *
 * Same logic as `scanRepoForSkills` but uses `execInContainer` to read files
 * from the container's filesystem (where the repo is cloned at runtime).
 */
export const scanRepoForSkillsInContainer = async (
  containerManager: ContainerDriver,
  containerId: string,
  repoPath: string,
): Promise<ScannedSkill[]> => {
  const skills: ScannedSkill[] = [];
  const seenSlugs = new Set<string>();

  for (const skillsDir of SKILL_DIRECTORIES) {
    const fullDir = `${repoPath}/${skillsDir}`;
    const entries = await listDirsInContainer(containerManager, containerId, fullDir, repoPath);

    for (const slug of entries) {
      const skillFilePath = `${fullDir}/${slug}/${SKILL_FILENAME}`;
      const content = await readFileInContainer(containerManager, containerId, skillFilePath, repoPath);

      if (!content) continue;

      if (seenSlugs.has(slug)) {
        console.info(
          `${LOG_PREFIX} Duplicate skill slug "${slug}" found in ${skillsDir}, skipping (already seen)`,
        );
        continue;
      }

      seenSlugs.add(slug);

      const sourcePath = `${skillsDir}/${slug}/${SKILL_FILENAME}`;
      const sizeBytes = Buffer.byteLength(content, "utf8");

      skills.push({
        name: slugToName(slug),
        slug,
        content,
        contentHash: computeHash(content),
        sizeBytes,
        sourcePath,
      });
    }
  }

  return skills;
};

/**
 * Logs a warning when no skills are found in a repo that should have them.
 * Call this after scanning to make zero-skill situations observable.
 */
export const warnIfNoSkillsFound = (
  skills: ScannedSkill[],
  repoPath: string,
  context?: { jobId?: string; skillName?: string },
): void => {
  if (skills.length > 0) return;

  const contextStr = context
    ? ` (jobId=${context.jobId ?? "unknown"}, skill=${context.skillName ?? "unknown"})`
    : "";

  console.error(
    `${LOG_PREFIX} CANARY: No skills found in ${repoPath}${contextStr}. ` +
    `Checked directories: ${SKILL_DIRECTORIES.join(", ")}. ` +
    `The agent will likely fail to recognize skill invocations.`,
  );
};
