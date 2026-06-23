/**
 * Collects changes from an agent container post-session.
 *
 * Runs git commands inside the container to capture:
 * - List of changed files
 * - Binary patch for tracked changes
 * - Selective archive for untracked files only
 *
 * The runner later applies the patch/archive using its own credentials (the
 * container never needs a git push token). If precise collection fails, this
 * falls back to the previous full-workspace archive mode for reliability.
 */

import type { ContainerManager } from "../workspace/container-manager";
import { filterSafeRepoPaths } from "./repo-paths";

export type CollectedArchiveMode = "selective" | "full";

export interface CollectedChanges {
  /** List of files modified relative to HEAD, including untracked files. */
  modifiedFiles: string[];
  /** Binary-safe git patch output (`git diff --binary HEAD`) for tracked changes. */
  fullDiff: string;
  /** Raw tar archive. Selective mode contains only untracked files; full mode contains the whole workspace. */
  archiveBuffer: Buffer;
  /** Whether archiveBuffer is selective or a full-workspace fallback. */
  archiveMode: CollectedArchiveMode;
  /** Repo-relative paths included in archiveBuffer when archiveMode is selective. */
  archivePaths: string[];
  /** Temporary directory where results are stored. */
  tmpDir: string;
}

type ExecResult = { exitCode: number; stdout: string; stderr: string };

type GitMetadata = {
  modifiedFiles: string[];
  trackedFiles: string[];
  untrackedFiles: string[];
  fullDiff: string;
};

const parseNulSeparatedPaths = (stdout: string): string[] => {
  if (!stdout) return [];
  return stdout.split("\0").filter(Boolean);
};

const assertExecSuccess = (result: ExecResult, description: string): void => {
  if (result.exitCode !== 0) {
    const stderr = result.stderr.trim();
    throw new Error(`${description} failed with exit ${result.exitCode}${stderr ? `: ${stderr}` : ""}`);
  }
};

const uniqueSafePaths = (paths: string[]): string[] => filterSafeRepoPaths(paths);

const collectGitMetadata = async (
  containerManager: ContainerManager,
  containerId: string,
  workspacePath: string,
): Promise<GitMetadata> => {
  const nameResult = await containerManager.execInContainer(
    containerId,
    ["git", "diff", "--name-only", "-z", "HEAD"],
    workspacePath,
  );
  assertExecSuccess(nameResult, "git diff --name-only");

  const diffResult = await containerManager.execInContainer(
    containerId,
    ["git", "diff", "--binary", "HEAD"],
    workspacePath,
  );
  assertExecSuccess(diffResult, "git diff --binary");

  const untrackedResult = await containerManager.execInContainer(
    containerId,
    ["git", "ls-files", "--others", "--exclude-standard", "-z"],
    workspacePath,
  );
  assertExecSuccess(untrackedResult, "git ls-files --others");

  const trackedFiles = uniqueSafePaths(parseNulSeparatedPaths(nameResult.stdout));
  const untrackedFiles = uniqueSafePaths(parseNulSeparatedPaths(untrackedResult.stdout));

  return {
    modifiedFiles: uniqueSafePaths([...trackedFiles, ...untrackedFiles]),
    trackedFiles,
    untrackedFiles,
    fullDiff: diffResult.stdout,
  };
};

const makeContainerTmpRoot = (): string => {
  const nonce = Math.random().toString(36).slice(2, 10);
  return `/tmp/almirant-changes-${Date.now()}-${nonce}`;
};

