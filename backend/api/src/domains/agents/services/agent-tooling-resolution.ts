import { logger } from "@almirant/config";
import {
  getAgentMcpServersByIds,
  getAgentPluginMarketplacesByIds,
  getAgentPluginsByIds,
  getScheduledAgentMcpServerIds,
} from "@almirant/database";
import type { ScheduledAgentConfigDb, TargetConfig } from "@almirant/database";
import { normalizeRunnerCustomMcpServersConfig } from "@almirant/shared";
import type {
  AgentRuntimePluginReference,
  RunnerCustomMcpServersConfig,
} from "@almirant/shared";
import { buildAgentRuntimePluginReferences } from "./agent-plugin-runtime";

/**
 * Key under targetConfig.customFilters that the Agents v2 tooling wizard
 * persists MCP/plugin selection under. Backend-side mirror of
 * AGENT_TOOLING_SELECTION_KEY in
 * frontend/src/domains/scheduled-agents/application/hooks/use-agent-form-drawer.ts
 * (PR #86) -- backend cannot import frontend/, and the two sides must stay
 * byte-for-byte in sync on this string.
 *
 * This is a community-specific divergence from cloud: cloud bundles the
 * equivalent selection into a broader "__agent" adapter-metadata blob
 * (association/workspaceMode/needsBrowser/selectedSkillSlugs and friends)
 * that also drives an "independent agent" execution model community has not
 * ported. Community's wizard shipped a narrower, standalone key scoped to
 * just MCP/plugin selection, so this resolver reads that key directly
 * instead of porting agent-adapter-metadata.ts wholesale.
 */
export const AGENT_TOOLING_SELECTION_KEY = "__agentTooling";

const UUID_RE = /^[0-9a-fA-F-]{36}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeSelectedIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of value) {
    if (typeof id !== "string") continue;
    const trimmed = id.trim();
    if (!UUID_RE.test(trimmed)) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
};

export interface AgentToolingSelection {
  selectedMcpServerIds: string[];
  selectedPluginIds: string[];
}

/** Backend-side counterpart of the frontend's parseAgentToolingSelection. */
export const parseAgentToolingSelection = (
  targetConfig: TargetConfig | null | undefined,
): AgentToolingSelection => {
  const raw = targetConfig?.customFilters?.[AGENT_TOOLING_SELECTION_KEY];
  if (!isRecord(raw)) {
    return { selectedMcpServerIds: [], selectedPluginIds: [] };
  }
  return {
    selectedMcpServerIds: normalizeSelectedIds(raw.selectedMcpServerIds),
    selectedPluginIds: normalizeSelectedIds(raw.selectedPluginIds),
  };
};

export interface ResolvedAgentTooling {
  mcpServers: RunnerCustomMcpServersConfig | null;
  agentPlugins: AgentRuntimePluginReference[];
  selectedMcpServerIds: string[];
  selectedPluginIds: string[];
}

const normalizeResolvedMcpServers = (
  servers: RunnerCustomMcpServersConfig | null,
): RunnerCustomMcpServersConfig | null => {
  const normalized = normalizeRunnerCustomMcpServersConfig(servers);
  if (normalized.errors.length > 0) {
    throw new Error(`Invalid resolved MCP server config: ${normalized.errors.join("; ")}`);
  }
  return normalized.servers;
};

/**
 * Resolves a scheduled agent's dispatch-time tooling: the managed MCP server
 * profiles and plugins it was pinned to, materialized into the exact shapes
 * the runner reads off the job config (config-injector.ts cross-validates
 * `selectedMcpServerIds` against `mcpServers[*].almirantServerId`;
 * agent-plugin-materializer.ts consumes `agentPlugins` directly).
 *
 * Any legacy inline `scheduled_agent_configs.mcp_servers` blob (arbitrary
 * caller-supplied URLs/headers, pre-dating the managed-profile catalog) is
 * intentionally dropped rather than forwarded -- self-hosted users must
 * select a managed profile instead of embedding raw endpoints.
 */
