/**
 * Pushes collected changes from the runner side.
 *
 * After `collectChanges()` extracts workspace data from the agent
 * container, this module clones the repo using a fresh GitHub token,
 * applies the collected patch/archive, commits, and pushes -- all on the
 * runner host.
 *
 * Used as a safety net for any uncommitted changes left after the session.
 */

import type { CollectedChanges } from "./change-collector";
import { GITHUB_BOT_EMAIL, GITHUB_BOT_NAME } from "./github-identity";
import {
  filterUserModifiedPaths,
  isRunnerManagedRepoPath,
  normalizeRepoPath,
} from "./repo-paths";

export {
  filterUserModifiedPaths,
  isRunnerManagedRepoPath,
  isSafeRepoPath,
} from "./repo-paths";

export interface PushChangesParams {
  /** Collected changes from the agent container. */
  collected: CollectedChanges;
  /** HTTPS repo URL (no token embedded). */
  repoUrl: string;
  /** Target branch to push to. */
  branch: string;
  /** Fresh GitHub installation token for authentication. */
  gitToken: string;
  /** Job ID for commit message attribution. */
  jobId: string;
}

export interface PushChangesResult {
  /** Whether the push succeeded. */
  success: boolean;
  /** Number of files in the commit. */
  modifiedFileCount: number;
  /** Error message if push failed. */
  errorMessage?: string;
}

/**
 * Clone repo, apply collected patch/archive, commit, and push.
 *
 * Uses GIT_ASKPASS to avoid embedding the token in the remote URL,
 * so `git remote -v` always shows a clean HTTPS URL.
 */
