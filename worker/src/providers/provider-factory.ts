import { createClaudeCodeProvider } from "./claude-code-provider.js";
import { createCodexProvider } from "./codex-provider.js";
import type { CodingAgentProvider } from "./types.js";

export type ProviderName = "claude-code" | "codex";

export type ProviderFactoryConfig = {
  claudeCode?: Parameters<typeof createClaudeCodeProvider>[0];
  codex?: Parameters<typeof createCodexProvider>[0];
};

export const getProvider = (name: ProviderName, config: ProviderFactoryConfig = {}): CodingAgentProvider => {
  switch (name) {
    case "claude-code":
      return createClaudeCodeProvider(config.claudeCode);
    case "codex":
      return createCodexProvider(config.codex);
    default: {
      const exhaustive: never = name;
      throw new Error(`Unsupported provider "${String(exhaustive)}". Supported: "claude-code", "codex".`);
    }
  }
};

