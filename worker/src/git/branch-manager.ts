import { runGit } from "./git-runner.js";

/**
 * Check if a remote branch matching `agent/<taskId>-*` already exists.
 * Returns the full remote ref name (e.g., "origin/agent/MC-578-add-repourl") or null.
 *
 * This enables retry/re-run flows: when a prior attempt already pushed a branch,
 * the worker can reuse it instead of creating a new one, and any push will
 * automatically update the corresponding pull request.
 */
export const findExistingRemoteBranch = async (
  repoPath: string,
  taskId: string
): Promise<string | null> => {
  // Fetch latest remote refs and prune stale tracking branches.
  await runGit(["fetch", "origin", "--prune"], { cwd: repoPath });

  const pattern = `origin/agent/${taskId}-*`;
  const result = await runGit(["branch", "-r", "--list", pattern], { cwd: repoPath });

  const branches = result.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((b) => b.trim());

  if (branches.length === 0) return null;

  // Return the first match (there should typically be only one per task).
  return branches[0] ?? null;
};

export const commitChanges = async (
  worktreePath: string,
  taskId: string,
  title: string
): Promise<{ hasChanges: boolean; commitSha?: string }> => {
  await runGit(["add", "-A"], { cwd: worktreePath });

  const status = await runGit(["status", "--porcelain"], { cwd: worktreePath });
  if (!status.stdout.trim()) {
    return { hasChanges: false };
  }

  const message = `[${taskId}] ${title}`.slice(0, 72);
  await runGit(["commit", "-m", message], { cwd: worktreePath });

  const sha = await runGit(["rev-parse", "HEAD"], { cwd: worktreePath });
  return { hasChanges: true, commitSha: sha.stdout.trim() };
};

export const pushBranch = async (worktreePath: string, branchName: string): Promise<void> => {
  await runGit(["push", "-u", "origin", branchName], { cwd: worktreePath });
};

