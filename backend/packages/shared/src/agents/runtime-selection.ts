import {
  runtimeCapabilityRegistry,
  type RuntimeAdmissionRejected,
  type RuntimeAiProvider,
  type RuntimeAuthClass,
  type RuntimeCapabilityId,
  type RuntimeCodingAgent,
} from "./runtime-capability-registry";
import { resolveLegacyRuntimeSelection } from "./legacy-runtime-selection-adapter";

/** Agent runner provider used by the legacy runtime-selection contract. */
export type AgentProvider = "claude-code" | "codex" | "zipu" | "grok";

/** Coding agents represented by the legacy runtime-selection contract. */
export type CodingAgentName = "claude-code" | "codex" | "opencode";

/** AI providers represented by the legacy runtime-selection contract. */
export type AiProviderName = "anthropic" | "openai" | "zai" | "xai";

/** Legacy resolved runtime shape retained for existing callers. */
export interface RuntimeSelection {
  provider: AgentProvider;
  codingAgent: CodingAgentName;
  aiProvider: AiProviderName;
  model: string;
}

/** Legacy input accepted by `resolveRuntime`. */
export interface RuntimeSelectionInput {
  provider?: string;
  codingAgent?: string;
  model?: string;
}

/**
 * Complete modern input. Every field is explicit: modern resolution never
 * infers, lowercases, aliases, or defaults any value.
 */
export interface RequestedRuntimeSelection {
  readonly provider: string;
  readonly codingAgent: string;
  readonly aiProvider: string;
  readonly model: string;
  readonly authClass: string;
  readonly capabilities: readonly string[];
}

export const RESOLVED_RUNTIME_SELECTION_SCHEMA_VERSION =
  "resolved-runtime-selection-v1" as const;

export type RuntimeSelectionProvenance = Readonly<{
  [Field in keyof RequestedRuntimeSelection]: "explicit";
}>;

/**
 * Immutable selection persisted or propagated after exact registry admission.
 * The registry version and projection hash bind the decision to the capability
 * contract that admitted it.
 */
export interface ResolvedRuntimeSelection {
  readonly schemaVersion: typeof RESOLVED_RUNTIME_SELECTION_SCHEMA_VERSION;
  readonly registryVersion: typeof runtimeCapabilityRegistry.version;
  readonly projectionHash: string;
  readonly provider: string;
  readonly codingAgent: RuntimeCodingAgent;
  readonly aiProvider: RuntimeAiProvider;
  readonly model: string;
  readonly authClass: RuntimeAuthClass;
  readonly capabilities: readonly RuntimeCapabilityId[];
  readonly provenance: RuntimeSelectionProvenance;
}

export interface RuntimeSelectionResolutionAccepted {
  readonly admitted: true;
  readonly selection: ResolvedRuntimeSelection;
}

/** Registry rejections pass through unchanged. */
export type RuntimeSelectionResolutionResult =
  | RuntimeSelectionResolutionAccepted
  | RuntimeAdmissionRejected;

const EXPLICIT_RUNTIME_SELECTION_PROVENANCE: RuntimeSelectionProvenance = Object.freeze({
  provider: "explicit",
  codingAgent: "explicit",
  aiProvider: "explicit",
  model: "explicit",
  authClass: "explicit",
  capabilities: "explicit",
});

/**
 * Admit a complete modern request exactly as supplied and return a deeply
 * frozen, versioned selection. Infrastructure `provider` is deliberately not
 * part of tuple admission and remains independent from all runtime dimensions.
 */
export const resolveRequestedRuntimeSelection = (
  request: RequestedRuntimeSelection,
): RuntimeSelectionResolutionResult => {
  const admission = runtimeCapabilityRegistry.admit({
    codingAgent: request.codingAgent,
    aiProvider: request.aiProvider,
    model: request.model,
    authClass: request.authClass,
    capabilities: request.capabilities,
  });

  if (!admission.admitted) {
    return admission;
  }

  const selection: ResolvedRuntimeSelection = Object.freeze({
    schemaVersion: RESOLVED_RUNTIME_SELECTION_SCHEMA_VERSION,
    registryVersion: admission.registryVersion,
    projectionHash: admission.projectionHash,
    provider: request.provider,
    codingAgent: admission.selection.codingAgent,
    aiProvider: admission.selection.aiProvider,
    model: admission.selection.model,
    authClass: admission.selection.authClass,
    capabilities: Object.freeze([...admission.selection.capabilities]),
    provenance: EXPLICIT_RUNTIME_SELECTION_PROVENANCE,
  });

  return Object.freeze({ admitted: true, selection });
};

/**
 * Backwards-compatible resolver for legacy callers. Defaults, inference,
 * aliases, and lowercasing intentionally live in the named legacy adapter.
 */
export const resolveRuntime = (input?: RuntimeSelectionInput): RuntimeSelection =>
  resolveLegacyRuntimeSelection(input);
