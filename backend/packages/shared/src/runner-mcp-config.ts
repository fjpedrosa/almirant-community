export type RunnerCustomMcpServerConfig = {
  type: "remote";
  url: string;
  enabled?: boolean;
  oauth?: false;
};

export type RunnerCustomMcpServersConfig = Record<string, RunnerCustomMcpServerConfig>;

export const RUNNER_PLATFORM_MCP_SERVER_NAMES = [
  "almirant",
  "context7",
  "playwright",
  "sequential-thinking",
  "memory",
  "filesystem",
] as const;

const RESERVED_MCP_SERVER_NAMES = new Set<string>(RUNNER_PLATFORM_MCP_SERVER_NAMES);
const MCP_SERVER_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_CUSTOM_MCP_SERVERS = 20;
const MAX_MCP_URL_LENGTH = 2048;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isSupportedMcpUrl = (value: string): boolean => {
  if (value.length > MAX_MCP_URL_LENGTH) {
    return false;
  }

  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.username.length === 0 &&
      url.password.length === 0
    );
  } catch {
    return false;
  }
};

export const isValidRunnerMcpServerName = (name: string): boolean =>
  MCP_SERVER_NAME_RE.test(name) && !RESERVED_MCP_SERVER_NAMES.has(name);

export const normalizeRunnerCustomMcpServersConfig = (
  input: unknown,
): { servers: RunnerCustomMcpServersConfig | null; errors: string[] } => {
  if (input == null) {
    return { servers: null, errors: [] };
  }

  if (!isRecord(input)) {
    return { servers: null, errors: ["mcpServers must be an object keyed by server name"] };
  }

  const entries = Object.entries(input);
  const errors: string[] = [];
  const servers: RunnerCustomMcpServersConfig = {};

  if (entries.length > MAX_CUSTOM_MCP_SERVERS) {
    errors.push(`mcpServers cannot contain more than ${MAX_CUSTOM_MCP_SERVERS} entries`);
  }

  for (const [name, rawServer] of entries) {
    if (!MCP_SERVER_NAME_RE.test(name)) {
      errors.push(`mcpServers.${name}: server name must match ${MCP_SERVER_NAME_RE.source}`);
      continue;
    }

    if (RESERVED_MCP_SERVER_NAMES.has(name)) {
      errors.push(`mcpServers.${name}: "${name}" is reserved by the runner`);
      continue;
    }

    if (!isRecord(rawServer)) {
      errors.push(`mcpServers.${name}: server config must be an object`);
      continue;
    }

    const type = rawServer.type ?? "remote";
    if (type !== "remote") {
      errors.push(`mcpServers.${name}: only remote MCP servers are supported`);
      continue;
    }

    if ("headers" in rawServer) {
      errors.push(`mcpServers.${name}: headers are not supported for scheduled-agent MCP config`);
    }

    if ("command" in rawServer || "args" in rawServer) {
      errors.push(`mcpServers.${name}: local MCP commands are not supported for scheduled-agent MCP config`);
    }

    if (rawServer.oauth === true) {
      errors.push(`mcpServers.${name}: oauth=true is not supported in non-interactive runner sessions`);
    }

    const url = typeof rawServer.url === "string" ? rawServer.url.trim() : "";
    if (!isSupportedMcpUrl(url)) {
      errors.push(
        `mcpServers.${name}: url must be a valid http(s) URL without embedded credentials`,
      );
      continue;
    }

    const enabled = typeof rawServer.enabled === "boolean" ? rawServer.enabled : true;
    if (!enabled) {
      continue;
    }

    servers[name] = {
      type: "remote",
      url,
      enabled: true,
      oauth: false,
    };
  }

  if (errors.length > 0) {
    return { servers: null, errors };
  }

  return {
    servers: Object.keys(servers).length > 0 ? servers : null,
    errors: [],
  };
};
