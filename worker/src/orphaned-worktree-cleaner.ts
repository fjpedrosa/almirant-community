import path from "node:path";

import { logger } from "@almirant/config";
import { createApiClient } from "./api-client.js";
import { listActiveWorktrees } from "./git/worktree-manager.js";
import { runGit } from "./git/git-runner.js";

const isWorktreeUnderRepo = (repoPath: string, worktreePath: string): boolean => {
  const repo = path.resolve(repoPath);
  const wt = path.resolve(worktreePath);
  const prefix = path.join(repo, ".worktrees") + path.sep;
  return wt.startsWith(prefix);
};

const safeBranchNameFromWorktreePath = (worktreePath: string): string => {
  return path.basename(worktreePath);
};

const removeWorktree = async (repoPath: string, worktreePath: string, branchName?: string): Promise<void> => {
  await runGit(["worktree", "remove", worktreePath, "--force"], { cwd: repoPath });
  if (branchName && branchName.trim().length > 0) {
    await runGit(["branch", "-D", branchName], { cwd: repoPath });
  }
};

export const cleanupOrphanedWorktrees = async (args: {
  apiBaseUrl: string;
  apiKey: string;
  repoPaths: string[];
}): Promise<void> => {
  const client = createApiClient({ apiBaseUrl: args.apiBaseUrl, apiKey: args.apiKey });

  let running: Array<{ worktreePath: string | null }> = [];
  try {
    running = await client.listRunningJobs();
  } catch (err) {
    // If we can't determine what's running, don't risk deleting anything.
    logger.warn({ err }, "mc-worker cleanup: failed to fetch running jobs; skipping cleanup");
    return;
  }

  const protectedPaths = new Set(
    running
      .map((j) => (typeof j.worktreePath === "string" ? path.resolve(j.worktreePath) : null))
      .filter((x): x is string => typeof x === "string" && x.length > 0)
  );

  for (const repoPath of args.repoPaths) {
    try {
      const worktrees = await listActiveWorktrees(repoPath);
      for (const wt of worktrees) {
        if (!wt.path) continue;
        if (!isWorktreeUnderRepo(repoPath, wt.path)) continue;

        const wtAbs = path.resolve(wt.path);
        if (protectedPaths.has(wtAbs)) continue;

        const branchName = wt.branch ?? safeBranchNameFromWorktreePath(wt.path);
        try {
          await removeWorktree(repoPath, wt.path, branchName);
          logger.info({ repoPath, worktreePath: wt.path }, `Cleaned up orphaned worktree: ${wt.path}`);
        } catch (rmErr) {
          logger.warn({ repoPath, worktreePath: wt.path, err: rmErr }, "mc-worker cleanup: failed to remove orphaned worktree");
        }
      }
    } catch (err) {
      logger.warn({ repoPath, err }, "mc-worker cleanup: failed to list worktrees");
    }
  }
};

