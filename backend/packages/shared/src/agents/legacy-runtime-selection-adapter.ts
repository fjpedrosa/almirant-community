import type {
  AgentProvider,
  AiProviderName,
  CodingAgentName,
  RuntimeSelection,
  RuntimeSelectionInput,
} from "./runtime-selection";

interface LegacyProviderDefaults {
  readonly codingAgent: CodingAgentName;
  readonly aiProvider: AiProviderName;
  readonly defaultModel: string;
}

const LEGACY_PROVIDER_DEFAULTS: Readonly<Record<AgentProvider, LegacyProviderDefaults>> = {
  "claude-code": {
    codingAgent: "claude-code",
    aiProvider: "anthropic",
    defaultModel: "claude-opus-4-8",
  },
  codex: {
    codingAgent: "codex",
    aiProvider: "openai",
    defaultModel: "gpt-5.6-sol",
  },
  zipu: {
    codingAgent: "opencode",
    aiProvider: "zai",
    defaultModel: "glm-5.2",
  },
  grok: {
    codingAgent: "opencode",
    aiProvider: "xai",
    defaultModel: "grok-4.3",
  },
};

const LEGACY_PROVIDER_ALIASES: Readonly<Record<string, AgentProvider>> = {
  anthropic: "claude-code",
  "claude-code": "claude-code",
  codex: "codex",
  "codex-cli": "codex",
  grok: "grok",
  openai: "codex",
  xai: "grok",
  zai: "zipu",
  zipu: "zipu",
};

const LEGACY_RUNNER_PROVIDER_CODING_AGENTS: Readonly<
  Record<string, CodingAgentName>
> = {
  anthropic: "claude-code",
  "claude-code": "claude-code",
  zipu: "claude-code",
  zai: "claude-code",
  codex: "codex",
  openai: "codex",
  grok: "opencode",
  xai: "opencode",
};

const LEGACY_CODING_AGENT_PROVIDERS: Readonly<Record<CodingAgentName, AgentProvider>> = {
  "claude-code": "claude-code",
  codex: "codex",
  opencode: "zipu",
};

const LEGACY_CODING_AGENT_ALIASES: Readonly<Record<string, string>> = {
  "codex-cli": "codex",
};

const LEGACY_CODING_AGENTS: ReadonlySet<string> = new Set([
  "claude-code",
  "codex",
  "opencode",
]);

/** Lowercase and canonicalize aliases at the explicit legacy boundary. */
export const normalizeLegacyCodingAgentAlias = (codingAgent: string): string => {
  const normalized = codingAgent.toLowerCase();
  return LEGACY_CODING_AGENT_ALIASES[normalized] ?? normalized;
};

/**
 * Preserve the runner's historical provider-only dispatch independently from
 * shared legacy runtime defaults. A null result requires the caller to reject
 * the unknown provider rather than selecting a fallback executor.
 */
export const resolveLegacyRunnerCodingAgent = (
  provider: string,
): CodingAgentName | null =>
  LEGACY_RUNNER_PROVIDER_CODING_AGENTS[provider.trim().toLowerCase()] ?? null;

const isLegacyCodingAgent = (value: string): value is CodingAgentName =>
  LEGACY_CODING_AGENTS.has(value);

export class LegacyRuntimeSelectionError extends Error {
  readonly code = "RUNTIME_CODING_AGENT_UNSUPPORTED" as const;

  constructor(readonly codingAgent: string) {
    super(`Unsupported legacy coding agent: ${codingAgent}`);
    this.name = "LegacyRuntimeSelectionError";
  }
}

/**
 * Anti-corruption adapter for incomplete historical runtime inputs.
 *
 * This is the only owner of legacy defaults, provider inference, aliases, and
 * lowercasing. Unknown non-empty coding-agent values fail closed rather than
 * being interpreted as missing.
 */
export const resolveLegacyRuntimeSelection = (
  input?: RuntimeSelectionInput,
): RuntimeSelection => {
  let requestedCodingAgent: CodingAgentName | undefined;
  if (input?.codingAgent) {
    const normalizedCodingAgent = normalizeLegacyCodingAgentAlias(input.codingAgent);
    if (!isLegacyCodingAgent(normalizedCodingAgent)) {
      throw new LegacyRuntimeSelectionError(input.codingAgent);
    }
    requestedCodingAgent = normalizedCodingAgent;
  }

  const inferredProvider = requestedCodingAgent
    ? LEGACY_CODING_AGENT_PROVIDERS[requestedCodingAgent]
    : undefined;
  const normalizedProvider = input?.provider?.toLowerCase();
  const provider: AgentProvider =
    (normalizedProvider ? LEGACY_PROVIDER_ALIASES[normalizedProvider] : undefined) ??
    inferredProvider ??
    "claude-code";
  const defaults = LEGACY_PROVIDER_DEFAULTS[provider];

  return {
    provider,
    codingAgent: requestedCodingAgent ?? defaults.codingAgent,
    aiProvider: defaults.aiProvider,
    model: input?.model ?? defaults.defaultModel,
  };
};
