import path from "node:path";
import os from "node:os";
import { mkdir, rm } from "node:fs/promises";

import { runGit } from "./git-runner.js";

export type ActiveWorktree = {
  path: string;
  head?: string;
  branch?: string;
  detached?: boolean;
};

const parseWorktreeListPorcelain = (text: string): ActiveWorktree[] => {
  const blocks = text
    .split(/\n\s*\n/g)
    .map((b) => b.trim())
    .filter(Boolean);

  const out: ActiveWorktree[] = [];
  for (const block of blocks) {
    const wt: ActiveWorktree = { path: "" };
    for (const line of block.split("\n")) {
      if (line.startsWith("worktree ")) wt.path = line.slice("worktree ".length).trim();
      else if (line.startsWith("HEAD ")) wt.head = line.slice("HEAD ".length).trim();
      else if (line.startsWith("branch ")) {
        const ref = line.slice("branch ".length).trim();
        wt.branch = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
      } else if (line === "detached") wt.detached = true;
    }
    if (wt.path) out.push(wt);
  }
  return out;
};

export const createWorktree = async (
  repoPath: string,
  branchName: string,
  baseBranch: string = "main",
  existingRemoteBranch?: string
): Promise<string> => {
  const worktreePath = path.join(repoPath, ".worktrees", branchName);
  await mkdir(path.dirname(worktreePath), { recursive: true });

  // 1. Keep origin refs fresh.
  await runGit(["fetch", "origin"], { cwd: repoPath });

  if (existingRemoteBranch) {
    // 2a. Create worktree from an existing remote branch, tracking it.
    //     This enables retry/re-run flows to continue where a prior attempt left off.
    await runGit([
      "worktree",
      "add",
      "--track",
      "-b",
      branchName,
      worktreePath,
      existingRemoteBranch,
    ], { cwd: repoPath });
  } else {
    // 2b. Create worktree + new local branch from origin/<baseBranch>.
    await runGit([
      "worktree",
      "add",
      worktreePath,
      "-b",
      branchName,
      `origin/${baseBranch}`,
    ], { cwd: repoPath });
  }

  return worktreePath;
};

export const cleanupWorktree = async (
  worktreePath: string,
  branchName: string
): Promise<void> => {
  // Worktrees are created under: <repoPath>/.worktrees/<branchName>
  // Derive the main repo path so we can remove the worktree safely even if we're inside it.
  const marker = `${path.sep}.worktrees${path.sep}`;
  const idx = worktreePath.indexOf(marker);
  const repoPath = idx >= 0 ? worktreePath.slice(0, idx) : path.dirname(path.dirname(worktreePath));

  await runGit(["worktree", "remove", worktreePath, "--force"], { cwd: repoPath });
  await runGit(["branch", "-D", branchName], { cwd: repoPath });
};

export const listActiveWorktrees = async (repoPath: string): Promise<ActiveWorktree[]> => {
  const { stdout } = await runGit(["worktree", "list", "--porcelain"], { cwd: repoPath });
  return parseWorktreeListPorcelain(stdout);
};

/**
 * Clone a remote repository into a temporary directory.
 * Uses --depth 50 for a shallow clone with enough history for diffs.
 */
export const cloneRepository = async (
  repoUrl: string,
  baseBranch: string,
  targetDir: string
): Promise<void> => {
  await mkdir(path.dirname(targetDir), { recursive: true });
  await runGit(
    ["clone", "--depth", "50", "--branch", baseBranch, repoUrl, targetDir],
    { cwd: os.tmpdir() }
  );
};

/**
 * Remove a cloned repository directory. Robust: ignores errors if already gone.
 */
export const cleanupClone = async (clonePath: string): Promise<void> => {
  try {
    await rm(clonePath, { recursive: true, force: true });
  } catch {
    // Ignore — directory may already be gone.
  }
};
