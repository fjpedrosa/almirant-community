/**
 * First-class workspace source for remote agent jobs.
 *
 * This is intentionally an additive contract. Legacy jobs can continue sending
 * repoPath/baseBranch/repoUrl/repositoryId, and runners derive a git_repo
 * workspace from those fields until callers migrate to config.workspace.
 */
export type AgentWorkspace =
  | {
      kind: "git_repo";
      /** Preferred when the repository is managed by Almirant/GitHub App auth. */
      repositoryId?: string;
      /** Explicit clone URL. Required by current runners unless resolved from project context. */
      repoUrl?: string;
      /** Branch, tag, or commit SHA. Defaults to the legacy baseBranch/main behavior. */
      ref?: string;
      /** Alias for ref, kept because existing job config uses branch language. */
      branch?: string;
      /** Optional shallow clone depth. Current runners default to 1. */
      depth?: number;
    }
  | {
      kind: "empty_workspace";
      /** Future hook for starter templates; currently informational. */
      templateId?: string;
      /** Alias for templateId, matching the public API vocabulary. */
      template?: string;
    }
  | {
      kind: "uploaded_files";
      fileIds: string[];
      unpackMode?: "flat" | "preserve_paths";
    }
  | {
      kind: "mounted_volume";
      /** Capability ID, preferred over raw host paths. */
      volumeId?: string;
      /** Legacy/public alias for a volume path. Current runners do not mount it directly. */
      path?: string;
      mountPath?: string;
      readOnly?: boolean;
    }
  | {
      kind: "memory_only";
      contextIds: string[];
    };
