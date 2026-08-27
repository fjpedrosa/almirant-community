import type { ModelDefinition } from "@/domains/integrations/domain/types";
import generatedProjection from "@/generated/runtime-capability-projection.v1.json";
import { getModelsForProvider } from "@/lib/ai-models-catalog";
import type { RuntimeCapabilityProjectionGenerated } from "../../../../../backend/packages/shared/src/agents/runtime-capability-projection.generated";
import type { AgentProvider } from "./types";

/**
 * Runtime values and compatibility come from the generated projection. The
 * generated TypeScript artifact supplies literal types while the frontend only
 * loads the generated JSON artifact at runtime.
 */
export const runtimeCapabilityProjection =
  generatedProjection as unknown as RuntimeCapabilityProjectionGenerated;

export type CodingAgent =
  RuntimeCapabilityProjectionGenerated["codingAgents"][number];
export type AIProvider =
  RuntimeCapabilityProjectionGenerated["aiProviders"][number];
export type RuntimeCapabilityTuple =
  RuntimeCapabilityProjectionGenerated["tuples"][number];
export type RuntimeAuthClass =
  RuntimeCapabilityProjectionGenerated["authClasses"][number];
export type RuntimeCapabilityId =
  RuntimeCapabilityProjectionGenerated["capabilityIds"][number];
export type RuntimeRejectionCode =
  RuntimeCapabilityProjectionGenerated["rejectionCodes"][number];

export interface RuntimeCapabilityTupleFilters {
  codingAgent?: string | null;
  aiProvider?: string | null;
  model?: string | null;
  admissionEnabled?: boolean;
}

/** Includes disabled rows so capability-discovery surfaces can explain them. */
export const getRuntimeCapabilityTuples = (
  filters: RuntimeCapabilityTupleFilters = {},
): RuntimeCapabilityTuple[] =>
  runtimeCapabilityProjection.tuples.filter((tuple) =>
    (filters.codingAgent == null || tuple.codingAgent === filters.codingAgent) &&
    (filters.aiProvider == null || tuple.aiProvider === filters.aiProvider) &&
    (filters.model == null || tuple.model === filters.model) &&
    (filters.admissionEnabled == null ||
      tuple.admissionEnabled === filters.admissionEnabled)
  );

export interface RuntimeCapabilityAdmissionRequest {
  codingAgent: string;
  aiProvider: string;
  model: string;
  authClass: string;
  capabilities?: readonly string[];
  customProvider?: boolean;
}

export interface RuntimeCapabilityAdmissionAccepted {
  readonly admitted: true;
  readonly tuple: RuntimeCapabilityTuple;
  readonly registryVersion: RuntimeCapabilityProjectionGenerated["version"];
  readonly projectionHash: string;
}

export interface RuntimeCapabilityAdmissionRejected {
  readonly admitted: false;
  readonly code: RuntimeRejectionCode;
  readonly dimension:
    | "codingAgent"
    | "aiProvider"
    | "model"
    | "authClass"
    | "capability";
  readonly value: string;
  readonly registryVersion: RuntimeCapabilityProjectionGenerated["version"];
  readonly projectionHash: string;
}

export type RuntimeCapabilityAdmissionResult =
  | RuntimeCapabilityAdmissionAccepted
  | RuntimeCapabilityAdmissionRejected;

const rejectRuntimeCapabilityAdmission = (
  code: RuntimeRejectionCode,
  dimension: RuntimeCapabilityAdmissionRejected["dimension"],
  value: string,
): RuntimeCapabilityAdmissionRejected => ({
  admitted: false,
  code,
  dimension,
  value,
  registryVersion: runtimeCapabilityProjection.version,
  projectionHash: runtimeCapabilityProjection.hash,
});

/**
 * Frontend mirror of registry admission, evaluated only from the generated
 * projection. Rejection codes remain the shared, typed policy vocabulary.
 */
