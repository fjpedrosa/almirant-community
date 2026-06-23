import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

type RunResult = { stdout: string; stderr: string; exitCode: number };

const run = async (cwd: string, cmd: string[], opts?: { env?: Record<string, string | undefined> }): Promise<RunResult> => {
  const proc = Bun.spawn({
    cmd,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...(opts?.env ?? {}) },
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;

  return { stdout, stderr, exitCode };
};

const ensureDir = async (dir: string) => {
  await fs.mkdir(dir, { recursive: true });
};

const defaultWorktreeRoot = () => path.join(os.tmpdir(), "mc-worker-worktrees");

export const createWorktreePath = (jobId: string) => path.join(defaultWorktreeRoot(), jobId);

export const ensureGitIdentity = async (repoPath: string, opts?: { name?: string; email?: string }) => {
  const name = opts?.name ?? "Almirant Worker";
  const email = opts?.email ?? "mc-worker@local";

  // Best-effort: configure user identity locally in the worktree.
  await run(repoPath, ["git", "-C", repoPath, "config", "user.name", name]);
  await run(repoPath, ["git", "-C", repoPath, "config", "user.email", email]);
};

export const createWorktree = async (args: {
  repoPath: string;
  baseBranch: string;
  branchName: string;
  worktreePath: string;
}): Promise<void> => {
  await ensureDir(path.dirname(args.worktreePath));

  // Prefer origin/<baseBranch> if available (fresh checkout), fallback to local branch.
  const originRef = `origin/${args.baseBranch}`;
  const addOrigin = await run(args.repoPath, ["git", "-C", args.repoPath, "worktree", "add", "-b", args.branchName, args.worktreePath, originRef]);
  if (addOrigin.exitCode === 0) return;

  const addLocal = await run(args.repoPath, ["git", "-C", args.repoPath, "worktree", "add", "-b", args.branchName, args.worktreePath, args.baseBranch]);
  if (addLocal.exitCode !== 0) {
    throw new Error(`Failed to create worktree:\n${addOrigin.stderr || addOrigin.stdout}\n${addLocal.stderr || addLocal.stdout}`.trim());
  }
};

export const removeWorktree = async (args: { repoPath: string; worktreePath: string }): Promise<void> => {
  // `git worktree remove` is idempotent-ish, but can fail if already removed; swallow not-found.
  const res = await run(args.repoPath, ["git", "-C", args.repoPath, "worktree", "remove", "--force", args.worktreePath]);
  if (res.exitCode !== 0) {
    const msg = (res.stderr || res.stdout || "").toLowerCase();
    if (!msg.includes("not a valid") && !msg.includes("no such file") && !msg.includes("does not exist")) {
      throw new Error(`Failed to remove worktree: ${res.stderr || res.stdout}`.trim());
    }
  }

  await fs.rm(args.worktreePath, { recursive: true, force: true }).catch(() => {});
};

export const getChangedFiles = async (repoPath: string): Promise<string[]> => {
  const res = await run(repoPath, ["git", "-C", repoPath, "status", "--porcelain"]);
  if (res.exitCode !== 0) throw new Error(res.stderr || res.stdout || "git status failed");

  const files = new Set<string>();
  for (const line of res.stdout.split("\n")) {
    const trimmed = line.trimEnd();
    if (!trimmed) continue;
    const p = trimmed.slice(3).trim();
    if (p) files.add(p);
  }
  return Array.from(files);
};

export const commitAll = async (args: { repoPath: string; message: string }): Promise<string> => {
  const status = await run(args.repoPath, ["git", "-C", args.repoPath, "status", "--porcelain"]);
  if (status.exitCode !== 0) throw new Error(status.stderr || status.stdout || "git status failed");
  if (!status.stdout.trim()) throw new Error("No changes to commit");

  const add = await run(args.repoPath, ["git", "-C", args.repoPath, "add", "-A"]);
  if (add.exitCode !== 0) throw new Error(add.stderr || add.stdout || "git add failed");

  const commit = await run(args.repoPath, ["git", "-C", args.repoPath, "commit", "-m", args.message]);
  if (commit.exitCode !== 0) throw new Error(commit.stderr || commit.stdout || "git commit failed");

  const sha = await run(args.repoPath, ["git", "-C", args.repoPath, "rev-parse", "HEAD"]);
  if (sha.exitCode !== 0) throw new Error(sha.stderr || sha.stdout || "git rev-parse failed");
  return sha.stdout.trim();
};

export const pushBranch = async (args: { repoPath: string; branchName: string }): Promise<void> => {
  const res = await run(args.repoPath, ["git", "-C", args.repoPath, "push", "-u", "origin", args.branchName]);
  if (res.exitCode !== 0) throw new Error(res.stderr || res.stdout || "git push failed");
};

export const getOriginRepo = async (repoPath: string): Promise<{ owner: string; repo: string }> => {
  const res = await run(repoPath, ["git", "-C", repoPath, "config", "--get", "remote.origin.url"]);
  if (res.exitCode !== 0) throw new Error(res.stderr || res.stdout || "remote.origin.url not set");
  const origin = res.stdout.trim();

  // Supports:
  // - git@github.com:owner/repo.git
  // - https://github.com/owner/repo.git
  // - https://github.com/owner/repo
  const ssh = origin.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (ssh) return { owner: ssh[1]!, repo: ssh[2]! };

  try {
    const u = new URL(origin);
    const parts = u.pathname.replace(/^\/+/, "").split("/");
    if (u.hostname === "github.com" && parts.length >= 2) {
      const owner = parts[0]!;
      const repo = (parts[1] ?? "").replace(/\.git$/, "");
      if (owner && repo) return { owner, repo };
    }
  } catch {
    // fall through
  }

  throw new Error(`Unsupported origin URL for GitHub PR creation: ${origin}`);
};

