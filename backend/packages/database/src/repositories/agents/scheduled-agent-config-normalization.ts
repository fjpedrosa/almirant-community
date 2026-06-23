const LEGACY_SCHEDULED_CODING_AGENT_ALIASES: Record<string, string> = {
  "codex-cli": "codex",
};

export const normalizeScheduledCodingAgent = (
  codingAgent: string | null | undefined,
): string | null | undefined => {
  if (codingAgent == null) {
    return codingAgent;
  }

  return LEGACY_SCHEDULED_CODING_AGENT_ALIASES[codingAgent] ?? codingAgent;
};

export const normalizeScheduledAgentConfig = <T extends { codingAgent: string | null }>(
  config: T,
): T => ({
  ...config,
  codingAgent: normalizeScheduledCodingAgent(config.codingAgent) ?? null,
});

export const normalizeScheduledAgentConfigInput = <T extends object>(data: T): T => {
  if (!("codingAgent" in data)) {
    return data;
  }

  return {
    ...data,
    codingAgent: normalizeScheduledCodingAgent(
      (data as { codingAgent?: string | null | undefined }).codingAgent,
    ),
  };
};