export const resolveAgentTooling = async (
  config: Pick<
    ScheduledAgentConfigDb,
    "workspaceId" | "ownerUserId" | "targetConfig" | "mcpServers"
  > &
    Partial<Pick<ScheduledAgentConfigDb, "id">>,
): Promise<ResolvedAgentTooling> => {
  const selection = parseAgentToolingSelection(config.targetConfig);
  const associatedMcpServerIds = config.id
    ? await getScheduledAgentMcpServerIds(config.id)
    : [];
  // Compatibility for rows whose scheduled_agent_mcp_servers association
  // hasn't been (re)written yet: once associations exist they are
  // authoritative, otherwise fall back to the normalized JSON selection the
  // wizard persisted directly on target_config.
  const selectedMcpServerIds =
    associatedMcpServerIds.length > 0
      ? associatedMcpServerIds
      : selection.selectedMcpServerIds;
  const selectedPluginIds = selection.selectedPluginIds;

  if (config.mcpServers && Object.keys(config.mcpServers).length > 0) {
    logger.warn(
      { workspaceId: config.workspaceId },
      "Ignoring legacy inline MCP configuration; select a managed MCP profile instead",
    );
  }

  const resolvedServers: RunnerCustomMcpServersConfig = {};
  if (selectedMcpServerIds.length > 0) {
    const profiles = await getAgentMcpServersByIds(
      config.workspaceId,
      config.ownerUserId ?? null,
      selectedMcpServerIds,
    );
    const resolvedIds = new Set(profiles.map((profile) => profile.id));
    const missingIds = selectedMcpServerIds.filter((id) => !resolvedIds.has(id));
    if (missingIds.length > 0) {
      throw new Error(
        `Selected MCP profiles could not be resolved: ${missingIds.join(", ")}`,
      );
    }
    for (const profile of profiles) {
      if (profile.transport !== "remote") {
        throw new Error(
          `Selected MCP profile ${profile.id} uses unsupported transport ${profile.transport}`,
        );
      }
      if (resolvedServers[profile.slug]) {
        throw new Error(
          `Selected MCP profiles contain duplicate runtime slug: ${profile.slug}`,
        );
      }
      resolvedServers[profile.slug] = {
        type: "remote",
        url: profile.url,
        enabled: true,
        oauth: false,
        almirantServerId: profile.id,
      };
    }
  }

  const plugins =
    selectedPluginIds.length > 0
      ? await getAgentPluginsByIds(
          config.workspaceId,
          config.ownerUserId ?? null,
          selectedPluginIds,
        )
      : [];
  const resolvedPluginIds = new Set(plugins.map((plugin) => plugin.id));
  const missingPluginIds = selectedPluginIds.filter(
    (id) => !resolvedPluginIds.has(id),
  );
  if (missingPluginIds.length > 0) {
    throw new Error(
      `Selected plugins could not be resolved: ${missingPluginIds.join(", ")}`,
    );
  }
  const disabledPluginIds = plugins
    .filter((plugin) => !plugin.enabled)
    .map((plugin) => plugin.id);
  if (disabledPluginIds.length > 0) {
    throw new Error(`Selected plugins are disabled: ${disabledPluginIds.join(", ")}`);
  }
  const marketplaces = await getAgentPluginMarketplacesByIds(
    config.workspaceId,
    config.ownerUserId ?? null,
    plugins
      .map((plugin) => plugin.marketplaceId)
      .filter((id): id is string => Boolean(id)),
  );

  return {
    mcpServers: normalizeResolvedMcpServers(
      Object.keys(resolvedServers).length > 0 ? resolvedServers : null,
    ),
    agentPlugins: buildAgentRuntimePluginReferences(plugins, marketplaces),
    selectedMcpServerIds: [...selectedMcpServerIds],
    selectedPluginIds: [...selectedPluginIds],
  };
};
