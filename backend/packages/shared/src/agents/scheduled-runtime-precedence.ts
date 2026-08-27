import {
  LegacyRuntimeSelectionError,
  resolveLegacyRuntimeSelection,
} from "./legacy-runtime-selection-adapter";
import {
  runtimeCapabilityRegistry,
  type RuntimeAiProvider,
  type RuntimeAuthClass,
  type RuntimeCapabilityId,
  type RuntimeCodingAgent,
  type RuntimeReasoningEffort,
  type RuntimeRejectionCode,
} from "./runtime-capability-registry";

export const RESOLVED_SCHEDULED_RUNTIME_SCHEMA_VERSION =
  "resolved-scheduled-runtime-v1" as const;

export type ScheduledRuntimeSource = {
  provider?: string | null;
  codingAgent?: string | null;
  aiProvider?: string | null;
  model?: string | null;
  reasoningLevel?: string | null;
  authClass?: string | null;
  capabilities?: readonly string[] | null;
};

export type ScheduledRuntimeSourceName =
  | "rule"
  | "schedule"
  | "workItem"
  | "project"
  | "connection"
  | "legacy-default";

export type ScheduledRuntimeFieldResolution = Readonly<{
  source: ScheduledRuntimeSourceName;
  resolution: "source-value" | "legacy-adapter";
}>;

export type ScheduledRuntimeProvenance = Readonly<{
  [Field in keyof Required<ScheduledRuntimeSource>]: ScheduledRuntimeFieldResolution;
}>;

export type ResolvedScheduledRuntime = Readonly<{
  schemaVersion: typeof RESOLVED_SCHEDULED_RUNTIME_SCHEMA_VERSION;
  registryVersion: typeof runtimeCapabilityRegistry.version;
  projectionHash: string;
  provider: string;
  codingAgent: RuntimeCodingAgent;
  aiProvider: RuntimeAiProvider;
  model: string;
  reasoningLevel: string | null;
  authClass: RuntimeAuthClass;
  capabilities: readonly RuntimeCapabilityId[];
  reasoningEfforts: readonly RuntimeReasoningEffort[];
  provenance: ScheduledRuntimeProvenance;
}>;

const SCHEDULED_RUNTIME_VALIDATION_ERROR = "Invalid scheduled agent runtime";

export class ScheduledRuntimeAdmissionError extends Error {
  constructor(
    readonly code: RuntimeRejectionCode,
    readonly candidate: Readonly<{
      provider: string;
      codingAgent: string;
      aiProvider: string;
      model: string;
      authClass: string;
      capabilities: readonly string[];
    }>,
  ) {
    super(
      `${SCHEDULED_RUNTIME_VALIDATION_ERROR}: registry rejected ` +
        `codingAgent='${candidate.codingAgent}', aiProvider='${candidate.aiProvider}', ` +
        `model='${candidate.model}' with code '${code}'.`,
    );
    this.name = "ScheduledRuntimeAdmissionError";
  }
}

type NamedScheduledRuntimeSource = Readonly<{
  name: Exclude<ScheduledRuntimeSourceName, "legacy-default">;
  source: ScheduledRuntimeSource | null | undefined;
}>;

type SelectedString = Readonly<{
  value: string;
  source: Exclude<ScheduledRuntimeSourceName, "legacy-default">;
}>;

type SelectedCapabilities = Readonly<{
  value: readonly string[];
  source: Exclude<ScheduledRuntimeSourceName, "legacy-default">;
}>;

const selectedString = (
  sources: readonly NamedScheduledRuntimeSource[],
  key: Exclude<keyof ScheduledRuntimeSource, "capabilities">,
): SelectedString | null => {
  for (const { name, source } of sources) {
    const candidate = source?.[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return { value: candidate, source: name };
    }
  }
  return null;
};

const selectedCapabilities = (
  sources: readonly NamedScheduledRuntimeSource[],
): SelectedCapabilities | null => {
  for (const { name, source } of sources) {
    if (source?.capabilities !== undefined && source.capabilities !== null) {
      return { value: source.capabilities, source: name };
    }
  }
  return null;
};

const sourceValue = (
  source: Exclude<ScheduledRuntimeSourceName, "legacy-default">,
): ScheduledRuntimeFieldResolution => Object.freeze({
  source,
  resolution: "source-value",
});

const legacyDefault = (): ScheduledRuntimeFieldResolution => Object.freeze({
  source: "legacy-default",
  resolution: "legacy-adapter",
});

/**
 * Resolve scheduled fields independently in their persisted precedence order,
 * then submit the complete candidate to the authoritative registry exactly
 * once. Registry rejection is terminal: no field is repaired or re-derived.
 */
