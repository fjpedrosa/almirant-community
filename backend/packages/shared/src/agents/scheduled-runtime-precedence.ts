import { getDefaultAgentModel } from "./model-capabilities";

export type ScheduledRuntimeSource = {
  provider?: string | null;
  codingAgent?: string | null;
  aiProvider?: string | null;
  model?: string | null;
  reasoningLevel?: string | null;
};

export type ResolvedScheduledRuntime = {
  provider: string;
  codingAgent: string;
  aiProvider: string;
  model: string;
  reasoningLevel: string | null;
};

const value = (input: string | null | undefined): string | null => {
  if (typeof input !== "string") return null;
  const normalized = input.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
};

const first = (
  sources: readonly (ScheduledRuntimeSource | null | undefined)[],
  key: keyof ScheduledRuntimeSource,
): string | null => {
  for (const source of sources) {
    const candidate = value(source?.[key]);
    if (candidate) return candidate;
  }
  return null;
};

const inferAiProvider = (model: string | null): string | null => {
  if (!model) return null;
  if (model.startsWith("glm-")) return "zai";
  if (model.startsWith("grok-")) return "xai";
  if (model.startsWith("claude-")) return "anthropic";
  if (model.startsWith("gpt-") || model.startsWith("codex-")) return "openai";
  if (model.startsWith("gemini-")) return "google";
  return null;
};

const aiProviderForCodingAgent = (codingAgent: string): string => {
  if (codingAgent === "codex" || codingAgent === "codex-cli") return "openai";
  if (codingAgent === "opencode") return "zai";
  return "anthropic";
};

const providerForRuntime = (codingAgent: string, aiProvider: string): string => {
  if (aiProvider === "zai") return "zipu";
  if (aiProvider === "xai") return "grok";
  if (aiProvider === "openai") return "codex";
  if (aiProvider === "anthropic") return "claude-code";
  return codingAgent === "codex" ? "codex" : "claude-code";
};

/**
 * Resolve the exact runtime precedence used by unattended execution:
 * project rule > scheduled config > work item > project defaults > active
 * connection > provider default. Keeping this pure makes it usable by both
 * database candidate selection and API validation/execution.
 */
export const resolveScheduledRuntimePrecedence = (input: {
  rule?: ScheduledRuntimeSource | null;
  schedule?: ScheduledRuntimeSource | null;
  workItem?: ScheduledRuntimeSource | null;
  project?: ScheduledRuntimeSource | null;
  connection?: ScheduledRuntimeSource | null;
}): ResolvedScheduledRuntime => {
  const sources = [
    input.rule,
    input.schedule,
    input.workItem,
    input.project,
    input.connection,
  ];

  const selectedModel = first(sources, "model");
  const codingAgent = first(sources, "codingAgent") ?? "claude-code";
  const aiProvider = first(sources, "aiProvider") ??
    inferAiProvider(selectedModel) ??
    aiProviderForCodingAgent(codingAgent);
  const model = selectedModel ?? getDefaultAgentModel(aiProvider) ??
    getDefaultAgentModel(aiProviderForCodingAgent(codingAgent)) ??
    "claude-opus-4-8";

  return {
    provider: providerForRuntime(codingAgent, aiProvider),
    codingAgent,
    aiProvider,
    model,
    reasoningLevel: first(sources, "reasoningLevel"),
  };
};
