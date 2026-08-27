import {
  RESOLVED_RUNTIME_SELECTION_SCHEMA_VERSION,
  createRuntimeFailure,
  resolveLegacyRunnerCodingAgent,
  runtimeCapabilityRegistry,
  runtimeFailureFromCauseCode,
  type ResolvedRuntimeSelection,
  type RuntimeFailure,
  type RuntimeFailureCategory,
  type RuntimeRejectionCode,
} from "@almirant/shared";
import type { CanonicalCodingAgent } from "@almirant/remote-agent";
import type {
  RuntimeExecutor,
  RuntimeExecutorRegistry,
  RuntimeType,
} from "../shared/types";
import { claudeRuntimeExecutor } from "./claude";
import { codexRuntimeExecutor } from "./codex";
import { opencodeRuntimeExecutor } from "./opencode";
import { piRuntimeExecutor } from "./pi";

export type RuntimeExecutorResolutionCode =
  | RuntimeRejectionCode
  | "RUNTIME_TYPE_UNSUPPORTED";

export class RuntimeExecutorResolutionError extends Error {
  readonly classification: "permanent_auth" | "permanent_config";
  readonly runtimeFailure: RuntimeFailure;
  readonly category: RuntimeFailureCategory;
  readonly retryable: boolean;

  constructor(
    readonly code: RuntimeExecutorResolutionCode,
    _detail: string,
  ) {
    const runtimeFailure =
      runtimeFailureFromCauseCode(code) ??
      createRuntimeFailure("RUNTIME_POLICY_FAILURE");
    super(`${code}: ${runtimeFailure.message}`);
    this.name = "RuntimeExecutorResolutionError";
    this.runtimeFailure = runtimeFailure;
    this.category = runtimeFailure.category;
    this.retryable = runtimeFailure.retryable;
    this.classification =
      runtimeFailure.category === "auth" ? "permanent_auth" : "permanent_config";
  }
}

const EXECUTORS: readonly RuntimeExecutor[] = [
  claudeRuntimeExecutor,
  codexRuntimeExecutor,
  opencodeRuntimeExecutor,
  piRuntimeExecutor,
];

const ACCEPTED_CODING_AGENTS: readonly CanonicalCodingAgent[] = Object.freeze(
  EXECUTORS.map((executor) => executor.codingAgent),
);

const executorByRuntimeType = new Map<RuntimeType, RuntimeExecutor>(
  EXECUTORS.map((executor) => [executor.runtimeType, executor]),
);

const executorByCodingAgent = new Map<string, RuntimeExecutor>(
  EXECUTORS.map((executor) => [executor.codingAgent, executor]),
);

const resolveExecutorByCodingAgent = (codingAgent: string): RuntimeExecutor => {
  const executor = executorByCodingAgent.get(codingAgent);
  if (!executor) {
    throw new RuntimeExecutorResolutionError(
      "RUNTIME_CODING_AGENT_UNSUPPORTED",
      `Unsupported coding agent: ${codingAgent || "<empty>"}`,
    );
  }
  return executor;
};

const rejectResolution = (
  code: RuntimeRejectionCode,
  detail: string,
): never => {
  throw new RuntimeExecutorResolutionError(code, detail);
};

export const createRuntimeExecutorRegistry = (): RuntimeExecutorRegistry => ({
  acceptedCodingAgents: ACCEPTED_CODING_AGENTS,
  admitResolvedRuntimeSelection: (selection: ResolvedRuntimeSelection) => {
    if (selection.schemaVersion !== RESOLVED_RUNTIME_SELECTION_SCHEMA_VERSION) {
      return rejectResolution(
        "RUNTIME_REGISTRY_VERSION_MISMATCH",
        `Unsupported resolved selection schema: ${String(selection.schemaVersion)}`,
      );
    }

    const capabilities = Array.isArray(selection.capabilities)
      ? selection.capabilities
      : ["<invalid-capabilities>"];
    const admission = runtimeCapabilityRegistry.admit({
      codingAgent: selection.codingAgent,
      aiProvider: selection.aiProvider,
      model: selection.model,
      authClass: selection.authClass,
      capabilities,
      registryVersion: selection.registryVersion,
      projectionHash: selection.projectionHash,
    });

    if (!admission.admitted) {
      return rejectResolution(
        admission.code,
        `Runtime selection rejected for ${String(selection.codingAgent)}/${String(selection.aiProvider)}/${String(selection.model)}`,
      );
    }

    // Infrastructure provider never participates in modern runtime dispatch.
    return resolveExecutorByCodingAgent(admission.selection.codingAgent);
  },
  resolve: ({ provider, codingAgent }) => {
    if (codingAgent !== undefined) {
      return resolveExecutorByCodingAgent(codingAgent);
    }

    const legacyCodingAgent = resolveLegacyRunnerCodingAgent(provider);
    if (legacyCodingAgent === null) {
      throw new RuntimeExecutorResolutionError(
        "RUNTIME_CODING_AGENT_UNSUPPORTED",
        `Unsupported legacy runner provider: ${provider || "<empty>"}`,
      );
    }
    return resolveExecutorByCodingAgent(legacyCodingAgent);
  },
  resolveByRuntimeType: (runtimeType) => {
    const executor = executorByRuntimeType.get(runtimeType as RuntimeType);
    if (!executor) {
      throw new RuntimeExecutorResolutionError(
        "RUNTIME_TYPE_UNSUPPORTED",
        `Unsupported runtime type: ${runtimeType || "<empty>"}`,
      );
    }
    return executor;
  },
});
