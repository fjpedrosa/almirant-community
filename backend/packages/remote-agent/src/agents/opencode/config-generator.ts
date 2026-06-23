export type OpenCodeProvider =
  | "anthropic"
  | "openai"
  | "zai"
  | "xai"
  | (string & {});

export type OpenCodeMcpServerRemote = {
  type: "remote";
  url: string;
  enabled?: boolean;
  oauth?: boolean;
  headers?: Record<string, string>;
};

export type OpenCodeMcpServerLocal = {
  type: "local";
  command: string | string[];
  args?: string[];
  enabled?: boolean;
};

export type OpenCodeMcpServer = OpenCodeMcpServerRemote | OpenCodeMcpServerLocal;

export type OpenCodeNormalizedMcpServerLocal = {
  type: "local";
  command: string[];
  enabled?: boolean;
};

export type OpenCodeNormalizedMcpServer =
  | OpenCodeMcpServerRemote
  | OpenCodeNormalizedMcpServerLocal;

export type OpenCodeProviderOptions = {
  apiKey: string;
  endpoint?: string;
  baseURL?: string;
};

export type OpenCodeConfig = {
  $schema: "https://opencode.ai/config.json";
  instructions: string[];
  model: string;
  small_model?: string;
  provider: Record<string, { options: OpenCodeProviderOptions }>;
  /** OpenCode YOLO mode: allow all permissions without prompting. */
  permission: "allow";
  /** Keep the built-in build agent explicitly permissive as well. */
  agent: {
    build: {
      permission: {
        edit: "allow";
        bash: "allow";
      };
    };
  };
  mcp: Record<string, OpenCodeNormalizedMcpServer>;
  watcher: {
    ignore: string[];
  };
};

export type OpenCodeConfigGeneratorInput = {
  provider: OpenCodeProvider;
  model: string;
  smallModel?: string;
  apiKeyEnvVar?: string;
  baseUrl?: string;
  mcpServers?: Record<string, OpenCodeMcpServer>;
};

/**
 * Normalize MCP server configs for OpenCode v1.3+.
 * OpenCode expects local servers to have `command` as a string array, not a
 * separate `command` string + `args` array.
 */
const normalizeMcpServers = (
  servers: Record<string, OpenCodeMcpServer>
): Record<string, OpenCodeNormalizedMcpServer> => {
  const result: Record<string, OpenCodeNormalizedMcpServer> = {};
  for (const [name, server] of Object.entries(servers)) {
    if (server.type === "local") {
      const cmd = typeof server.command === "string"
        ? [server.command, ...(server.args ?? [])]
        : server.command;
      result[name] = {
        type: server.type,
        command: cmd,
        ...(server.enabled !== undefined ? { enabled: server.enabled } : {}),
      };
    } else {
      result[name] = server;
    }
  }
  return result;
};

export const buildOpenCodeConfig = (input: OpenCodeConfigGeneratorInput): OpenCodeConfig => {
  const apiKeyEnvVar = input.apiKeyEnvVar ?? "OPENAI_API_KEY";

  // OpenCode model format is "provider/model", e.g. "anthropic/claude-sonnet-4-20250514"
  const modelString = `${input.provider}/${input.model}`;
  const smallModelString = input.smallModel
    ? `${input.provider}/${input.smallModel}`
    : undefined;

  // Provider config: map of provider name → { options }
  const providerOptions: OpenCodeProviderOptions = {
    apiKey: `{env:${apiKeyEnvVar}}`,
  };
  if (input.baseUrl) {
    providerOptions.endpoint = input.baseUrl;
    providerOptions.baseURL = input.baseUrl;
  }

  return {
    $schema: "https://opencode.ai/config.json",
    instructions: ["AGENTS.md"],
    model: modelString,
    ...(smallModelString ? { small_model: smallModelString } : {}),
    provider: {
      [input.provider]: {
        options: providerOptions,
      },
    },
    // OpenCode's current YOLO mode is permission: "allow". The build agent is
    // also made explicit so both global and agent-scoped permission resolution
    // paths auto-approve edit/bash operations.
    permission: "allow" as const,
    agent: {
      build: {
        permission: {
          edit: "allow" as const,
          bash: "allow" as const,
        },
      },
    },
    mcp: normalizeMcpServers(input.mcpServers ?? {}),
    watcher: {
      ignore: [
        "node_modules/**",
        "dist/**",
        ".git/**",
        ".next/**",
        "backend/api/dist/**",
      ],
    },
  };
};

export const buildOpenCodeConfigJson = (
  input: OpenCodeConfigGeneratorInput
): string => {
  return JSON.stringify(buildOpenCodeConfig(input), null, 2);
};
