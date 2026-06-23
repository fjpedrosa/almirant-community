import type { JobLogLine, SpawnResult } from "./types";
import { spawnCmd } from "./spawn";

const BRANCH_RE = /^[a-zA-Z0-9._/-]{1,200}$/;

const validateBranch = (branch: string): void => {
  if (!BRANCH_RE.test(branch)) {
    throw new Error(`Invalid branch name: ${branch}`);
  }
};

export interface GitOpts {
  repoPath: string;
  branch: string;
  onLog?: (line: JobLogLine) => void;
}

const runGit = (
  args: string[],
  opts: { repoPath: string; onLog?: (line: JobLogLine) => void; timeoutMs?: number },
): Promise<SpawnResult> =>
  spawnCmd(["git", ...args], {
    cwd: opts.repoPath,
    onLog: opts.onLog,
    timeoutMs: opts.timeoutMs ?? 60_000,
  });

export const revParseHead = async (
  repoPath: string,
): Promise<string | null> => {
  const result = await runGit(["rev-parse", "HEAD"], { repoPath, timeoutMs: 5_000 });
  if (!result.ok) return null;
  return result.stdout.trim() || null;
};

export const revParseHeadShort = async (
  repoPath: string,
): Promise<string | null> => {
  const sha = await revParseHead(repoPath);
  return sha ? sha.slice(0, 7) : null;
};

export const fetchOrigin = async (opts: GitOpts): Promise<SpawnResult> => {
  validateBranch(opts.branch);
  return runGit(["fetch", "origin", opts.branch], {
    repoPath: opts.repoPath,
    onLog: opts.onLog,
    timeoutMs: 5 * 60_000,
  });
};

export const pullFastForward = async (opts: GitOpts): Promise<SpawnResult> => {
  validateBranch(opts.branch);
  return runGit(["pull", "--ff-only", "origin", opts.branch], {
    repoPath: opts.repoPath,
    onLog: opts.onLog,
    timeoutMs: 2 * 60_000,
  });
};
