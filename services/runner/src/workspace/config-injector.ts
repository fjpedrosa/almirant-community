import {
  buildOpenCodeConfig,
  type AlmirantWorkerClient,
  type ClaimedJob,
  type OpenCodeMcpServer,
} from "@almirant/remote-agent";
import type { RuntimeConfig } from "../shared/types";
import { createRuntimeExecutorRegistry } from "../runtime-executors/registry";
import { requiresInternalMcp } from "../shared/internal-skills";
import { normalizeRunnerCustomMcpServersConfig } from "@almirant/shared";
import {
  applyClaudeAnthropicCompatibleEnv,
  isClaudeAnthropicCompatibleRuntime,
  resolveClaudeInjectedKeyEnvName,
} from "../runtime-executors/claude";
import { resolveJobIntent } from "../orchestration/job-intent";
import { resolveJobCodingAgent } from "../shared/job-helpers";

type ConfigInjectorInput = {
  workerClient: Pick<
    AlmirantWorkerClient,
    "getProviderKeys" | "getGithubToken"
  >;
  job: ClaimedJob;
  repository: {
    id?: string;
    url?: string;
    branch?: string;
    depth?: number;
    workspaceKind?: "git_repo" | "empty_workspace" | "uploaded_files";
  };
  /** Almirant API base URL (e.g. https://api.almirant.ai). Used to construct MCP URL dynamically. */
  apiBaseUrl?: string;
  model?: string;
  /**
   * Optional callback to request a scoped session token for the agent container.
   * When provided, the MCP config uses this short-lived token instead of the
   * global API key -- limiting the blast radius if the container is compromised.
   */
  requestSessionToken?: (params: {
    projectId: string;
    workspaceId: string;
    jobId: string;
    /**
     * Optional list of MCP permissions to request for the session token.
     * When omitted, the caller falls back to `["mcp:read", "mcp:write"]`.
     * Skills in `INTERNAL_MCP_SKILLS` should pass `["mcp:read", "mcp:write", "mcp:internal"]`
     * so the token is accepted by the `/mcp/internal` mount.
     */
    permissions?: string[];
  }) => Promise<{ token: string; expiresAt: string }>;
};

type RuntimeImageConfig = {
  opencodeImage: string;
  claudeShimImage: string;
  codexShimImage: string;
  servePort?: number;
};

export type InjectedEnvResult = {
  env: Record<string, string>;
  openCodeConfig: ReturnType<typeof buildOpenCodeConfig>;
  /** Raw model ID (e.g. "claude-opus-4-6") without provider prefix. */
  resolvedModel: string;
  /** Debug metadata about the resolved provider key, for logging. */
  keyDebug?: Record<string, unknown>;
};

const ZAI_CODING_PLAN_BASE_URL = "https://api.z.ai/api/coding/paas/v4";
const ZAI_CLAUDE_BASE_URL = "https://api.z.ai/api/anthropic";
const XAI_OPENAI_BASE_URL = "https://api.x.ai/v1";
const runtimeExecutorRegistry = createRuntimeExecutorRegistry();

const asObject = (value: unknown): Record<string, unknown> | null => {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
};

const asString = (value: unknown): string | undefined => {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
};

const extractStringEnv = (value: unknown): Record<string, string> => {
  const rawEnv = asObject(value);
  if (!rawEnv) return {};

  return Object.fromEntries(
    Object.entries(rawEnv).filter((entry): entry is [string, string] =>
      typeof entry[1] === "string"
    ),
  );
};

const decodeJwtPayload = (token: string | undefined): Record<string, unknown> | null => {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;

  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const normalized = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const payload = Buffer.from(normalized, "base64").toString("utf8");
    return asObject(JSON.parse(payload));
  } catch {
    return null;
  }
};

const extractCodexAccountId = (source: Record<string, unknown>): string | undefined => {
  const tokens = asObject(source.tokens);
  const chatgptSession = asObject(source.chatgpt_session);

  const directAccountId =
    asString(tokens?.account_id) ??
    asString(source.account_id) ??
    asString(source.accountId) ??
    asString(chatgptSession?.account_id);

  if (directAccountId) {
    return directAccountId;
  }

  const idToken =
    asString(tokens?.id_token) ??
    asString(source.idToken) ??
    asString(source.id_token) ??
    asString(chatgptSession?.id_token);

  const jwtPayload = decodeJwtPayload(idToken);
  return (
    asString(jwtPayload?.account_id) ??
    asString(jwtPayload?.chatgpt_account_id) ??
    asString(jwtPayload?.["https://api.openai.com/account_id"]) ??
    asString(jwtPayload?.["https://api.openai.com/chatgpt_account_id"]) ??
    asString(jwtPayload?.sub)
  );
};

