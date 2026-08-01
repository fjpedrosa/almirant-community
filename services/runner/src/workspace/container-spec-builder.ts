/**
 * Builds the RunnerContainerSpec used to start an agent container.
 *
 * Extracted from JobExecutor.buildContainerSpec() so it can be unit-tested
 * and reused without a class instance.
 */

import type { ClaimedJob, WorkItemDetails } from "@almirant/remote-agent";
import type { buildInjectedEnv } from "./config-injector";
import type { RunnerContainerSpec, RuntimeConfig } from "../shared/types";
import { resolveJobIntent, resolveResourceTier, getResourcesForTier, type SkillResources } from "../orchestration/job-intent";
import { resolveJobMemoryRequirement } from "../orchestration/runner-memory";
import { buildClaudeMcpConfig, buildCodexMcpConfig } from "../shared/mcp-config-builder";
import { normalizeJobConfig } from "../shared/job-helpers";

// ── Re-exported constants (also consumed by job-executor.ts) ─────────────────

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const OPENCODE_SERVE_PORT = 4096;

export const WORKSPACE_REPO_PATH = "/workspace/repo";

export const CONTAINER_USER = "1001:1001";

/**
 * Extra memory (MB) for heavier runtimes. Codex (OpenAI) loads a larger
 * process than claude-code and can OOM-kill at the configured base limit.
 *
 * `claude-shim` gets a smaller bump to absorb the short window during
 * post-session push where the primary LLM session is being torn down
 * while the push session creates its own context on the same serve
 * process. +512 MB has been enough to eliminate the observed OOMs in
 * 28/33 post-completion events seen over 14 days.
 */
export const PROVIDER_MEMORY_BUMP: Record<string, number> = {
  "codex-shim": 1536,
  "claude-shim": 512,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Compute the container memory limit based on mount mode.
 *
 * - Bind mode (production): memoryMb only (all writable paths are on disk).
 * - Volume mode (driver-managed storage): memoryMb only — logical volumes are
 *   disk-backed, so they carry no tmpfs RAM tax either.
 * - Tmpfs mode (fallback): memoryMb + all three tmpfs mounts consume RAM.
 */
export const computeMemoryLimit = (resources: SkillResources, diskBacked: boolean): number => {
  if (diskBacked) {
    return resources.memoryMb;
  }
  return resources.memoryMb + resources.tmpfs.workspace + resources.tmpfs.tmp + resources.tmpfs.home;
};

/**
 * Build tmpfs mount options. Only used when workspace is NOT disk-backed.
 * When disk-backed, all writable paths (/workspace, /tmp, /home/opencode)
 * are bind-mounted from the host — no tmpfs overhead in RAM.
 */
export const buildTmpfsOptions = (
  resources: SkillResources,
  allTmpfs: boolean,
): Record<string, string> => {
  if (!allTmpfs) return {};

  return {
    "/tmp": `rw,exec,nosuid,nodev,uid=1001,gid=1001,mode=1777,size=${resources.tmpfs.tmp}m`,
    "/home/opencode": `rw,exec,nosuid,nodev,uid=1001,gid=1001,mode=0700,size=${resources.tmpfs.home}m`,
    "/workspace": `rw,exec,nosuid,nodev,uid=1001,gid=1001,mode=0755,size=${resources.tmpfs.workspace}m`,
  };
};

export const isWorkspaceBindMountError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /EROFS|read-only file system|error while creating mount source path|bind source path|mkdir ['"]?\/app\b/i.test(
    message,
  );
};

// ── Main builder ─────────────────────────────────────────────────────────────

export type ContainerSpecParams = {
  job: ClaimedJob;
  workItem: WorkItemDetails | null;
  runtimeConfig: RuntimeConfig;
  injectedEnv: Record<string, string>;
  openCodeConfig: Awaited<ReturnType<typeof buildInjectedEnv>>["openCodeConfig"];
  workspaceMountMode: "bind" | "tmpfs" | "volume";
  /** Host-side repos path, used for Docker volume mounts to sibling containers. */
  reposHostPath?: string;
};