export const resolveRuntimeCapabilityAdmission = (
  request: RuntimeCapabilityAdmissionRequest,
): RuntimeCapabilityAdmissionResult => {
  if (!runtimeCapabilityProjection.codingAgents.some(
    (codingAgent) => codingAgent === request.codingAgent,
  )) {
    return rejectRuntimeCapabilityAdmission(
      "RUNTIME_CODING_AGENT_UNSUPPORTED",
      "codingAgent",
      request.codingAgent,
    );
  }

  const customProviderPolicy = runtimeCapabilityProjection.customProviderPolicies.find(
    (policy) => policy.codingAgent === request.codingAgent,
  );
  if (
    (request.customProvider === true || request.aiProvider === "custom") &&
    customProviderPolicy?.enabled === false
  ) {
    return rejectRuntimeCapabilityAdmission(
      customProviderPolicy.rejectionCode ?? "RUNTIME_AI_PROVIDER_UNSUPPORTED",
      "aiProvider",
      request.aiProvider,
    );
  }

  if (!runtimeCapabilityProjection.aiProviders.some(
    (aiProvider) => aiProvider === request.aiProvider,
  )) {
    return rejectRuntimeCapabilityAdmission(
      "RUNTIME_AI_PROVIDER_UNSUPPORTED",
      "aiProvider",
      request.aiProvider,
    );
  }

  const providerTuples = getRuntimeCapabilityTuples({
    codingAgent: request.codingAgent,
    aiProvider: request.aiProvider,
  });
  if (providerTuples.length === 0) {
    return rejectRuntimeCapabilityAdmission(
      "RUNTIME_AI_PROVIDER_UNSUPPORTED",
      "aiProvider",
      request.aiProvider,
    );
  }

  const tuple = providerTuples.find((candidate) => candidate.model === request.model);
  if (!tuple) {
    return rejectRuntimeCapabilityAdmission(
      "RUNTIME_MODEL_UNSUPPORTED",
      "model",
      request.model,
    );
  }

  if (!runtimeCapabilityProjection.authClasses.some(
    (authClass) => authClass === request.authClass,
  )) {
    return rejectRuntimeCapabilityAdmission(
      "RUNTIME_AUTH_CLASS_UNSUPPORTED",
      "authClass",
      request.authClass,
    );
  }

  const authPolicy = runtimeCapabilityProjection.authPolicies.find(
    (policy) =>
      policy.codingAgent === request.codingAgent &&
      policy.authClass === request.authClass,
  );
  if (authPolicy?.enabled === false) {
    return rejectRuntimeCapabilityAdmission(
      authPolicy.rejectionCode ?? "RUNTIME_AUTH_CLASS_UNSUPPORTED",
      "authClass",
      request.authClass,
    );
  }
  if (!tuple.authClasses.some((authClass) => authClass === request.authClass)) {
    return rejectRuntimeCapabilityAdmission(
      "RUNTIME_AUTH_CLASS_UNSUPPORTED",
      "authClass",
      request.authClass,
    );
  }

  for (const capability of request.capabilities ?? []) {
    if (!runtimeCapabilityProjection.capabilityIds.some(
      (candidate) => candidate === capability,
    )) {
      return rejectRuntimeCapabilityAdmission(
        "RUNTIME_CAPABILITY_UNSUPPORTED",
        "capability",
        capability,
      );
    }
    const policy = runtimeCapabilityProjection.capabilityPolicies.find(
      (candidate) =>
        candidate.codingAgent === request.codingAgent &&
        candidate.capability === capability,
    );
    if (policy?.rejectionCode) {
      return rejectRuntimeCapabilityAdmission(
        policy.rejectionCode,
        "capability",
        capability,
      );
    }
  }

  if (!tuple.admissionEnabled) {
    return rejectRuntimeCapabilityAdmission(
      tuple.rejectionCode ?? "RUNTIME_ADMISSION_DISABLED",
      "model",
      request.model,
    );
  }

  return {
    admitted: true,
    tuple,
    registryVersion: runtimeCapabilityProjection.version,
    projectionHash: runtimeCapabilityProjection.hash,
  };
};

export type RuntimeCapabilityPolicyResult =
  | { readonly available: true; readonly capability: RuntimeCapabilityId }
  | {
      readonly available: false;
      readonly code: RuntimeRejectionCode;
      readonly capability: string;
    };

/** Resolve one capability policy without inventing frontend allow/deny data. */
export const resolveRuntimeCapabilityPolicy = (
  codingAgent: string,
  capability: string,
): RuntimeCapabilityPolicyResult => {
  if (!runtimeCapabilityProjection.codingAgents.some(
    (candidate) => candidate === codingAgent,
  )) {
    return {
      available: false,
      code: "RUNTIME_CODING_AGENT_UNSUPPORTED",
      capability,
    };
  }
  const knownCapability = runtimeCapabilityProjection.capabilityIds.find(
    (candidate) => candidate === capability,
  );
  if (!knownCapability) {
    return {
      available: false,
      code: "RUNTIME_CAPABILITY_UNSUPPORTED",
      capability,
    };
  }
  const policy = runtimeCapabilityProjection.capabilityPolicies.find(
    (candidate) =>
      candidate.codingAgent === codingAgent &&
      candidate.capability === knownCapability,
  );
  if (policy?.enabled === false) {
    return {
      available: false,
      code: policy.rejectionCode ?? "RUNTIME_CAPABILITY_UNSUPPORTED",
      capability,
    };
  }
  return { available: true, capability: knownCapability };
};

