"use client";

import type { CodingAgent } from "../../domain/coding-agent-compatibility";

export const OPENCODE_BETA_FLAG = "coding-agent-opencode-beta";

export const useCodingAgentBetaAccess = (): {
  isAgentVisible: (agent: CodingAgent) => boolean;
  isAgentBeta: (agent: CodingAgent) => boolean;
} => {
  const isAgentVisible = (_agent: CodingAgent): boolean => true;
  const isAgentBeta = (_agent: CodingAgent): boolean => false;

  return { isAgentVisible, isAgentBeta };
};