const buildCodexAuthJson = (
  rawCredentialsJson: string,
  fallbackApiKey?: string,
): string | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawCredentialsJson);
  } catch {
    return null;
  }

  const source = asObject(parsed);
  if (!source) {
    return null;
  }

  const tokens = asObject(source.tokens);
  const chatgptSession = asObject(source.chatgpt_session);

  const accessToken =
    asString(tokens?.access_token) ??
    asString(chatgptSession?.access_token) ??
    asString(source.oauthAccessToken) ??
    asString(source.oauth_access_token) ??
    asString(source.access_token) ??
    asString(source.apiKey) ??
    asString(source.OPENAI_API_KEY) ??
    fallbackApiKey;

  if (!accessToken) {
    return null;
  }

  const refreshToken =
    asString(tokens?.refresh_token) ??
    asString(chatgptSession?.refresh_token) ??
    asString(source.refreshToken) ??
    asString(source.refresh_token);

  const idToken =
    asString(tokens?.id_token) ??
    asString(chatgptSession?.id_token) ??
    asString(source.idToken) ??
    asString(source.id_token);

  const accountId = extractCodexAccountId(source);
  const apiKey =
    asString(source.OPENAI_API_KEY) ??
    asString(source.apiKey) ??
    fallbackApiKey;

  const normalizedTokens: Record<string, string> = {
    access_token: accessToken,
  };

  if (refreshToken) {
    normalizedTokens.refresh_token = refreshToken;
  }
  if (idToken) {
    normalizedTokens.id_token = idToken;
  }
  if (accountId) {
    normalizedTokens.account_id = accountId;
  }

  const normalizedAuth: Record<string, unknown> = {
    auth_mode: asString(source.auth_mode) ?? "chatgpt",
    last_refresh: asString(source.last_refresh) ?? new Date().toISOString(),
    tokens: normalizedTokens,
  };

  if (apiKey) {
    normalizedAuth.OPENAI_API_KEY = apiKey;
  }

  return JSON.stringify(normalizedAuth);
};

const resolveProviderKey = (provider: string): string => {
  return provider.trim().toLowerCase();
};

const providerToApiKeyEnv = (provider: string): string | undefined => {
  switch (provider) {
    case "anthropic":
      return "ANTHROPIC_API_KEY";
    case "zai":
    case "zai-coding-plan":
      return "ZAI_API_KEY";
    case "xai":
    case "grok":
      return "XAI_API_KEY";
    case "openai":
    case "openai-compatible":
      return "OPENAI_API_KEY";
    default:
      return "OPENAI_API_KEY";
  }
};

const providerToKeyProvider = (
  provider: string
): "anthropic" | "openai" | "openai-compatible" | "zai" | "xai" => {
  switch (resolveProviderKey(provider)) {
    case "anthropic":
    case "claude-code":
      return "anthropic";
    case "openai":
    case "codex":
      return "openai";
    case "zipu":
    case "zai":
      return "zai";
    case "grok":
    case "xai":
      return "xai";
    case "openai-compatible":
      return "openai-compatible";
    default:
      return "openai";
  }
};

const providerToOpenCodeProvider = (provider: string): string => {
  switch (resolveProviderKey(provider)) {
    case "zipu":
    case "zai":
      return "zai-coding-plan";
    case "grok":
    case "xai":
      return "xai";
    case "anthropic":
    case "claude-code":
      return "anthropic";
    case "openai":
    case "codex":
      return "openai";
    case "openai-compatible":
      return "openai-compatible";
    default:
      return "openai";
  }
};

const providerFromAiProvider = (aiProvider: string | undefined): string | undefined => {
  switch (resolveProviderKey(aiProvider ?? "")) {
    case "anthropic":
      return "anthropic";
    case "openai":
      return "openai";
    case "zai":
      return "zai";
    case "xai":
      return "xai";
    default:
      return undefined;
  }
};

