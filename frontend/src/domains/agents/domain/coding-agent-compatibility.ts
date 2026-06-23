import type { AgentProvider } from "./types";
import { getModelsForProvider } from "@/lib/ai-models-catalog";
import type { ModelDefinition } from "@/domains/integrations/domain/types";

export type CodingAgent = "claude-code" | "codex" | "opencode";

/** Full selection result from the 3-step selector */
export interface AgentSelection {
  codingAgent: CodingAgent;
  provider: AgentProvider;
  model?: string;
}

/** Valid provider combinations for each coding agent */
export const CODING_AGENT_PROVIDERS: Record<CodingAgent, readonly AgentProvider[]> = {
  "claude-code": ["claude-code", "zipu"],
  "codex": ["codex"],
  "opencode": ["codex", "zipu", "grok"],
};

/** Map agent provider to AI provider for model catalog lookup */
const AGENT_PROVIDER_TO_AI_PROVIDER: Record<AgentProvider, string> = {
  "claude-code": "anthropic",
  "codex": "openai",
  "zipu": "zai",
  "grok": "xai",
};

export const CODING_AGENT_OPTIONS: ReadonlyArray<{
  agent: CodingAgent;
  label: string;
}> = [
  { agent: "claude-code", label: "Claude Code" },
  { agent: "codex", label: "Codex" },
  { agent: "opencode", label: "OpenCode" },
] as const;

/** Derive the default coding agent from a provider (for backwards compat) */
export const defaultCodingAgentForProvider = (provider: AgentProvider): CodingAgent => {
  switch (provider) {
    case "claude-code": return "claude-code";
    case "codex": return "codex";
    case "zipu": return "claude-code";
    case "grok": return "opencode";
  }
};

/** Get compatible providers for a coding agent */
export const getProvidersForAgent = (agent: CodingAgent): readonly AgentProvider[] =>
  CODING_AGENT_PROVIDERS[agent];

/** Check if a coding agent has only one compatible provider */
export const isSingleProviderAgent = (agent: CodingAgent): boolean =>
  CODING_AGENT_PROVIDERS[agent].length === 1;

/** Get available models for an agent provider (maps to AI provider catalog) */
export const getModelsForAgentProvider = (agentProvider: AgentProvider): ModelDefinition[] =>
  getModelsForProvider(AGENT_PROVIDER_TO_AI_PROVIDER[agentProvider]);

/** Get AI provider name from agent provider */
export const agentProviderToAiProvider = (agentProvider: AgentProvider): string =>
  AGENT_PROVIDER_TO_AI_PROVIDER[agentProvider];
