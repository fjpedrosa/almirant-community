const RUNNER_MANAGED_EXACT_PATHS = new Set([
  "CLAUDE.md",
  "AGENTS.md",
  ".mcp.json",
  "opencode.json",
]);

const RUNNER_MANAGED_PREFIXES = [
  ".claude/",
  ".agents/",
];

/**
 * Normalize a Git repo-relative path without turning absolute paths into safe
 * relative paths. Security checks must run after this normalization.
 */
export const normalizeRepoPath = (value: string): string =>
  value
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .trim();

/**
 * Returns true only for paths that are safe to pass to git/tar as repo-relative
 * file operands. This deliberately rejects absolute paths, path traversal and
 * any path that enters `.git`.
 */
export const isSafeRepoPath = (value: string): boolean => {
  const normalized = normalizeRepoPath(value);
  if (!normalized) return false;
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) return false;

  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return false;
  if (segments.includes(".git")) return false;

  return true;
};

export const isRunnerManagedRepoPath = (value: string): boolean => {
  const normalized = normalizeRepoPath(value);
  if (!normalized) return false;
  if (RUNNER_MANAGED_EXACT_PATHS.has(normalized)) return true;
  return RUNNER_MANAGED_PREFIXES.some((prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix));
};

export const filterSafeRepoPaths = (paths: string[]): string[] =>
  [...new Set(paths.map(normalizeRepoPath).filter(isSafeRepoPath))];

export const filterUserModifiedPaths = (paths: string[]): string[] =>
  filterSafeRepoPaths(paths).filter((path) => !isRunnerManagedRepoPath(path));