// NOTE: these are runner-side last-resort defaults, applied only when the job
// carries no explicit model and the org connection has none configured. They
// are intentionally decoupled from the API-side provider defaults in
// backend/packages/shared/src/agents/runtime-selection.ts (PROVIDER_MAP):
// the anthropic default stays on claude-sonnet-5 here for cost reasons.
const defaultModelForProvider = (provider: string): string => {
  switch (provider) {
    case "anthropic":
      return "claude-sonnet-5";
    case "openai":
      return "gpt-5.5";
    case "zai-coding-plan":
    case "zai":
      return "glm-5.2";
    case "xai":
      return "grok-4.3";
    case "openai-compatible":
      return "glm-4.7";
    default:
      return "gpt-5.5";
  }
};

const defaultSmallModelForProvider = (provider: string): string | undefined => {
  switch (provider) {
    case "zai-coding-plan":
    case "zai":
      return "glm-4.7-flashx";
    default:
      return undefined;
  }
};

const baseUrlForOpenCodeProvider = (provider: string): string | undefined => {
  switch (provider) {
    case "zai-coding-plan":
      return ZAI_CODING_PLAN_BASE_URL;
    case "xai":
      return XAI_OPENAI_BASE_URL;
    case "openai-compatible":
      return undefined;
    default:
      return undefined;
  }
};

export const resolveRuntimeConfig = (
  provider: string,
  images: RuntimeImageConfig,
  codingAgent?: string,
): RuntimeConfig => {
  return runtimeExecutorRegistry
    .resolve({ provider, codingAgent })
    .resolveRuntimeConfig(images);
};