export const buildContainerSpec = (params: ContainerSpecParams): RunnerContainerSpec => {
  const {
    job,
    workItem,
    runtimeConfig,
    injectedEnv,
    openCodeConfig,
    workspaceMountMode,
    reposHostPath,
  } = params;

  const config = normalizeJobConfig(job);
  const intent = resolveJobIntent(job);
  const tierResources = getResourcesForTier(resolveResourceTier(intent));
  const memoryRequirement = resolveJobMemoryRequirement(job);
  const resources: SkillResources = {
    ...tierResources,
    memoryMb: memoryRequirement.memoryMb,
  };
  const skillName =
    typeof config.skillName === "string" ? config.skillName : "implement";
  const taskId = workItem?.taskId ?? "";
  const mcpConfig = openCodeConfig.mcp ?? {};
  const hasMcp = Object.keys(mcpConfig).length > 0;

  // Build Codex-specific MCP config + extracted bearer tokens
  const codexMcp = hasMcp && runtimeConfig.type === "codex-shim"
    ? buildCodexMcpConfig(mcpConfig as Record<string, Record<string, unknown>>)
    : null;

  return {
    image: runtimeConfig.image,
    entrypoint: runtimeConfig.entrypoint,
    command: runtimeConfig.command,
    user: CONTAINER_USER,
    env: {
      ...injectedEnv,
      ...runtimeConfig.envVars,
      HOME: "/home/opencode",

      ALMIRANT_JOB_ID: job.id,
      ALMIRANT_WORK_ITEM_ID: workItem?.id ?? "",
      ALMIRANT_TASK_ID: taskId,
      SKILL_NAME: skillName,
      ENABLE_BROWSER: intent.needsBrowser ? "true" : (injectedEnv.ENABLE_BROWSER ?? ""),
      OPENCODE_START_MODE: "serve",
      WORKSPACE_REPO_PATH,
      OPENCODE_CONFIG_JSON:
        runtimeConfig.configFile === "opencode.json"
          ? JSON.stringify(openCodeConfig)
          : "",
      MCP_CONFIG_JSON:
        hasMcp ? JSON.stringify(mcpConfig) : "",
      CLAUDE_MCP_JSON:
        runtimeConfig.type === "claude-shim" && hasMcp
          ? JSON.stringify(buildClaudeMcpConfig(mcpConfig as Record<string, Record<string, unknown>>))
          : "",
      CODEX_MCP_JSON:
        codexMcp ? JSON.stringify(codexMcp.servers) : "",
      // Inject extracted bearer tokens as individual env vars for Codex
      ...(codexMcp?.tokenEnvVars ?? {}),
      // Agent containers have direct internet access (no egress proxy).
      // Full validation environment URLs (set by setupValidateEnvironment when applicable)
      ...(typeof (injectedEnv as Record<string, string>).VALIDATE_FRONTEND_URL === "string"
        ? { VALIDATE_FRONTEND_URL: (injectedEnv as Record<string, string>).VALIDATE_FRONTEND_URL }
        : {}),
    },
    labels: {
      "work-item-id": workItem?.id ?? "",
    },
    // Prefer a disk-backed bind mount when available; fall back to tmpfs for
    // read-only host filesystems or Docker-for-local-dev path issues.
    // In bind mode, ALL writable paths (/workspace, /tmp, /home/opencode)
    // are on disk — no tmpfs RAM overhead.
    // In volume mode (driver-managed storage, e.g. Kubernetes), emit logical
    // volumes without host paths — the driver resolves them to real storage.
    volumes: workspaceMountMode === "volume"
      ? [
          { source: "workspace", target: "/workspace" },
          { source: "tmp", target: "/tmp" },
          { source: "home", target: "/home/opencode" },
        ]
      : workspaceMountMode === "bind" && reposHostPath
        ? [
            { source: `${reposHostPath}/${job.id}`, target: "/workspace" },
            { source: `${reposHostPath}/${job.id}/.tmp`, target: "/tmp" },
            { source: `${reposHostPath}/${job.id}/.home`, target: "/home/opencode" },
          ]
        : undefined,
    tmpfs: buildTmpfsOptions(resources, workspaceMountMode === "tmpfs"),
    securityOpt: ["no-new-privileges:true"],
    capDrop: ["ALL"],
    readOnlyRootFs: true,
    cpuLimit: 2,
    memoryLimitMb: computeMemoryLimit(resources, workspaceMountMode !== "tmpfs")
      + (PROVIDER_MEMORY_BUMP[runtimeConfig.type] ?? 0),
    tty: true,
  };
};