export const resolveScheduledRuntimePrecedence = (input: {
  rule?: ScheduledRuntimeSource | null;
  schedule?: ScheduledRuntimeSource | null;
  workItem?: ScheduledRuntimeSource | null;
  project?: ScheduledRuntimeSource | null;
  connection?: ScheduledRuntimeSource | null;
}): ResolvedScheduledRuntime => {
  const sources: readonly NamedScheduledRuntimeSource[] = [
    { name: "rule", source: input.rule },
    { name: "schedule", source: input.schedule },
    { name: "workItem", source: input.workItem },
    { name: "project", source: input.project },
    { name: "connection", source: input.connection },
  ];

  const selectedProvider = selectedString(sources, "provider");
  const selectedCodingAgent = selectedString(sources, "codingAgent");
  const selectedAiProvider = selectedString(sources, "aiProvider");
  const selectedModel = selectedString(sources, "model");
  const selectedReasoningLevel = selectedString(sources, "reasoningLevel");
  const selectedAuthClass = selectedString(sources, "authClass");
  const selectedRuntimeCapabilities = selectedCapabilities(sources);

  const legacyInput = {
    provider: selectedProvider?.value ?? selectedAiProvider?.value ?? undefined,
    codingAgent: selectedCodingAgent?.value ?? undefined,
    model: selectedModel?.value ?? undefined,
  };
  let legacyDefaults;
  try {
    legacyDefaults = resolveLegacyRuntimeSelection(legacyInput);
  } catch (error) {
    if (!(error instanceof LegacyRuntimeSelectionError)) throw error;
    // Preserve the unknown explicit value for authoritative registry rejection.
    // The adapter is retried only to fill genuinely missing legacy dimensions.
    legacyDefaults = resolveLegacyRuntimeSelection({
      provider: legacyInput.provider,
      model: legacyInput.model,
    });
  }

  const provider = selectedProvider?.value ?? legacyDefaults.provider;
  const codingAgent = selectedCodingAgent?.value === "codex-cli"
    ? legacyDefaults.codingAgent
    : selectedCodingAgent?.value ?? legacyDefaults.codingAgent;
  const aiProvider = selectedAiProvider?.value ?? legacyDefaults.aiProvider;
  const model = selectedModel?.value ?? legacyDefaults.model;
  const reasoningLevel = selectedReasoningLevel?.value ?? null;
  const authClass = selectedAuthClass?.value ?? "api_key";
  const capabilities = selectedRuntimeCapabilities?.value ?? [];

  const candidate = Object.freeze({
    provider,
    codingAgent,
    aiProvider,
    model,
    authClass,
    capabilities: Object.freeze([...capabilities]),
  });
  const admission = runtimeCapabilityRegistry.admit(candidate);
  if (!admission.admitted) {
    throw new ScheduledRuntimeAdmissionError(admission.code, candidate);
  }

  const provenance: ScheduledRuntimeProvenance = Object.freeze({
    provider: selectedProvider ? sourceValue(selectedProvider.source) : legacyDefault(),
    codingAgent: selectedCodingAgent
      ? Object.freeze({
          source: selectedCodingAgent.source,
          resolution: selectedCodingAgent.value === "codex-cli"
            ? "legacy-adapter"
            : "source-value",
        })
      : legacyDefault(),
    aiProvider: selectedAiProvider
      ? sourceValue(selectedAiProvider.source)
      : legacyDefault(),
    model: selectedModel ? sourceValue(selectedModel.source) : legacyDefault(),
    reasoningLevel: selectedReasoningLevel
      ? sourceValue(selectedReasoningLevel.source)
      : legacyDefault(),
    authClass: selectedAuthClass
      ? sourceValue(selectedAuthClass.source)
      : legacyDefault(),
    capabilities: selectedRuntimeCapabilities
      ? sourceValue(selectedRuntimeCapabilities.source)
      : legacyDefault(),
  });

  return Object.freeze({
    schemaVersion: RESOLVED_SCHEDULED_RUNTIME_SCHEMA_VERSION,
    registryVersion: admission.registryVersion,
    projectionHash: admission.projectionHash,
    provider,
    codingAgent: admission.selection.codingAgent,
    aiProvider: admission.selection.aiProvider,
    model: admission.selection.model,
    reasoningLevel,
    authClass: admission.selection.authClass,
    capabilities: Object.freeze([...admission.selection.capabilities]),
    reasoningEfforts: Object.freeze([...admission.tuple.reasoningEfforts]),
    provenance,
  });
};