export const buildInjectedEnv = async (
  input: ConfigInjectorInput
): Promise<InjectedEnvResult> => {
  const jobConfig = asObject(input.job.config) ?? {};
  const jobNeedsBrowser = resolveJobIntent(input.job).needsBrowser;
  const requestedProvider = String(input.job.provider || "codex");
  const explicitAiProvider =
    asString(input.job.aiProvider) ?? asString(jobConfig.aiProvider);
  const provider =
    providerFromAiProvider(explicitAiProvider) ?? requestedProvider;
  const keyProviderName = providerToKeyProvider(provider);
  const openCodeProviderName = providerToOpenCodeProvider(provider);

  // Determine actual runtime type: explicit codingAgent takes precedence over
  // provider-based defaults (e.g. codingAgent="opencode" + provider="zipu"
  // → actual runtime is opencode, NOT claude-shim). Legacy jobs may carry this
  // in config.codingAgent; modern jobs carry it in the top-level codingAgent
  // column, so both sources must be honored.
  const jobCodingAgent = resolveJobCodingAgent(input.job);
  const providerRuntimeExecutor = runtimeExecutorRegistry.resolve({ provider });
  const actualRuntimeExecutor = runtimeExecutorRegistry.resolve({
    provider,
    codingAgent: jobCodingAgent,
  });
  const runtimeType = providerRuntimeExecutor.runtimeType;
  const actualRuntimeType = actualRuntimeExecutor.runtimeType;

  const isZipuClaudeRuntime = isClaudeAnthropicCompatibleRuntime({
    runtimeType: actualRuntimeType,
    keyProviderName,
  });

  // Admin may pin a specific provider_connections row for Almirant-internal
  // skills via system_settings.agent_routing. When present, the backend
  // skips the org's default resolution and uses that connection's credentials.
  const pinnedConnectionId =
    typeof (input.job.config as Record<string, unknown>)?.providerConnectionId === "string"
      ? ((input.job.config as Record<string, unknown>).providerConnectionId as string)
      : undefined;

  const keys = await input.workerClient.getProviderKeys([keyProviderName], {
    jobId: input.job.id,
    createdByUserId: input.job.createdByUserId ?? undefined,
    workspaceId: input.job.workspaceId ?? undefined,
    preferredConnectionId: pinnedConnectionId,
  });
  const baseKeyEnvName = resolveClaudeInjectedKeyEnvName({
    runtimeType: actualRuntimeType,
    keyProviderName,
    defaultEnvName:
      providerToApiKeyEnv(openCodeProviderName) ?? "OPENAI_API_KEY",
  });
  const baseKeyValue =
    baseKeyEnvName === "ANTHROPIC_API_KEY"
      ? keys.anthropicApiKey
      : baseKeyEnvName === "XAI_API_KEY"
        ? keys.xaiApiKey
        : keys.openaiApiKey;

  if (!baseKeyValue) {
    throw new Error(`Missing provider key for ${keyProviderName}`);
  }

  // Resolve actual env var name and value based on subscription auth method.
  // CRITICAL: ANTHROPIC_API_KEY and CLAUDE_CODE_OAUTH_TOKEN must NEVER coexist —
  // Claude Code CLI gives priority to ANTHROPIC_API_KEY, so for subscription
  // tokens we must use CLAUDE_CODE_OAUTH_TOKEN exclusively.
  let keyEnvName = baseKeyEnvName;
  const keyValue = baseKeyValue;

  const isAnthropicSubscription =
    openCodeProviderName === "anthropic" && keys.anthropicAuthMethod === "subscription";
  const isCodexSubscription =
    (openCodeProviderName === "openai" || openCodeProviderName === "codex") &&
    keys.openaiAuthMethod === "subscription";

  if (isAnthropicSubscription) {
    keyEnvName = "CLAUDE_CODE_OAUTH_TOKEN";
  }
  // For codex subscription, keep OPENAI_API_KEY for the opencode config provider entry.
  // CODEX_AUTH_JSON is injected as an additional env var below (entrypoint-shim
  // writes it to ~/.codex/auth.json, which the codex binary reads natively).

  // Mirror the resolution chain used by resolveSkillTag (job-executor.ts) and
  // job-intent.ts: top-level promptTemplate / skillName take precedence over
  // the legacy config.skillName. Feedback-triage and other internal jobs set
  // only the top-level columns; reading exclusively from config.skillName
  // would mis-route them to /mcp with public permissions.
  const configSkillName =
    typeof (input.job.config as Record<string, unknown> | null | undefined)?.skillName === "string"
      ? ((input.job.config as Record<string, unknown>).skillName as string)
      : undefined;
  const skillName = String(
    input.job.promptTemplate ?? input.job.skillName ?? configSkillName ?? ""
  ).toLowerCase();
  // Use new model's interactive flag when available, fallback to old derivation
  const isPlanningSkill =
    (input.job as Record<string, unknown>).interactive === true ||
    input.job.jobType === "planning" ||
    skillName.includes("plan") ||
    skillName.includes("ideate");
  const isValidationSkill =
    input.job.jobType === "validation" ||
    (skillName !== "" && /validate/i.test(skillName));

  // Resolve model: planning → planningModel, validation → validationModel, default → implementationModel
  const configuredModel = isPlanningSkill
    ? keys.planningModel
    : isValidationSkill
      ? (keys.validationModel || keys.implementationModel)  // fallback if not configured
      : keys.implementationModel;
  const resolvedModel =
    input.model ??
    configuredModel ??
    defaultModelForProvider(openCodeProviderName);
  const resolvedSmallModel = defaultSmallModelForProvider(openCodeProviderName);

  const jobReasoningLevel = asString(jobConfig.reasoningLevel);
  const connectionReasoningBudget = isPlanningSkill
    ? keys.planningReasoningBudget
    : isValidationSkill
      ? keys.validationReasoningBudget
      : keys.implementationReasoningBudget;
  const reasoningBudget = jobReasoningLevel ?? connectionReasoningBudget;

  // Build MCP servers for the OpenCode config.
  // Prefer a scoped session token over the global API key when available.
  const mcpServers: Record<string, OpenCodeMcpServer> = {};

  // Resolve MCP URL dynamically from apiBaseUrl + projectId.
  // MCP is only configured when both are available and a session token can be obtained.
  const jobProjectId = input.job.projectId
    ?? (typeof (input.job.config as Record<string, unknown>)?.projectId === "string"
      ? (input.job.config as Record<string, unknown>).projectId as string
      : undefined);

  // Skills in the internal registry (feedback triage, bug auto-fix, failed-job
  // debugging) need the privileged `/mcp/internal` mount, which exposes
  // clustering, topic taxonomy, bug-fix-attempt and agent-job tools. Every
  // other skill is routed to the public `/mcp`.
  const needsInternalMcp = requiresInternalMcp(skillName);

  if (input.apiBaseUrl && jobProjectId) {
    // Replace localhost with host.docker.internal for container access.
    // Inside Docker containers, localhost refers to the container itself,
    // not the host machine where the API server is running.
    const containerApiBase = input.apiBaseUrl.replace(
      /localhost|127\.0\.0\.1/,
      "host.docker.internal",
    );
    const mcpPath = needsInternalMcp ? "/mcp/internal" : "/mcp";
    // Include jobId so that tools like complete_ai_task can persist
    // agent_job_id on ai_sessions without trusting tool-level params.
    const mcpUrl = `${containerApiBase.replace(/\/+$/, "")}${mcpPath}?projectId=${jobProjectId}&jobId=${encodeURIComponent(input.job.id)}`;
    const requestedPermissions = needsInternalMcp
      ? ["mcp:read", "mcp:write", "mcp:internal"]
      : ["mcp:read", "mcp:write"];

    // All jobs now exchange the runner API key for a short-lived session token.
    // The backend resolves the actor userId from the jobId (see
    // resolveSessionActorUserId in workers.routes.ts), so feedback-bug-fix
    // jobs automatically surface as "auto-fix-bot" without injecting the
    // bot API key into the container. The `/mcp/internal` mount also rejects
    // raw API keys, so the session-token path is mandatory there.
    if (input.requestSessionToken && input.job.workspaceId) {
      try {
        const sessionResult = await input.requestSessionToken({
          projectId: jobProjectId,
          workspaceId: input.job.workspaceId,
          jobId: input.job.id,
          permissions: requestedPermissions,
        });
        mcpServers.almirant = {
          type: "remote",
          url: mcpUrl,
          enabled: true,
          oauth: false,
          headers: {
            Authorization: `Bearer ${sessionResult.token}`,
          },
        };
      } catch (err) {
        // Non-fatal: MCP will not be configured for this job
        console.warn(`[config-injector] Failed to obtain MCP session token for project ${jobProjectId} (mount=${mcpPath}, non-fatal): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // Context7 is always available (public, no auth)
  mcpServers.context7 = {
    type: "remote",
    url: "https://mcp.context7.com/mcp",
    enabled: true,
  };

  // Playwright MCP server for browser-capable jobs. A job-level flag enables
  // it even when the runner process is not globally configured for browsers.
  if (process.env.ENABLE_BROWSER === "true" || jobNeedsBrowser) {
    mcpServers.playwright = {
      type: "local",
      command: "bun",
      args: ["/usr/local/lib/node_modules/@playwright/mcp/cli.js"],
      enabled: true,
    };
  }

  // Sequential Thinking for structured reasoning
  // Use bun instead of node for lower memory footprint (~35 MB vs ~69 MB per server)
  mcpServers["sequential-thinking"] = {
    type: "local",
    command: "bun",
    args: ["/usr/local/lib/node_modules/@modelcontextprotocol/server-sequential-thinking/dist/index.js"],
    enabled: true,
  };

  // Memory MCP for persistent knowledge across sessions
  mcpServers.memory = {
    type: "local",
    command: "bun",
    args: ["/usr/local/lib/node_modules/@modelcontextprotocol/server-memory/dist/index.js"],
    enabled: true,
  };

  // File System MCP for workspace file access
  mcpServers.filesystem = {
    type: "local",
    command: "bun",
    args: ["/usr/local/lib/node_modules/@modelcontextprotocol/server-filesystem/dist/index.js", "/workspace/repo"],
    enabled: true,
  };

  const customMcpServersResult = normalizeRunnerCustomMcpServersConfig(jobConfig.mcpServers);
  if (customMcpServersResult.errors.length > 0) {
    console.warn(
      `[config-injector] Ignoring invalid custom MCP servers for job ${input.job.id}: ${customMcpServersResult.errors.join("; ")}`,
    );
  } else if (customMcpServersResult.servers) {
    for (const [name, server] of Object.entries(customMcpServersResult.servers)) {
      mcpServers[name] = server;
    }
  }

  const authenticatedMcpServers = Object.entries(mcpServers).filter(([_, s]) => 'headers' in s && (s as any).headers?.Authorization);
  if (authenticatedMcpServers.length === 0 && jobProjectId) {
    console.warn(`[config-injector] No authenticated MCP servers configured despite projectId=${jobProjectId} being available — agent will not have access to Almirant MCP tools`);
  }

  const openCodeConfig = buildOpenCodeConfig({
    provider: openCodeProviderName,
    model: resolvedModel,
    smallModel: resolvedSmallModel,
    apiKeyEnvVar: keyEnvName,
    baseUrl: baseUrlForOpenCodeProvider(openCodeProviderName) ??
      (openCodeProviderName === "openai-compatible" ? keys.baseUrl : undefined),
    mcpServers,
  });

  // Map the raw job provider to the normalized AI provider name used in MCP
  // calls (aiProvider param). This lets skills read ALMIRANT_PROVIDER instead
  // of guessing from the runtime (which is wrong when zipu runs via claude-shim).
  const normalizedAiProvider = (() => {
    switch (resolveProviderKey(provider)) {
      case "anthropic":
      case "claude-code":
        return "anthropic";
      case "openai":
      case "codex":
        return "openai";
      case "zipu":
      case "zai":
        return "zai";
      case "grok":
      case "xai":
        return "xai";
      default:
        return provider;
    }
  })();

  const jobEnv = extractStringEnv(jobConfig.env);

  const env: Record<string, string> = {
    // Job-specific env is intentionally applied first. Runner-controlled
    // credentials, provider, locale, repository and MCP values below must
    // remain authoritative if a custom env key collides.
    ...jobEnv,
    [keyEnvName]: keyValue,
    ALMIRANT_PROVIDER: normalizedAiProvider,
    ALMIRANT_CODING_AGENT: jobCodingAgent ?? actualRuntimeExecutor.codingAgent,
  };

  if (jobNeedsBrowser) {
    env.ENABLE_BROWSER = "true";
  }

  // Codex speaks the OpenAI SDK/client protocol. xAI's REST API is
  // OpenAI-compatible, so a Codex+xAI job must expose the xAI key through the
  // OpenAI env names that the codex-shim reads.
  if (actualRuntimeType === "codex-shim" && keyProviderName === "xai") {
    env.OPENAI_API_KEY = keyValue;
    env.OPENAI_BASE_URL = XAI_OPENAI_BASE_URL;
  }

  if (isZipuClaudeRuntime) {
    const claudeSmallModel =
      resolvedModel === "glm-5.2" ? "glm-5-turbo" : resolvedSmallModel;

    applyClaudeAnthropicCompatibleEnv(env, {
      baseUrl: ZAI_CLAUDE_BASE_URL,
      resolvedModel,
      resolvedSmallModel: claudeSmallModel,
    });
  }

  // For codex subscription, inject a Codex-native auth.json payload.
  // The stored OpenAI connection credentials use the Almirant internal shape
  // (apiKey/oauthAccessToken/refreshToken/idToken), but the Codex CLI expects
  // ~/.codex/auth.json with top-level auth_mode/last_refresh/tokens.* fields.
  if (isCodexSubscription && keys.openaiCredentialsJson) {
    const codexAuthJson = buildCodexAuthJson(
      keys.openaiCredentialsJson,
      keyValue,
    );
    if (codexAuthJson) {
      env.CODEX_AUTH_JSON = codexAuthJson;
    }
  }

  if (reasoningBudget) {
    env.REASONING_BUDGET = reasoningBudget;
  }

  // Propagate user locale for i18n in agent prompts
  const jobLocale = typeof (input.job.config as Record<string, unknown>)?.locale === 'string'
    ? (input.job.config as Record<string, unknown>).locale as string
    : 'es';
  env.ALMIRANT_USER_LOCALE = jobLocale;

  env.WORKSPACE_KIND =
    input.repository.workspaceKind ?? (input.repository.url ? "git_repo" : "empty_workspace");

  if (input.repository.url) {
    env.REPO_URL = input.repository.url;
  }

  if (input.repository.branch) {
    env.REPO_BRANCH = input.repository.branch;
  }

  if (input.repository.depth) {
    env.GIT_CLONE_DEPTH = String(input.repository.depth);
  }

  if (input.repository.id) {
    try {
      const githubToken = await input.workerClient.getGithubToken(input.repository.id);
      env.__GIT_CLONE_TOKEN = githubToken.token;
      console.log(`[config-injector] GitHub token obtained for repo ${input.repository.id}`);
    } catch (err) {
      console.warn(`[config-injector] Failed to get GitHub token for repo ${input.repository.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else if (input.repository.url) {
    console.warn(`[config-injector] No repository.id — skipping GitHub token. repo.url=${input.repository.url}`);
  }

  // Collect debug metadata about the resolved key for job logs
  const keyDebug: Record<string, unknown> = {
    keyEnvName,
    authMethod: isAnthropicSubscription ? "subscription" : isCodexSubscription ? "codex_subscription" : "api_key",
    tokenPrefix: keyValue.slice(0, 8),
    tokenSuffix: keyValue.slice(-4),
    tokenLength: keyValue.length,
    codingAgent: jobCodingAgent ?? actualRuntimeExecutor.codingAgent,
    runtimeType: actualRuntimeType,
    ...(keys._debug ?? {}),
  };

  return { env, openCodeConfig, resolvedModel, keyDebug };
};
