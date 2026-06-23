import type { RuntimeExecutor } from "../shared/types";

const DEFAULT_WORKSPACE_REPO_PATH = "/workspace/repo";
const RUNTIME_SKILL_MCP_FALLBACK_MARKER = "<!-- runner-runtime-mcp-fallback -->";
const ZAI_CLAUDE_BASE_URL = "https://api.z.ai/api/anthropic";

const buildClaudeShimMcpFallbackNote = (): string => {
  return [
    RUNTIME_SKILL_MCP_FALLBACK_MARKER,
    "## Runner Runtime Note",
    "",
    "In this Claude runner environment, Almirant MCP may be configured in `.mcp.json` without appearing in `ToolSearch` or the deferred tool list.",
    "If that happens, do not conclude that MCP access is missing.",
    "",
    "Before reporting missing Almirant MCP access:",
    "1. Read `.mcp.json` and extract `mcpServers.almirant.url` and `mcpServers.almirant.headers.Authorization`.",
    "2. Call JSON-RPC `tools/list` against that HTTP endpoint to confirm the available tool names.",
    "3. Call JSON-RPC `tools/call` for the needed Almirant tool.",
    "4. Only report MCP unavailable if `.mcp.json` has no `almirant` entry or the HTTP call itself fails.",
    "",
    "Example discovery command:",
    "```bash",
    "MCP_URL=$(jq -r '.mcpServers.almirant.url // empty' .mcp.json)",
    "AUTH=$(jq -r '.mcpServers.almirant.headers.Authorization // empty' .mcp.json)",
    "curl -s -X POST \"$MCP_URL\" \\",
    "  -H \"Authorization: $AUTH\" \\",
    "  -H \"Content-Type: application/json\" \\",
    "  -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\",\"params\":{}}'",
    "```",
    "",
    "Example tool call:",
    "```bash",
    "curl -s -X POST \"$MCP_URL\" \\",
    "  -H \"Authorization: $AUTH\" \\",
    "  -H \"Content-Type: application/json\" \\",
    "  -d '{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"list_work_items\",\"arguments\":{}}}'",
    "```",
    "",
    "## Claude Runner Model Override (MANDATORY)",
    "",
    "In this Claude runner environment, specialist agents MUST use the SAME model already selected for the current job/session.",
    "",
    "- Ignore any earlier instruction in the skill that says `model: \"opus\"` or pins a specific `claude-opus-*` model.",
    "- Do NOT pass `model` to `Agent`/`Task` unless the user or job explicitly requested a subagent model override.",
    "- If a reporting step asks you to translate `model: \"opus\"` into a Claude model ID, do NOT do that here. Record the actual running model instead.",
  ].join("\n");
};

export const CLAUDE_RUNTIME_SKILL_MARKER = RUNTIME_SKILL_MCP_FALLBACK_MARKER;

export const claudeRuntimeExecutor: RuntimeExecutor = {
  codingAgent: "claude-code",
  runtimeType: "claude-shim",
  platformRuntime: "claude-code",
  instructionTargets: ["CLAUDE.md"],
  resolveRuntimeConfig: (images) => ({
    type: "claude-shim",
    image: images.claudeShimImage,
    envVars: {
      OPENCODE_SERVER_HOST: "0.0.0.0",
      OPENCODE_SERVER_PORT: String(images.servePort ?? 4096),
      WORKSPACE_REPO_PATH: DEFAULT_WORKSPACE_REPO_PATH,
    },
  }),
  buildSkillAugmentation: () => buildClaudeShimMcpFallbackNote(),
};

export const resolveClaudeInjectedKeyEnvName = (params: {
  runtimeType: string;
  keyProviderName: string;
  defaultEnvName: string;
}): string => {
  if (
    params.runtimeType === claudeRuntimeExecutor.runtimeType &&
    params.keyProviderName === "zai"
  ) {
    return "ANTHROPIC_AUTH_TOKEN";
  }

  return params.defaultEnvName;
};

export const isClaudeAnthropicCompatibleRuntime = (params: {
  runtimeType: string;
  keyProviderName: string;
}): boolean => {
  return (
    params.runtimeType === claudeRuntimeExecutor.runtimeType &&
    params.keyProviderName === "zai"
  );
};

export const applyClaudeAnthropicCompatibleEnv = (
  env: Record<string, string>,
  params: {
    baseUrl?: string;
    resolvedModel: string;
    resolvedSmallModel?: string;
  },
): void => {
  env.ANTHROPIC_BASE_URL = params.baseUrl ?? ZAI_CLAUDE_BASE_URL;
  env.BASH_DEFAULT_TIMEOUT_MS = "3000000";
  env.BASH_MAX_TIMEOUT_MS = "3000000";
  env.API_TIMEOUT_MS = "3000000";
  env.ANTHROPIC_MODEL = params.resolvedModel;
  env.ANTHROPIC_DEFAULT_OPUS_MODEL = params.resolvedModel;
  env.ANTHROPIC_DEFAULT_SONNET_MODEL = params.resolvedModel;
  env.ANTHROPIC_DEFAULT_HAIKU_MODEL =
    params.resolvedSmallModel ?? "glm-5-turbo";
  env.ANTHROPIC_SMALL_FAST_MODEL =
    params.resolvedSmallModel ?? "glm-5-turbo";
  env.MAX_MCP_OUTPUT_TOKENS = "50000";
  env.DISABLE_COST_WARNINGS = "1";
  env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = "1";
  env.CLAUDE_CODE_SUBAGENT_MODEL = params.resolvedModel;
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
};
