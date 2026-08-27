import {
  getRuntimeCapabilityTuples,
  resolveRuntimeCapabilityAdmission,
  resolveRuntimeCapabilityPolicy,
  runtimeCapabilityProjection,
  type AIProvider,
  type CodingAgent,
  type RuntimeCapabilityAdmissionResult,
  type RuntimeCapabilityId,
} from "@/domains/agents/domain/coding-agent-compatibility";
import type { ModelDefinition } from "@/domains/integrations/domain/types";
import { getModelsForProvider } from "@/lib/ai-models-catalog";
import type { BuiltinAutomationId } from "@/domains/scheduled-agents/domain/types";

export type ProjectRuntimeScope = "implementation" | "dev-flow-default" | BuiltinAutomationId;
export type ProjectRuntimeField = "legacyRunner" | "codingAgent" | "aiProvider" | "model" | "reasoningLevel";

const AI_CONFIG_PROVIDERS = ["claude-code", "codex", "zipu", "grok"] as const;

export const isAiConfigProvider = (
  value: string | null | undefined,
): value is (typeof AI_CONFIG_PROVIDERS)[number] =>
  AI_CONFIG_PROVIDERS.some((provider) => provider === value);

export interface ProjectRuntimeSelection {
  codingAgent: string | null | undefined;
  aiProvider: string | null | undefined;
  model: string | null | undefined;
  reasoningLevel?: string | null | undefined;
}

export interface RetainedProjectRuntimeField {
  field: ProjectRuntimeField;
  value: string | null;
}

export interface DefaultProjectRuntimeSelection {
  codingAgent: CodingAgent;
  aiProvider: AIProvider;
  model: string;
  reasoningLevel: null;
}

const requiredCapabilitiesForScope = (
  scope: ProjectRuntimeScope,
): readonly RuntimeCapabilityId[] =>
  scope === "dev-flow-default" || scope === "dod-review"
    ? ["read_only_enforced"]
    : [];

const isCodingAgentAllowedForScope = (
  codingAgent: string,
  scope: ProjectRuntimeScope,
): boolean =>
  requiredCapabilitiesForScope(scope).every(
    (capability) => resolveRuntimeCapabilityPolicy(codingAgent, capability).available,
  );

const admittedTuplesForScope = (scope: ProjectRuntimeScope) =>
  getRuntimeCapabilityTuples({ admissionEnabled: true }).filter(
    (tuple) =>
      tuple.authClasses.some((authClass) => authClass === "api_key") &&
      isCodingAgentAllowedForScope(tuple.codingAgent, scope),
  );

export const getProjectRuntimeCodingAgents = (
  scope: ProjectRuntimeScope,
): CodingAgent[] => {
  const allowed = new Set(admittedTuplesForScope(scope).map((tuple) => tuple.codingAgent));
  return runtimeCapabilityProjection.codingAgents.filter((codingAgent) => allowed.has(codingAgent));
};

export const getProjectRuntimeAiProviders = (
  scope: ProjectRuntimeScope,
  codingAgent: string | null | undefined,
): AIProvider[] => {
  if (!codingAgent) return [];
  const allowed = new Set(
    admittedTuplesForScope(scope)
      .filter((tuple) => tuple.codingAgent === codingAgent)
      .map((tuple) => tuple.aiProvider),
  );
  return runtimeCapabilityProjection.aiProviders.filter((aiProvider) => allowed.has(aiProvider));
};

export const getProjectRuntimeModels = (
  scope: ProjectRuntimeScope,
  codingAgent: string | null | undefined,
  aiProvider: string | null | undefined,
): ModelDefinition[] => {
  if (!codingAgent || !aiProvider) return [];
  const admittedModelIds = new Set<string>(
    admittedTuplesForScope(scope)
      .filter(
        (tuple) =>
          tuple.codingAgent === codingAgent && tuple.aiProvider === aiProvider,
      )
      .map((tuple) => tuple.model),
  );
  return getModelsForProvider(aiProvider, "agent-runtime").filter((model) =>
    admittedModelIds.has(model.id),
  );
};

