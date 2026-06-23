export { runGit } from "./git-runner.js";
export * from "./branch-naming.js";

// Avoid export name collisions across helper modules.
export {
  createWorktree as createWorktreeTmp,
  createWorktreePath,
  ensureGitIdentity,
  removeWorktree,
  getChangedFiles,
  commitAll,
  pushBranch as pushBranchTmp,
  getOriginRepo,
} from "./worktree.js";

export { createPullRequest as createGithubPullRequest } from "./github.js";

export {
  createWorktree as createManagedWorktree,
  cleanupWorktree,
  cloneRepository,
  cleanupClone,
  listActiveWorktrees,
} from "./worktree-manager.js";

export {
  findExistingRemoteBranch,
  commitChanges,
  pushBranch as pushBranchManaged,
} from "./branch-manager.js";

export { createPullRequest as createApiPullRequest } from "./pr-manager.js";
