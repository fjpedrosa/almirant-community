import type { RuntimeExecutor } from "../shared/types";

const DEFAULT_WORKSPACE_REPO_PATH = "/workspace/repo";
const RUNTIME_SKILL_MCP_FALLBACK_MARKER = "<!-- runner-runtime-mcp-fallback -->";
const ZAI_CLAUDE_BASE_URL = "https://api.z.ai/api/anthropic";

const buildClaudeShimMcpFallbackNote = (): string => {
  return [
    RUNTIME_SKILL_MCP_FALLBACK_MARKER,
    "## Runner Runtime Note",
    "",
    "Use Almirant MCP through Claude's normal MCP tool interface.",
    "The runner discovers, configures, and authenticates managed MCP tools; treat their transport details and credentials as opaque.",
    "",
    "Before reporting missing Almirant MCP access:",
    "1. Discover and invoke Almirant tools with the runtime's native MCP interface.",
    "2. Use only the tool names and arguments advertised by that interface.",
    "3. If the managed tools remain unavailable after normal discovery, report the missing capability.",
    "",
    "Never inspect, copy, print, or reconstruct managed MCP configuration or credentials, and never bypass the native MCP interface with raw HTTP or shell commands.",
    "",
    "## Claude Runner Model Override (MANDATORY)",
    "",
    "In this Claude runner environment, specialist agents MUST use the SAME model already selected for the current job/session.",
    "",
    "- Ignore any earlier instruction in the skill that says `model: \"opus\"` or pins a specific `claude-opus-*` model.",
    "- Do NOT pass `model` to `Agent`/`Task` unless the user or job explicitly requested a subagent model override (e.g. via the `ultracode` preset or an explicit `subagentModel`). When such an override is set, honor it.",
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

/**
 * Enable Claude Code multi-agent teaming. This is the minimal, runtime-agnostic
 * subset shared by the zai/Claude-compatible path and the native-Anthropic
 * ultracode path — it only toggles teaming and pins the subagent model, without
 * touching ANTHROPIC_BASE_URL / model overrides (those are zai-specific).
 */
export const applyClaudeTeamingEnv = (
  env: Record<string, string>,
  params: {
    subagentModel: string;
  },
): void => {
  env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = "1";
  env.CLAUDE_CODE_SUBAGENT_MODEL = params.subagentModel;
};

export const applyClaudeAnthropicCompatibleEnv = (
  env: Record<string, string>,
  params: {
    baseUrl?: string;
    resolvedModel: string;
    resolvedSmallModel?: string;
    /** Explicit subagent model override. Defaults to `resolvedModel`. */
    subagentModel?: string;
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
  applyClaudeTeamingEnv(env, {
    subagentModel: params.subagentModel ?? params.resolvedModel,
  });
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
};