export const pushChanges = async (
  params: PushChangesParams
): Promise<PushChangesResult> => {
  const { collected, repoUrl, branch, gitToken, jobId } = params;
  const { tmpdir } = await import("node:os");
  const { mkdtemp, rm, readFile, writeFile, chmod, stat } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { createWriteStream } = await import("node:fs");
  const { pipeline } = await import("node:stream/promises");
  const { Readable } = await import("node:stream");
  const execFileAsync = promisify(execFile);

  const log = (msg: string) => console.log(`[runner-push:${jobId}] ${msg}`);
  const warn = (msg: string) => console.warn(`[runner-push:${jobId}] ${msg}`);
  const archiveMode = collected.archiveMode ?? "full";
  const candidatePaths = filterUserModifiedPaths(collected.modifiedFiles);
  const filteredManagedPaths = [...new Set(collected.modifiedFiles.map(normalizeRepoPath).filter(isRunnerManagedRepoPath))];

  const run = async (
    cmd: string,
    args: string[],
    opts?: { cwd?: string; env?: Record<string, string> }
  ): Promise<{ stdout: string; stderr: string }> => {
    return execFileAsync(cmd, args, {
      cwd: opts?.cwd,
      env: { ...process.env, ...opts?.env },
      maxBuffer: 50 * 1024 * 1024,
    });
  };

  log(`Archive mode: ${archiveMode}; archive buffer size: ${collected.archiveBuffer.length} bytes`);
  if (filteredManagedPaths.length > 0) {
    log(
      `Ignoring ${filteredManagedPaths.length} runner-managed path(s): ${filteredManagedPaths.slice(0, 10).join(", ")}${filteredManagedPaths.length > 10 ? "..." : ""}`,
    );
  }
  if (candidatePaths.length === 0) {
    log("No user-modified paths remain after filtering runner-managed files");
    return { success: true, modifiedFileCount: 0 };
  }

  const tempDir = await mkdtemp(join(tmpdir(), "almirant-push-"));
  const cloneDir = join(tempDir, "repo");
  const tarPath = join(tempDir, "workspace.tar");
  const patchPath = join(tempDir, "changes.patch");
  const askpassPath = join(tempDir, "git-askpass.sh");

  try {
    // Write askpass script so token never appears in remote URL
    await writeFile(askpassPath, `#!/bin/sh\necho "${gitToken}"\n`);
    await chmod(askpassPath, 0o700);

    // Write archive to disk when this collection mode produced one. Selective
    // mode may legitimately have no tar if there are only tracked changes.
    if (collected.archiveBuffer.length > 0) {
      await pipeline(
        Readable.from(collected.archiveBuffer),
        createWriteStream(tarPath),
      );
      const tarStat = await stat(tarPath);
      log(`Tar written: ${tarStat.size} bytes`);

      // List top-level entries to verify archive structure
      try {
        const { stdout: tarList } = await run("tar", ["tf", tarPath, "--wildcards", "*/"], {});
        const topDirs = [...new Set(tarList.split("\n").filter(Boolean).map(e => e.split("/")[0]))];
        log(`Archive top-level entries: ${topDirs.join(", ")}`);
      } catch {
        try {
          const { stdout: tarList } = await run("tar", ["tf", tarPath]);
          const firstEntries = tarList.split("\n").filter(Boolean).slice(0, 10);
          log(`Archive first 10 entries: ${firstEntries.join(", ")}`);
        } catch (listErr) {
          warn(`Could not list archive contents: ${listErr instanceof Error ? listErr.message : String(listErr)}`);
        }
      }
    } else {
      log("No archive file needed for this collection");
    }

    // Detect branch from full archive's .git/HEAD. Selective archives do not
    // include .git, so they intentionally use the explicit branch parameter.
    let detectedBranch = branch;
    if (archiveMode === "full" && collected.archiveBuffer.length > 0) {
      try {
        const headTmpDir = await mkdtemp(join(tmpdir(), "almirant-head-"));
        try {
          await run("tar", [
            "xf", tarPath,
            "--strip-components=1",
            "-C", headTmpDir,
            "repo/.git/HEAD",
          ]);
          const headContent = await readFile(join(headTmpDir, ".git", "HEAD"), "utf8");
          const match = headContent.match(/^ref: refs\/heads\/(.+)/);
          if (match?.[1]?.trim() && match[1].trim() !== "main") {
            detectedBranch = match[1].trim();
          }
          log(`Detected branch from archive: ${detectedBranch}`);
        } finally {
          await rm(headTmpDir, { recursive: true, force: true }).catch(() => undefined);
        }
      } catch {
        log(`Could not detect branch from archive — using param: ${branch}`);
      }
    } else {
      log(`Selective collection mode — using param branch: ${branch}`);
    }

    // Clone using GIT_ASKPASS (clean URL)
    const gitEnv = {
      GIT_ASKPASS: askpassPath,
      GIT_TERMINAL_PROMPT: "0",
    };

    try {
      await run("git", [
        "clone", "--depth=1", "--branch", detectedBranch,
        repoUrl, cloneDir,
      ], { env: gitEnv });
      log(`Cloned branch ${detectedBranch} successfully`);
    } catch {
      log(`Branch ${detectedBranch} not on remote — cloning default and creating`);
      await run("git", [
        "clone", "--depth=1",
        repoUrl, cloneDir,
      ], { env: gitEnv });
      await run("git", ["checkout", "-b", detectedBranch], { cwd: cloneDir });
    }

    if (archiveMode === "full") {
      if (collected.archiveBuffer.length === 0) {
        throw new Error("Full archive mode did not include an archive buffer");
      }

      // Overlay archive (exclude .git to keep host clone's git state)
      await run("tar", [
        "xf", tarPath,
        "--strip-components=1",
        "--exclude=repo/.git",
        "-C", cloneDir,
      ]);
      log("Full archive overlay applied");
    } else {
      if (collected.fullDiff.trim()) {
        await writeFile(patchPath, collected.fullDiff);
        await run("git", [
          "apply",
          "--binary",
          "--whitespace=nowarn",
          patchPath,
        ], { cwd: cloneDir });
        log("Binary patch applied");
      } else {
        log("No tracked patch to apply");
      }

      if (collected.archiveBuffer.length > 0) {
        await run("tar", [
          "xf", tarPath,
          "--strip-components=1",
          "-C", cloneDir,
        ]);
        log(`Selective archive extracted (${collected.archivePaths?.length ?? 0} path(s))`);
      } else {
        log("No untracked archive to extract");
      }
    }

    // Stage and check only user-modified paths. Runner-managed injected files
    // must never be included in the safety-net commit even if the workspace
    // overlay contains them.
    await run("git", ["add", "-A", "--", ...candidatePaths], { cwd: cloneDir });

    const { stdout: statusOutput } = await run(
      "git", ["status", "--porcelain", "--", ...candidatePaths], { cwd: cloneDir }
    );
    if (!statusOutput.trim()) {
      log("No user changes detected after applying collected changes/filtering — nothing to push");
      return { success: true, modifiedFileCount: 0 };
    }

    const modifiedFiles = statusOutput
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    log(`Changes detected: ${modifiedFiles.length} files — ${modifiedFiles.slice(0, 10).join(", ")}${modifiedFiles.length > 10 ? "..." : ""}`);

    // Commit
    await run("git", [
      "-c", `user.name=${GITHUB_BOT_NAME}`,
      "-c", `user.email=${GITHUB_BOT_EMAIL}`,
      "commit",
      "-m", `chore: apply changes from job ${jobId}`,
    ], { cwd: cloneDir });

    // Push using GIT_ASKPASS
    const { stderr: pushStderr } = await run("git", ["push", "origin", detectedBranch], {
      cwd: cloneDir,
      env: gitEnv,
    });
    log(`Push completed: ${pushStderr.trim() || "(no stderr)"}`);

    // Clean up askpass immediately after push
    await rm(askpassPath, { force: true }).catch(() => undefined);

    return { success: true, modifiedFileCount: modifiedFiles.length };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    warn(`Push failed: ${msg}`);
    return {
      success: false,
      modifiedFileCount: 0,
      errorMessage: msg,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
};