export const getDefaultProjectRuntimeSelection = (
  scope: ProjectRuntimeScope,
  codingAgent: CodingAgent,
): DefaultProjectRuntimeSelection => {
  const providers = getProjectRuntimeAiProviders(scope, codingAgent);
  // Preserve Community's established OpenCode/Z.AI starting lane while every
  // offered provider/model still comes from admitted projection tuples.
  const preferredProvider = codingAgent === "opencode" ? "zai" : providers[0];
  const aiProvider = providers.includes(preferredProvider as AIProvider)
    ? preferredProvider as AIProvider
    : providers[0];
  if (!aiProvider) {
    throw new Error(`No admitted project runtime provider for ${codingAgent} in ${scope}`);
  }

  const models = getProjectRuntimeModels(scope, codingAgent, aiProvider);
  const projectedDefault = runtimeCapabilityProjection.defaults.find(
    (candidate) => candidate.aiProvider === aiProvider,
  )?.model;
  const model = models.find((candidate) => candidate.id === projectedDefault)?.id ?? models[0]?.id;
  if (!model) {
    throw new Error(`No admitted project runtime model for ${codingAgent}/${aiProvider} in ${scope}`);
  }

  return { codingAgent, aiProvider, model, reasoningLevel: null };
};

export const getDefaultProjectModel = (
  scope: ProjectRuntimeScope,
  codingAgent: string | null | undefined,
  aiProvider: string | null | undefined,
): string | null => {
  const models = getProjectRuntimeModels(scope, codingAgent, aiProvider);
  const projectedDefault = runtimeCapabilityProjection.defaults.find(
    (candidate) => candidate.aiProvider === aiProvider,
  )?.model;
  return models.find((candidate) => candidate.id === projectedDefault)?.id ?? models[0]?.id ?? null;
};

export const resolveProjectRuntimeAdmission = (
  scope: ProjectRuntimeScope,
  selection: ProjectRuntimeSelection,
): RuntimeCapabilityAdmissionResult =>
  resolveRuntimeCapabilityAdmission({
    codingAgent: selection.codingAgent ?? "",
    aiProvider: selection.aiProvider ?? "",
    model: selection.model ?? "",
    authClass: "api_key",
    capabilities: requiredCapabilitiesForScope(scope),
  });

export const getRetainedProjectRuntimeFields = (
  scope: ProjectRuntimeScope,
  selection: ProjectRuntimeSelection,
): RetainedProjectRuntimeField[] => {
  const retained: RetainedProjectRuntimeField[] = [];
  const codingAgents = getProjectRuntimeCodingAgents(scope);
  const codingAgent = selection.codingAgent ?? null;
  const aiProvider = selection.aiProvider ?? null;
  const model = selection.model ?? null;
  const reasoningLevel = selection.reasoningLevel ?? null;

  if (!codingAgent || !codingAgents.some((candidate) => candidate === codingAgent)) {
    retained.push({ field: "codingAgent", value: codingAgent });
  }

  const aiProviders = getProjectRuntimeAiProviders(scope, codingAgent);
  if (!aiProvider || !aiProviders.some((candidate) => candidate === aiProvider)) {
    retained.push({ field: "aiProvider", value: aiProvider });
  }

  const models = getProjectRuntimeModels(scope, codingAgent, aiProvider);
  if (!model || !models.some((candidate) => candidate.id === model)) {
    retained.push({ field: "model", value: model });
  }

  if (reasoningLevel) {
    const tuple = admittedTuplesForScope(scope).find(
      (candidate) =>
        candidate.codingAgent === codingAgent &&
        candidate.aiProvider === aiProvider &&
        candidate.model === model,
    );
    if (!tuple?.reasoningEfforts.some((effort) => effort === reasoningLevel)) {
      retained.push({ field: "reasoningLevel", value: reasoningLevel });
    }
  }

  return retained;
};
