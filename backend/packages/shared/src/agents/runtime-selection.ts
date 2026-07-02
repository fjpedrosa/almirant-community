/**
 * Shared runtime selection resolver for agent provider, coding agent, AI provider, and model.
 *
 * This module is the single source of truth for resolving the 4 runtime dimensions
 * from any combination of legacy and modern input values. All route handlers and
 * WS message routers MUST use `resolveRuntime()` instead of inline normalization.
 *
 * Design: `codingAgent` is the PRIMARY dimension of ownership.
 * `provider` (agent runner) is derived from `codingAgent` when not explicitly set.
 * "zipu" is encapsulated as a LEGACY alias that maps to the "opencode" coding agent.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Agent runner provider (the infrastructure that executes the job). */
export type AgentProvider = "claude-code" | "codex" | "zipu" | "grok";

/** The coding agent that actually processes the task. */
export type CodingAgentName = "claude-code" | "codex" | "opencode";

/** The AI provider used for credential / key resolution. */
export type AiProviderName = "anthropic" | "openai" | "zai" | "xai";

/** Fully resolved runtime selection -- all 4 dimensions populated. */
export interface RuntimeSelection {
  provider: AgentProvider;
  codingAgent: CodingAgentName;
  aiProvider: AiProviderName;
  model: string;
}

/** Input accepted by `resolveRuntime`. All fields are optional. */
export interface RuntimeSelectionInput {
  /** Provider hint -- may be an agent provider ("zipu") or AI provider alias ("zai"). */
  provider?: string;
  /** Explicit coding agent override. When set, takes precedence over provider-based derivation. */
  codingAgent?: string;
  /** Explicit model override. When set, takes precedence over the provider default. */
  model?: string;
}

// ---------------------------------------------------------------------------
// Internal lookup tables
// ---------------------------------------------------------------------------

/** Canonical mapping: provider -> { codingAgent, aiProvider, defaultModel } */
const PROVIDER_MAP: Record<AgentProvider, {
  codingAgent: CodingAgentName;
  aiProvider: AiProviderName;
  defaultModel: string;
}> = {
  "claude-code": { codingAgent: "claude-code", aiProvider: "anthropic", defaultModel: "claude-opus-4-8" },
  codex:         { codingAgent: "codex",       aiProvider: "openai",    defaultModel: "gpt-5.5" },
  zipu:          { codingAgent: "opencode",    aiProvider: "zai",       defaultModel: "glm-5.1" },
  grok:          { codingAgent: "opencode",    aiProvider: "xai",       defaultModel: "grok-4.20-reasoning" },
};

/** Aliases that callers may send instead of the canonical provider name. */
const PROVIDER_ALIASES: Record<string, AgentProvider> = {
  // AI provider names used as legacy aliases
  zai:        "zipu",
  xai:        "grok",
  openai:     "codex",
  anthropic:  "claude-code",
  // Canonical names (identity mapping for uniform lookup)
  zipu:         "zipu",
  grok:         "grok",
  codex:        "codex",
  "claude-code": "claude-code",
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve the full runtime selection from an optional input object.
 *
 * Resolution order:
 * 1. Normalize `provider` through the alias table (default: "claude-code").
 * 2. Derive `codingAgent` from the provider unless the caller supplies an explicit override.
 * 3. Derive `aiProvider` from the resolved provider.
 * 4. Derive `model` from the provider default unless the caller supplies an explicit override.
 *
 * @example
 * ```ts
 * resolveRuntime({ provider: "zai" })
 * // => { provider: "zipu", codingAgent: "opencode", aiProvider: "zai", model: "glm-5.1" }
 *
 * resolveRuntime({ provider: "claude-code", model: "claude-sonnet-4-20250514" })
 * // => { provider: "claude-code", codingAgent: "claude-code", aiProvider: "anthropic", model: "claude-sonnet-4-20250514" }
 *
 * resolveRuntime({})
 * // => { provider: "claude-code", codingAgent: "claude-code", aiProvider: "anthropic", model: "claude-opus-4-8" }
 * ```
 */
export const resolveRuntime = (input?: RuntimeSelectionInput): RuntimeSelection => {
  const provider: AgentProvider =
    (input?.provider ? PROVIDER_ALIASES[input.provider] : undefined) ?? "claude-code";

  const defaults = PROVIDER_MAP[provider];

  const codingAgent: CodingAgentName =
    isValidCodingAgent(input?.codingAgent) ? input.codingAgent : defaults.codingAgent;

  const model: string = input?.model ?? defaults.defaultModel;

  return {
    provider,
    codingAgent,
    aiProvider: defaults.aiProvider,
    model,
  };
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const VALID_CODING_AGENTS = new Set<string>(["claude-code", "codex", "opencode"]);

function isValidCodingAgent(value: string | undefined | null): value is CodingAgentName {
  return typeof value === "string" && VALID_CODING_AGENTS.has(value);
}