/** Full selection result from the 3-step selector. */
export interface AgentSelection {
  codingAgent: CodingAgent;
  provider: AgentProvider;
  model?: string;
}

const codingAgentLabel = (agent: CodingAgent): string => {
  switch (agent) {
    case "claude-code":
      return "Claude Code";
    case "codex":
      return "Codex";
    case "opencode":
      return "OpenCode";
    case "pi":
      return "Pi";
  }
};

/** New-selection options intentionally omit agents with no admitted tuple. */
export const CODING_AGENT_OPTIONS: ReadonlyArray<{
  agent: CodingAgent;
  label: string;
}> = runtimeCapabilityProjection.codingAgents.flatMap((agent) =>
  getRuntimeCapabilityTuples({ codingAgent: agent, admissionEnabled: true }).length > 0
    ? [{ agent, label: codingAgentLabel(agent) }]
    : []
);

/** Derive the default coding agent from a provider (for backwards compat). */
export const defaultCodingAgentForProvider = (
  provider: AgentProvider | string | null,
): CodingAgent => {
  switch (provider) {
    case "claude-code":
      return "claude-code";
    case "codex":
      return "codex";
    case "zipu":
      return "claude-code";
    case "grok":
      return "opencode";
    default:
      // Legacy read-only consumers require a display fallback when a future or
      // default lane has no known mapping. The edit form preserves the raw lane
      // separately and never passes through this compatibility fallback.
      return "claude-code";
  }
};

/** Get AI provider name from the legacy agent-provider lane. */
export const agentProviderToAiProvider = (
  agentProvider: AgentProvider,
): AIProvider => {
  switch (agentProvider) {
    case "claude-code":
      return "anthropic";
    case "codex":
      return "openai";
    case "zipu":
      return "zai";
    case "grok":
      return "xai";
  }
};

// This is display order for the four existing legacy lanes, not a compatibility
// table. Compatibility itself is filtered exclusively from admitted tuples.
const LEGACY_AGENT_PROVIDER_ORDER: readonly AgentProvider[] = [
  "claude-code",
  "codex",
  "zipu",
  "grok",
];

/** Get admitted legacy provider lanes for a coding agent. */
export const getProvidersForAgent = (
  agent: CodingAgent,
): readonly AgentProvider[] => {
  const admittedAiProviders = new Set<string>(
    getRuntimeCapabilityTuples({ codingAgent: agent, admissionEnabled: true }).map(
      (tuple) => tuple.aiProvider,
    ),
  );

  return LEGACY_AGENT_PROVIDER_ORDER.filter((provider) =>
    admittedAiProviders.has(agentProviderToAiProvider(provider))
  );
};

/** Check if a coding agent has only one admitted legacy provider lane. */
export const isSingleProviderAgent = (agent: CodingAgent): boolean =>
  getProvidersForAgent(agent).length === 1;

/** Get admitted models for an exact coding-agent and legacy-provider pair. */
export function getModelsForAgentProvider(
  codingAgent: CodingAgent,
  agentProvider: AgentProvider,
): ModelDefinition[];
/** @deprecated Pass the coding agent explicitly; retained for legacy callers. */
export function getModelsForAgentProvider(
  agentProvider: AgentProvider,
): ModelDefinition[];
export function getModelsForAgentProvider(
  codingAgentOrProvider: CodingAgent | AgentProvider,
  maybeAgentProvider?: AgentProvider,
): ModelDefinition[] {
  const agentProvider = maybeAgentProvider ?? codingAgentOrProvider as AgentProvider;
  const codingAgent = maybeAgentProvider
    ? codingAgentOrProvider as CodingAgent
    : defaultCodingAgentForProvider(agentProvider);
  const aiProvider = agentProviderToAiProvider(agentProvider);
  const admittedModelIds = new Set<string>(
    getRuntimeCapabilityTuples({
      codingAgent,
      aiProvider,
      admissionEnabled: true,
    }).map((tuple) => tuple.model),
  );

  return getModelsForProvider(aiProvider, "agent-runtime").filter((model) =>
    admittedModelIds.has(model.id)
  );
}