const createSelectiveArchive = async (
  containerManager: ContainerManager,
  containerId: string,
  workspacePath: string,
  repoRelativePaths: string[],
  archiveTimeoutMs: number,
): Promise<Buffer> => {
  if (repoRelativePaths.length === 0) {
    return Buffer.alloc(0);
  }

  const tmpRoot = makeContainerTmpRoot();
  const repoRoot = `${tmpRoot}/repo`;
  const pathListFile = `${tmpRoot}/paths.list`;
  const pathListBuffer = Buffer.from(`${repoRelativePaths.join("\0")}\0`, "utf8");

  try {
    const prepareResult = await containerManager.execInContainer(
      containerId,
      ["sh", "-c", "tmp_root=\"$1\"; rm -rf \"$tmp_root\" && mkdir -p \"$tmp_root/repo\"", "almirant-selective-archive", tmpRoot],
      "/",
    );
    assertExecSuccess(prepareResult, "prepare selective archive workspace");

    await containerManager.writeFileBufferViaExec(containerId, pathListFile, pathListBuffer, "0600");

    const tarResult = await containerManager.execInContainer(
      containerId,
      [
        "sh",
        "-c",
        "tmp_root=\"$1\"; workspace=\"$2\"; list_file=\"$3\"; tar cf - -C \"$workspace\" --null -T \"$list_file\" | tar xf - -C \"$tmp_root/repo\"",
        "almirant-selective-archive",
        tmpRoot,
        workspacePath,
        pathListFile,
      ],
      "/",
    );
    assertExecSuccess(tarResult, "create selective archive workspace");

    return await containerManager.extractWorkspaceArchive(containerId, repoRoot, archiveTimeoutMs);
  } finally {
    await containerManager.execInContainer(
      containerId,
      ["rm", "-rf", tmpRoot],
      "/",
    ).catch(() => undefined);
  }
};

const collectFullArchiveFallback = async (
  containerManager: ContainerManager,
  containerId: string,
  workspacePath: string,
  archiveTimeoutMs: number,
  metadata: Partial<GitMetadata>,
): Promise<Omit<CollectedChanges, "tmpDir">> => {
  const archiveBuffer = await containerManager.extractWorkspaceArchive(
    containerId,
    workspacePath,
    archiveTimeoutMs,
  );

  return {
    modifiedFiles: metadata.modifiedFiles ?? [],
    fullDiff: metadata.fullDiff ?? "",
    archiveBuffer,
    archiveMode: "full",
    archivePaths: [workspacePath],
  };
};

/**
 * Collect changes from a running container.
 *
 * Preferred mode is selective:
 * - tracked changes/deletions/renames travel as `git diff --binary HEAD`
 * - untracked files travel in a tiny tar containing only those files
 *
 * If exec/git/selective tar fails, falls back to the previous full archive
 * behavior because losing the user's work would be worse than a large tar.
 */
export const collectChanges = async (
  containerManager: ContainerManager,
  containerId: string,
  workspacePath = "/workspace/repo",
  archiveTimeoutMs = 60_000,
): Promise<CollectedChanges> => {
  const { tmpdir } = await import("node:os");
  const { mkdtemp, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");

  const tmpDir = await mkdtemp(join(tmpdir(), "almirant-changes-"));
  let collected: Omit<CollectedChanges, "tmpDir">;
  let metadata: Partial<GitMetadata> = {};

  try {
    metadata = await collectGitMetadata(containerManager, containerId, workspacePath);
    const archiveBuffer = await createSelectiveArchive(
      containerManager,
      containerId,
      workspacePath,
      metadata.untrackedFiles ?? [],
      archiveTimeoutMs,
    );

    collected = {
      modifiedFiles: metadata.modifiedFiles ?? [],
      fullDiff: metadata.fullDiff ?? "",
      archiveBuffer,
      archiveMode: "selective",
      archivePaths: metadata.untrackedFiles ?? [],
    };
  } catch {
    collected = await collectFullArchiveFallback(
      containerManager,
      containerId,
      workspacePath,
      archiveTimeoutMs,
      metadata,
    );
  }

  // Persist results to tmpdir for later diagnostics/push.
  await writeFile(join(tmpDir, "modified-files.txt"), collected.modifiedFiles.join("\n"));
  await writeFile(join(tmpDir, "full-diff.patch"), collected.fullDiff);
  await writeFile(join(tmpDir, "archive-mode.txt"), collected.archiveMode);
  await writeFile(join(tmpDir, "archive-paths.txt"), collected.archivePaths.join("\n"));
  if (collected.archiveBuffer.length > 0) {
    await writeFile(join(tmpDir, "workspace.tar"), collected.archiveBuffer);
  }

  return {
    ...collected,
    tmpDir,
  };
};

/**
 * Clean up the temporary directory created by collectChanges().
 */
export const cleanupCollectedChanges = async (
  collectedChanges: CollectedChanges
): Promise<void> => {
  const { rm } = await import("node:fs/promises");
  await rm(collectedChanges.tmpDir, { recursive: true, force: true }).catch(() => undefined);
};
