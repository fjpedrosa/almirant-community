import { normalizeLegacyCodingAgentAlias } from "@almirant/shared";

export const normalizeScheduledCodingAgent = (
  codingAgent: string | null | undefined,
): string | null | undefined => {
  if (codingAgent == null) {
    return codingAgent;
  }

  return normalizeLegacyCodingAgentAlias(codingAgent);
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
