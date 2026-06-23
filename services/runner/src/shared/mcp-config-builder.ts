/**
 * Transform OpenCode MCP server config to Claude Code CLI .mcp.json format.
 * OpenCode uses `type: "remote"` → Claude uses `type: "http"`.
 * OpenCode uses `type: "local"` → Claude uses `command` + `args` (stdio).
 */
export const buildClaudeMcpConfig = (
  mcpServers: Record<string, Record<string, unknown>>
): { mcpServers: Record<string, unknown> } => {
  const claudeServers: Record<string, unknown> = {};
  for (const [name, server] of Object.entries(mcpServers)) {
    if (server.type === "local" && typeof server.command === "string") {
      // stdio/local MCP — Claude CLI format uses command + args directly
      claudeServers[name] = {
        command: server.command,
        args: Array.isArray(server.args) ? server.args : [],
        ...(server.env && typeof server.env === "object" ? { env: server.env } : {}),
      };
    } else {
      // remote/HTTP MCP
      const headers = server.headers as Record<string, string> | undefined;
      const authHeader = headers?.Authorization ?? headers?.authorization;

      if (authHeader) {
        // Authenticated remote MCP — use native type: "http" with headers.
        // Claude Code (recent versions) reliably sends static Authorization
        // headers via the HTTP transport; mcp-remote (stdio proxy) was the old
        // workaround but caused issues inside containers (proxy bypass, npx
        // startup latency, tools not registering as deferred tools).
        claudeServers[name] = {
          type: "http",
          url: server.url,
          headers: { Authorization: authHeader },
        };
      } else {
        // Unauthenticated remote MCP (e.g. context7) — type: "http" works fine
        claudeServers[name] = {
          type: "http",
          url: server.url,
        };
      }
    }
  }
  return { mcpServers: claudeServers };
};

/**
 * Transform OpenCode MCP server config to Codex CLI format.
 * Remote servers use `url` + optional `bearer_token_env_var`.
 * Local servers use `command` + `args`.
 * Returns the config object AND a map of env var names → token values
 * that must be injected into the container environment.
 */
export const buildCodexMcpConfig = (
  mcpServers: Record<string, Record<string, unknown>>
): { servers: Record<string, Record<string, unknown>>; tokenEnvVars: Record<string, string> } => {
  const servers: Record<string, Record<string, unknown>> = {};
  const tokenEnvVars: Record<string, string> = {};

  for (const [name, server] of Object.entries(mcpServers)) {
    if (server.type === "local" && (typeof server.command === "string" || Array.isArray(server.command))) {
      // normalizeMcpServers merges command+args into a single array.
      // Extract the executable and args back out for Codex TOML format.
      const cmdArray = Array.isArray(server.command)
        ? server.command as string[]
        : [server.command as string, ...(Array.isArray(server.args) ? server.args as string[] : [])];
      servers[name] = {
        command: cmdArray[0],
        args: cmdArray.slice(1),
      };
    } else {
      // Remote MCP server
      const entry: Record<string, unknown> = { url: server.url };

      // Extract bearer token from headers and convert to env var reference
      const headers = server.headers as Record<string, string> | undefined;
      const authHeader = headers?.Authorization ?? headers?.authorization;
      if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
        const token = authHeader.slice(7);
        const envVarName = `MCP_TOKEN_${name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
        entry.bearer_token_env_var = envVarName;
        tokenEnvVars[envVarName] = token;
      }

      servers[name] = entry;
    }
  }

  return { servers, tokenEnvVars };
};
