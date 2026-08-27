import {
  findActiveConnections,
  getProjectAiConfig,
  getProjects,
  mapAiProviderToConnectionProvider,
} from "@almirant/database";
import {
  resolveScheduledRuntimePrecedence,
  type ResolvedScheduledRuntime,
  type ScheduledRuntimeSource,
} from "@almirant/shared";
import {
  collectScheduledAgentConnectionRuntimes,
  normalizeScheduledAgentModel,
  resolveScheduledAgentAiProvider,
} from "./scheduled-agent-effective-models";

export type ScheduledAgentRuntimeResolutionInput = {
  workspaceId: string;
  provider?: string | null;
  codingAgent?: string | null;
  aiProvider?: string | null;
  aiModel?: string | null;
  reasoningLevel?: string | null;
  jobType: string;
  projectId?: string | null;
  targetConfig?: unknown;
};

const asRecord = (input: unknown): Record<string, unknown> =>
  typeof input === "object" && input !== null && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};

const codingAgentForProvider = (provider: string | null | undefined): string | null => {
  const value = provider?.trim().toLowerCase();
  if (value === "codex") return "codex";
  if (value === "zipu" || value === "grok") return "opencode";
  if (value === "claude-code") return "claude-code";
  return null;
};

const projectRules = (targetConfig: unknown): Array<ScheduledRuntimeSource & { projectId: string }> => {
  const target = asRecord(targetConfig);
  for (const key of ["backlogDrain", "dodRemediation"] as const) {
    const config = asRecord(target[key]);
    if (config.enabled !== true || !Array.isArray(config.projects)) continue;
    return config.projects.flatMap((raw) => {
      const rule = asRecord(raw);
      return typeof rule.projectId === "string" && rule.projectId.trim()
        ? [{
            projectId: rule.projectId.trim(),
            codingAgent: typeof rule.codingAgent === "string" ? rule.codingAgent : null,
            aiProvider: typeof rule.aiProvider === "string" ? rule.aiProvider : null,
            model: typeof rule.model === "string" ? rule.model : null,
            reasoningLevel: typeof rule.reasoningLevel === "string" ? rule.reasoningLevel : null,
          }]
        : [];
    });
  }
  return [];
};

const isBacklogStyle = (targetConfig: unknown): boolean => {
  const target = asRecord(targetConfig);
  return asRecord(target.backlogDrain).enabled === true ||
    asRecord(target.dodRemediation).enabled === true;
};

const dedupe = (runtimes: ResolvedScheduledRuntime[]): ResolvedScheduledRuntime[] => {
  const seen = new Set<string>();
  return runtimes.filter((runtime) => {
    const key = JSON.stringify(runtime);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** Resolve every runtime that execution may select, using the same pure precedence resolver as backlog selection. */
export const resolveScheduledAgentEffectiveRuntimes = async (
  input: ScheduledAgentRuntimeResolutionInput,
): Promise<ResolvedScheduledRuntime[]> => {
  const aiProvider = resolveScheduledAgentAiProvider(input);
  if (!aiProvider) return [];

  const explicitModel = normalizeScheduledAgentModel(input.aiModel);
  const schedule: ScheduledRuntimeSource = {
    provider: input.provider,
    codingAgent: input.codingAgent ?? codingAgentForProvider(input.provider),
    aiProvider,
    model: explicitModel,
    reasoningLevel: input.reasoningLevel,
  };

  const connections = explicitModel
    ? []
    : await findActiveConnections(
        mapAiProviderToConnectionProvider(aiProvider),
        "organization",
        input.workspaceId,
      );
  const connectionRuntimes = collectScheduledAgentConnectionRuntimes({
    aiProvider,
    jobType: input.jobType,
    connections,
  });

  const rules = projectRules(input.targetConfig);
  const backlogStyle = isBacklogStyle(input.targetConfig);
  let scopedProjects = rules.map((rule) => ({ projectId: rule.projectId, rule }));
  if (scopedProjects.length === 0 && input.projectId) {
    scopedProjects = [{ projectId: input.projectId, rule: { projectId: input.projectId } }];
  } else if (scopedProjects.length === 0 && backlogStyle) {
    const { projects } = await getProjects(input.workspaceId, { page: 1, limit: 1000, offset: 0 });
    scopedProjects = projects.map((project) => ({
      projectId: project.id,
      rule: { projectId: project.id },
    }));
  }

  const projectSources = await Promise.all(scopedProjects.map(async ({ projectId, rule }) => {
    const config = await getProjectAiConfig(projectId);
    const implementation = asRecord(asRecord(config.agentDefaults).implementation);
    return {
      rule,
      project: {
        codingAgent: typeof implementation.codingAgent === "string" ? implementation.codingAgent : null,
        aiProvider: typeof implementation.aiProvider === "string" ? implementation.aiProvider : null,
        model: typeof implementation.model === "string" ? implementation.model : null,
        reasoningLevel: typeof implementation.reasoningLevel === "string"
          ? implementation.reasoningLevel
          : null,
      } satisfies ScheduledRuntimeSource,
    };
  }));

  const connectionSources: Array<ScheduledRuntimeSource | undefined> = connectionRuntimes.length > 0
    ? connectionRuntimes.map((runtime) => ({ ...runtime, aiProvider }))
    : explicitModel || backlogStyle
      ? [undefined]
      : [];

  if (projectSources.length === 0) {
    return dedupe(connectionSources.map((connection) =>
      resolveScheduledRuntimePrecedence({ schedule, connection }),
    ));
  }

  if (connectionSources.length === 0) return [];
  return dedupe(projectSources.flatMap(({ rule, project }) =>
    connectionSources.map((connection) => resolveScheduledRuntimePrecedence({
      rule,
      schedule,
      project,
      connection,
    })),
  ));
};

export const resolveScheduledAgentEffectiveModels = async (
  input: ScheduledAgentRuntimeResolutionInput,
): Promise<string[]> => {
  const runtimes = await resolveScheduledAgentEffectiveRuntimes(input);
  return [...new Set(runtimes.map(({ model }) => model))];
};
