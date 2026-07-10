import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import type {
  AlmirantWorkerClient,
  ProviderKeysResponse,
} from "@almirant/remote-agent";

let buildInjectedEnv: typeof import("./config-injector").buildInjectedEnv;
let resolveRuntimeConfig: typeof import("./config-injector").resolveRuntimeConfig;

beforeAll(async () => {
  mock.module("@almirant/remote-agent", () => ({
    buildOpenCodeConfig: (config: Record<string, unknown>) => {
      const provider = String(config.provider ?? "openai");
      const apiKeyEnvVar = String(config.apiKeyEnvVar ?? "OPENAI_API_KEY");
      const baseUrl = typeof config.baseUrl === "string" ? config.baseUrl : undefined;
      const model = String(config.model ?? "");
      // Reflect the forwarded reasoning budget the way the real builder does,
      // so tests can assert config-injector wires REASONING_BUDGET into the
      // OpenCode model options. Additive: absent budget → no `models` key.
      const reasoningBudget =
        typeof config.reasoningBudget === "string" &&
        config.reasoningBudget.trim() !== ""
          ? config.reasoningBudget.trim().toLowerCase()
          : undefined;

      return {
        $schema: "https://opencode.ai/config.json",
        instructions: [],
        model,
        provider: {
          [provider]: {
            options: {
              apiKey: `{env:${apiKeyEnvVar}}`,
              ...(baseUrl ? { endpoint: baseUrl } : {}),
            },
            ...(reasoningBudget
              ? { models: { [model]: { options: { reasoningEffort: reasoningBudget } } } }
              : {}),
          },
        },
        permission: "allow",
        agent: {
          build: {
            permission: {
              edit: "allow",
              bash: "allow",
            },
          },
        },
        mcp: (config.mcpServers as Record<string, unknown> | undefined) ?? {},
        watcher: {
          ignore: [],
        },
      } as const;
    },
  }));

  ({ buildInjectedEnv, resolveRuntimeConfig } = await import("./config-injector"));
});

afterAll(() => {
  mock.restore();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseJob = (
  provider: string,
  overrides: Record<string, unknown> = {},
) => ({
  ...baseJobDefaults(provider),
  ...overrides,
});

const baseJobDefaults = (provider: string) =>
  ({
    id: "job-1",
    workItemId: null,
    projectId: null,
    boardId: null,
    createdByUserId: "user-1",
    workspaceId: "org-1",
    provider,
    priority: "medium" as const,
    status: "running" as const,
    retryCount: 0,
    maxRetries: 3,
    availableAt: null,
    config: null,
  });

const buildMockClient = (
  keys: ProviderKeysResponse,
): Pick<AlmirantWorkerClient, "getProviderKeys" | "getGithubToken"> => ({
  getProviderKeys: async () => keys,
  getGithubToken: async () => ({
    token: "gh-token",
    expiresAt: new Date().toISOString(),
  }),
});

const images = {
  opencodeImage: "opencode:1.14.25",
  claudeShimImage: "claude-shim:2.1.119",
  codexShimImage: "codex-shim:0.125.0",
};

// ---------------------------------------------------------------------------
// resolveRuntimeConfig
// ---------------------------------------------------------------------------

describe("resolveRuntimeConfig", () => {
  it("resolves claude-code to claude-shim", () => {
    const cfg = resolveRuntimeConfig("claude-code", images);
    expect(cfg.type).toBe("claude-shim");
    expect(cfg.image).toBe("claude-shim:2.1.119");
  });

  it("resolves anthropic to claude-shim", () => {
    const cfg = resolveRuntimeConfig("anthropic", images);
    expect(cfg.type).toBe("claude-shim");
  });

  it("resolves codex to codex-shim", () => {
    const cfg = resolveRuntimeConfig("codex", images);
    expect(cfg.type).toBe("codex-shim");
    expect(cfg.image).toBe("codex-shim:0.125.0");
  });

  it("resolves openai to codex-shim", () => {
    const cfg = resolveRuntimeConfig("openai", images);
    expect(cfg.type).toBe("codex-shim");
  });

  it("resolves zipu to claude-shim", () => {
    const cfg = resolveRuntimeConfig("zipu", images);
    expect(cfg.type).toBe("claude-shim");
    expect(cfg.image).toBe("claude-shim:2.1.119");
  });

  it("resolves unknown provider to opencode", () => {
    const cfg = resolveRuntimeConfig("some-unknown", images);
    expect(cfg.type).toBe("opencode");
  });

  it("resolves grok to opencode", () => {
    const cfg = resolveRuntimeConfig("grok", images);
    expect(cfg.type).toBe("opencode");
    expect(cfg.image).toBe("opencode:1.14.25");
  });

  it("prioritizes codex codingAgent over provider runtime defaults", () => {
    const cfg = resolveRuntimeConfig("zipu", images, "codex");
    expect(cfg.type).toBe("codex-shim");
    expect(cfg.image).toBe("codex-shim:0.125.0");
  });

  it("prioritizes claude-code codingAgent over provider runtime defaults", () => {
    const cfg = resolveRuntimeConfig("openai", images, "claude-code");
    expect(cfg.type).toBe("claude-shim");
    expect(cfg.image).toBe("claude-shim:2.1.119");
  });

  it("resolves opencode codingAgent to opencode runtime", () => {
    const cfg = resolveRuntimeConfig("anthropic", images, "opencode");
    expect(cfg.type).toBe("opencode");
    expect(cfg.image).toBe("opencode:1.14.25");
  });

  it("respects an explicit opencode codingAgent over the provider default", () => {
    const cfg = resolveRuntimeConfig("zipu", images, "opencode");
    expect(cfg.type).toBe("opencode");
    expect(cfg.image).toBe("opencode:1.14.25");
    expect(cfg.configFile).toBe("opencode.json");
    expect(cfg.envVars.OPENCODE_HOSTNAME).toBe("0.0.0.0");
    expect(cfg.envVars.OPENCODE_PORT).toBe("4096");
  });
});

// ---------------------------------------------------------------------------
// buildInjectedEnv
// ---------------------------------------------------------------------------

describe("buildInjectedEnv", () => {
  it("sets ANTHROPIC_API_KEY for anthropic api_key auth", async () => {
    const keys: ProviderKeysResponse = {
      anthropicApiKey: "sk-ant-api-key",
      anthropicAuthMethod: "api_key",
    };
    const result = await buildInjectedEnv({
      workerClient: buildMockClient(keys),
      job: baseJob("anthropic"),
      repository: {},
    });
    expect(result.env.ANTHROPIC_API_KEY).toBe("sk-ant-api-key");
    expect(result.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  });

  it("sets CLAUDE_CODE_OAUTH_TOKEN for anthropic subscription", async () => {
    const keys: ProviderKeysResponse = {
      anthropicApiKey: "sk-ant-oat01-token",
      anthropicAuthMethod: "subscription",
    };
    const result = await buildInjectedEnv({
      workerClient: buildMockClient(keys),
      job: baseJob("anthropic"),
      repository: {},
    });
    expect(result.env.CLAUDE_CODE_OAUTH_TOKEN).toBe("sk-ant-oat01-token");
    // ANTHROPIC_API_KEY must NOT be set — Claude Code prioritizes it
    expect(result.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("sets OPENAI_API_KEY for openai api_key auth", async () => {
    const keys: ProviderKeysResponse = {
      openaiApiKey: "sk-openai-key",
      openaiAuthMethod: "api_key",
    };
    const result = await buildInjectedEnv({
      workerClient: buildMockClient(keys),
      job: baseJob("codex"),
      repository: {},
    });
    expect(result.env.OPENAI_API_KEY).toBe("sk-openai-key");
    expect(result.env.CODEX_AUTH_JSON).toBeUndefined();
  });

  it("normalizes internal OpenAI subscription credentials to Codex auth.json", async () => {
    const credentialsJson = JSON.stringify({
      apiKey: "sk-openai-sub",
      oauthAccessToken: "oauth-access-token",
      refreshToken: "refresh-token",
      idToken: [
        "header",
        Buffer.from(JSON.stringify({ account_id: "acct_123" })).toString("base64url"),
        "sig",
      ].join("."),
      authMethod: "oauth",
    });
    const keys: ProviderKeysResponse = {
      openaiApiKey: "sk-openai-sub",
      openaiAuthMethod: "subscription",
      openaiCredentialsJson: credentialsJson,
    };
    const result = await buildInjectedEnv({
      workerClient: buildMockClient(keys),
      job: baseJob("codex"),
      repository: {},
    });
    expect(result.env.OPENAI_API_KEY).toBe("sk-openai-sub");
    expect(result.env.CODEX_AUTH_JSON).toBeDefined();
    expect(JSON.parse(result.env.CODEX_AUTH_JSON!)).toEqual({
      OPENAI_API_KEY: "sk-openai-sub",
      auth_mode: "chatgpt",
      last_refresh: expect.any(String),
      tokens: {
        access_token: "oauth-access-token",
        refresh_token: "refresh-token",
        id_token: expect.any(String),
        account_id: "acct_123",
      },
    });
  });

  it("passes through native Codex auth.json shape for openai subscription", async () => {
    const credentialsJson = JSON.stringify({
      OPENAI_API_KEY: "sk-openai-sub",
      auth_mode: "chatgpt",
      last_refresh: "2026-04-03T06:42:56Z",
      tokens: {
        access_token: "oauth-access-token",
        refresh_token: "refresh-token",
        id_token: "id-token",
        account_id: "acct_123",
      },
    });
    const keys: ProviderKeysResponse = {
      openaiApiKey: "sk-openai-sub",
      openaiAuthMethod: "subscription",
      openaiCredentialsJson: credentialsJson,
    };
    const result = await buildInjectedEnv({
      workerClient: buildMockClient(keys),
      job: baseJob("codex"),
      repository: {},
    });

    expect(JSON.parse(result.env.CODEX_AUTH_JSON!)).toEqual({
      OPENAI_API_KEY: "sk-openai-sub",
      auth_mode: "chatgpt",
      last_refresh: "2026-04-03T06:42:56Z",
      tokens: {
        access_token: "oauth-access-token",
        refresh_token: "refresh-token",
        id_token: "id-token",
        account_id: "acct_123",
      },
    });
  });

  it("defaults to api_key when authMethod is missing (retro-compat)", async () => {
    const keys: ProviderKeysResponse = {
      anthropicApiKey: "sk-ant-legacy",
      // no anthropicAuthMethod
    };
    const result = await buildInjectedEnv({
      workerClient: buildMockClient(keys),
      job: baseJob("anthropic"),
      repository: {},
    });
    // Without subscription flag, should use ANTHROPIC_API_KEY
    expect(result.env.ANTHROPIC_API_KEY).toBe("sk-ant-legacy");
    expect(result.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  });

  it("codex subscription without openaiCredentialsJson omits CODEX_AUTH_JSON", async () => {
    const keys: ProviderKeysResponse = {
      openaiApiKey: "sk-openai-sub-no-json",
      openaiAuthMethod: "subscription",
      // no openaiCredentialsJson
    };
    const result = await buildInjectedEnv({
      workerClient: buildMockClient(keys),
      job: baseJob("codex"),
      repository: {},
    });
    expect(result.env.OPENAI_API_KEY).toBe("sk-openai-sub-no-json");
    expect(result.env.CODEX_AUTH_JSON).toBeUndefined();
  });

  it("throws when provider key is missing", async () => {
    const keys: ProviderKeysResponse = {
      // No keys at all
    };
    await expect(
      buildInjectedEnv({
        workerClient: buildMockClient(keys),
        job: baseJob("anthropic"),
        repository: {},
        })
    ).rejects.toThrow("Missing provider key");
  });

  it("injects REPO_URL and REPO_BRANCH when present", async () => {
    const keys: ProviderKeysResponse = {
      anthropicApiKey: "sk-ant-key",
      anthropicAuthMethod: "api_key",
    };
    const result = await buildInjectedEnv({
      workerClient: buildMockClient(keys),
      job: baseJob("anthropic"),
      repository: { url: "https://github.com/org/repo.git", branch: "main" },
    });
    expect(result.env.REPO_URL).toBe("https://github.com/org/repo.git");
    expect(result.env.REPO_BRANCH).toBe("main");
    expect(result.env.WORKSPACE_KIND).toBe("git_repo");
  });

  it("propagates string job config env without overriding runner-controlled env", async () => {
    const keys: ProviderKeysResponse = {
      openaiApiKey: "sk-openai-key",
      openaiAuthMethod: "api_key",
    };

    const result = await buildInjectedEnv({
      workerClient: buildMockClient(keys),
      job: baseJob("codex", {
        config: {
          env: {
            ALMIRANT_BATCH_ID: "batch-1",
            ALMIRANT_INTEGRATION_PHASE: "process",
            ALMIRANT_PROVIDER: "evil-provider",
            OPENAI_API_KEY: "evil-key",
            IGNORED_NUMBER: 42,
          },
        },
      }),
      repository: {},
    });

    expect(result.env.ALMIRANT_BATCH_ID).toBe("batch-1");
    expect(result.env.ALMIRANT_INTEGRATION_PHASE).toBe("process");
    expect(result.env.ALMIRANT_PROVIDER).toBe("openai");
    expect(result.env.OPENAI_API_KEY).toBe("sk-openai-key");
    expect(result.env.IGNORED_NUMBER).toBeUndefined();
  });

  it("marks repo-less sessions as empty workspaces for entrypoint routing", async () => {
    const keys: ProviderKeysResponse = {
      anthropicApiKey: "sk-ant-key",
      anthropicAuthMethod: "api_key",
    };
    const result = await buildInjectedEnv({
      workerClient: buildMockClient(keys),
      job: baseJob("anthropic"),
      repository: {},
    });

    expect(result.env.WORKSPACE_KIND).toBe("empty_workspace");
    expect(result.env.REPO_URL).toBeUndefined();
    expect(result.env.REPO_BRANCH).toBeUndefined();
  });

  it("marks uploaded_files sessions explicitly for entrypoint routing", async () => {
    const keys: ProviderKeysResponse = {
      anthropicApiKey: "sk-ant-key",
      anthropicAuthMethod: "api_key",
    };
    const result = await buildInjectedEnv({
      workerClient: buildMockClient(keys),
      job: baseJob("anthropic"),
      repository: { workspaceKind: "uploaded_files" },
    });

    expect(result.env.WORKSPACE_KIND).toBe("uploaded_files");
    expect(result.env.REPO_URL).toBeUndefined();
    expect(result.env.REPO_BRANCH).toBeUndefined();
  });

  it("configures zipu for Claude Code using Z.AI anthropic-compatible env vars", async () => {
    const keys: ProviderKeysResponse = {
      openaiApiKey: "zai-api-key",
      openaiAuthMethod: "api_key",
      baseUrl: "https://api.z.ai/api/anthropic",
      implementationModel: "glm-5.2",
    };
    const result = await buildInjectedEnv({
      workerClient: buildMockClient(keys),
      job: baseJob("zipu"),
      repository: {},
    });
    expect(result.env.ANTHROPIC_AUTH_TOKEN).toBe("zai-api-key");
    expect(result.env.ANTHROPIC_BASE_URL).toBe("https://api.z.ai/api/anthropic");
    expect(result.env.BASH_DEFAULT_TIMEOUT_MS).toBe("3000000");
    expect(result.env.BASH_MAX_TIMEOUT_MS).toBe("3000000");
    expect(result.env.API_TIMEOUT_MS).toBe("3000000");
    expect(result.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe("1");
    expect(result.env.ANTHROPIC_MODEL).toBe("glm-5.2");
    expect(result.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("glm-5.2");
    expect(result.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("glm-5.2");
    expect(result.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("glm-5-turbo");
    expect(result.env.ANTHROPIC_SMALL_FAST_MODEL).toBe("glm-5-turbo");
    expect(result.env.MAX_MCP_OUTPUT_TOKENS).toBe("50000");
    expect(result.env.DISABLE_COST_WARNINGS).toBe("1");
    expect(result.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS).toBe("1");
    expect(result.env.CLAUDE_CODE_SUBAGENT_MODEL).toBe("glm-5.2");
    expect(result.env.OPENAI_API_KEY).toBeUndefined();
  });

  it("uses planning model, reasoning budget and locale for planning jobs", async () => {
    const keys: ProviderKeysResponse = {
      openaiApiKey: "sk-openai-plan",
      openaiAuthMethod: "api_key",
      planningModel: "o3-planning",
      planningReasoningBudget: "high",
      implementationModel: "o3-impl",
    };
    const result = await buildInjectedEnv({
      workerClient: buildMockClient(keys),
      job: baseJob("codex", {
        jobType: "planning",
        interactive: true,
        config: {
          skillName: "runner-plan",
          locale: "en",
        },
      }),
      repository: {},
    });

    expect(result.resolvedModel).toBe("o3-planning");
    expect(result.env.REASONING_BUDGET).toBe("high");
    expect(result.env.ALMIRANT_USER_LOCALE).toBe("en");
    expect(result.env.ALMIRANT_PROVIDER).toBe("openai");
  });

  it("uses validation model and reasoning budget for validation jobs", async () => {
    const keys: ProviderKeysResponse = {
      openaiApiKey: "sk-openai-validate",
      openaiAuthMethod: "api_key",
      implementationModel: "o3-impl",
      validationModel: "o3-validate",
      validationReasoningBudget: "medium",
    };
    const result = await buildInjectedEnv({
      workerClient: buildMockClient(keys),
      job: baseJob("codex", {
        jobType: "validation",
        config: {
          skillName: "validate",
        },
      }),
      repository: {},
    });

    expect(result.resolvedModel).toBe("o3-validate");
    expect(result.env.REASONING_BUDGET).toBe("medium");
    expect(result.env.ALMIRANT_USER_LOCALE).toBe("es");
  });

  it("lets job reasoning level override connection reasoning budget", async () => {
    const keys: ProviderKeysResponse = {
      openaiApiKey: "sk-openai-impl",
      openaiAuthMethod: "api_key",
      implementationModel: "gpt-5.5",
      implementationReasoningBudget: "medium",
    };
    const result = await buildInjectedEnv({
      workerClient: buildMockClient(keys),
      job: baseJob("codex", {
        jobType: "implementation",
        config: {
          skillName: "implement",
          reasoningLevel: "xhigh",
        },
      }),
      repository: {},
    });

    expect(result.resolvedModel).toBe("gpt-5.5");
    expect(result.env.REASONING_BUDGET).toBe("xhigh");
  });


  it("injects xAI key and OpenCode config for Grok jobs", async () => {
    const keys: ProviderKeysResponse = {
      xaiApiKey: "xai-api-key",
      xaiAuthMethod: "api_key",
      implementationModel: "grok-4.20-reasoning",
    };
    const result = await buildInjectedEnv({
      workerClient: buildMockClient(keys),
      job: baseJob("grok"),
      repository: {},
    });

    expect(result.env.XAI_API_KEY).toBe("xai-api-key");
    expect(result.env.ALMIRANT_PROVIDER).toBe("xai");
    expect(result.env.ALMIRANT_CODING_AGENT).toBe("opencode");
    expect(result.resolvedModel).toBe("grok-4.20-reasoning");
    expect(result.openCodeConfig.model).toBe("grok-4.20-reasoning");
    expect(result.openCodeConfig.provider.xai.options.apiKey).toBe("{env:XAI_API_KEY}");
    expect(result.openCodeConfig.provider.xai.options.endpoint).toBe("https://api.x.ai/v1");
    expect(result.env.OPENAI_API_KEY).toBeUndefined();
    expect(result.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    // No reasoning budget configured → no per-model reasoningEffort override.
    expect(result.openCodeConfig.provider.xai.models).toBeUndefined();
  });

  it("wires the resolved reasoning budget into the OpenCode model options for Grok jobs", async () => {
    const keys: ProviderKeysResponse = {
      xaiApiKey: "xai-api-key",
      xaiAuthMethod: "api_key",
      implementationModel: "grok-4.3",
      implementationReasoningBudget: "high",
    };
    const result = await buildInjectedEnv({
      workerClient: buildMockClient(keys),
      job: baseJob("grok"),
      repository: {},
    });

    expect(result.env.REASONING_BUDGET).toBe("high");
    expect(
      result.openCodeConfig.provider.xai.models?.["grok-4.3"]?.options
        .reasoningEffort,
    ).toBe("high");
  });

  it("wires the resolved reasoning budget into the OpenCode model options for zipu (GLM) jobs", async () => {
    const keys: ProviderKeysResponse = {
      openaiApiKey: "zai-api-key",
      openaiAuthMethod: "api_key",
      implementationModel: "glm-5.2",
      implementationReasoningBudget: "medium",
    };
    const result = await buildInjectedEnv({
      workerClient: buildMockClient(keys),
      job: baseJob("zipu", {
        // zipu defaults to claude-shim; force the OpenCode runtime.
        config: { codingAgent: "opencode" },
      }),
      repository: {},
    });

    expect(result.env.REASONING_BUDGET).toBe("medium");
    expect(
      result.openCodeConfig.provider["zai-coding-plan"].models?.["glm-5.2"]
        ?.options.reasoningEffort,
    ).toBe("medium");
  });

  it("exposes xAI as an OpenAI-compatible backend when Grok runs with Codex", async () => {
    const keys: ProviderKeysResponse = {
      xaiApiKey: "xai-api-key",
      xaiAuthMethod: "api_key",
      implementationModel: "grok-4.20-reasoning",
    };
    const result = await buildInjectedEnv({
      workerClient: buildMockClient(keys),
      job: baseJob("grok", {
        codingAgent: "codex",
      }),
      repository: {},
    });

    expect(resolveRuntimeConfig("grok", images, "codex").type).toBe("codex-shim");
    expect(result.env.XAI_API_KEY).toBe("xai-api-key");
    expect(result.env.OPENAI_API_KEY).toBe("xai-api-key");
    expect(result.env.OPENAI_BASE_URL).toBe("https://api.x.ai/v1");
    expect(result.env.ALMIRANT_PROVIDER).toBe("xai");
    expect(result.env.ALMIRANT_CODING_AGENT).toBe("codex");
    expect(result.resolvedModel).toBe("grok-4.20-reasoning");
    expect(result.env.CODEX_AUTH_JSON).toBeUndefined();
  });

  it("uses implementation model when zipu runs with opencode codingAgent", async () => {
    const keys: ProviderKeysResponse = {
      openaiApiKey: "zai-api-key",
      openaiAuthMethod: "api_key",
      baseUrl: "https://wrong.example.test/should-not-be-used",
      implementationModel: "glm-5.1",
    };
    const result = await buildInjectedEnv({
      workerClient: buildMockClient(keys),
      job: baseJob("zipu", {
        config: {
          codingAgent: "opencode",
        },
      }),
      repository: {},
    });

    expect(result.env.ZAI_API_KEY).toBe("zai-api-key");
    expect(result.env.ALMIRANT_PROVIDER).toBe("zai");
    expect(result.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(result.env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(result.resolvedModel).toBe("glm-5.1");
    expect(result.openCodeConfig.model).toBe("glm-5.1");
    expect(result.openCodeConfig.provider["zai-coding-plan"].options.endpoint)
      .toBe("https://api.z.ai/api/coding/paas/v4");
    expect(result.openCodeConfig.provider["zai-coding-plan"].options.apiKey)
      .toBe("{env:ZAI_API_KEY}");
    expect(result.env.ALMIRANT_CODING_AGENT).toBe("opencode");
    expect(result.openCodeConfig.permission).toBe("allow");
    expect(result.openCodeConfig.agent.build.permission.edit).toBe("allow");
    expect(result.openCodeConfig.agent.build.permission.bash).toBe("allow");
  });

  it("honors top-level job.codingAgent when config.codingAgent is missing", async () => {
    const keys: ProviderKeysResponse = {
      openaiApiKey: "zai-api-key",
      openaiAuthMethod: "api_key",
      implementationModel: "glm-5.1",
    };
    const result = await buildInjectedEnv({
      workerClient: buildMockClient(keys),
      job: baseJob("zipu", {
        codingAgent: "opencode",
        config: {
          skillName: "runner-implement",
        },
      }),
      repository: {},
    });

    expect(result.env.ZAI_API_KEY).toBe("zai-api-key");
    expect(result.env.ALMIRANT_CODING_AGENT).toBe("opencode");
    expect(result.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(result.openCodeConfig.provider["zai-coding-plan"].options.apiKey)
      .toBe("{env:ZAI_API_KEY}");
  });

  it("uses top-level aiProvider when the legacy provider column is stale", async () => {
    const keys: ProviderKeysResponse = {
      openaiApiKey: "zai-api-key",
      openaiAuthMethod: "api_key",
      implementationModel: "glm-5.1",
    };
    const result = await buildInjectedEnv({
      workerClient: buildMockClient(keys),
      job: baseJob("codex", {
        codingAgent: "opencode",
        aiProvider: "zai",
        model: "glm-5.1",
        config: {
          skillName: "runner-fix-dod",
        },
      }),
      repository: {},
    });

    expect(result.env.ZAI_API_KEY).toBe("zai-api-key");
    expect(result.env.OPENAI_API_KEY).toBeUndefined();
    expect(result.env.ALMIRANT_PROVIDER).toBe("zai");
    expect(result.env.ALMIRANT_CODING_AGENT).toBe("opencode");
    expect(result.resolvedModel).toBe("glm-5.1");
    expect(result.openCodeConfig.provider["zai-coding-plan"].options.apiKey)
      .toBe("{env:ZAI_API_KEY}");
  });

  it("uses the Claude-compatible Z.AI endpoint for zipu on Claude Code even when stored baseUrl is OpenCode-specific", async () => {
    const keys: ProviderKeysResponse = {
      openaiApiKey: "zai-api-key",
      openaiAuthMethod: "api_key",
      baseUrl: "https://api.z.ai/api/coding/paas/v4",
      implementationModel: "glm-4.7",
    };
    const result = await buildInjectedEnv({
      workerClient: buildMockClient(keys),
      job: baseJob("zipu", {
        config: {
          codingAgent: "claude-code",
        },
      }),
      repository: {},
    });

    expect(result.env.ANTHROPIC_AUTH_TOKEN).toBe("zai-api-key");
    expect(result.env.ANTHROPIC_BASE_URL).toBe("https://api.z.ai/api/anthropic");
    expect(result.env.ZAI_API_KEY).toBeUndefined();
  });

  it("configura MCP autenticado con session token scoped cuando hay projectId y apiBaseUrl", async () => {
    const keys: ProviderKeysResponse = {
      openaiApiKey: "sk-openai-key",
      openaiAuthMethod: "api_key",
    };
    const requestSessionToken = mock(async () => ({
      token: "session-token",
      expiresAt: new Date().toISOString(),
    }));

    const result = await buildInjectedEnv({
      workerClient: buildMockClient(keys),
      job: baseJob("codex", {
        projectId: "project-1",
        workspaceId: "org-1",
      }),
      repository: {},
      apiBaseUrl: "http://localhost:3001/",
      requestSessionToken,
    });

    expect(requestSessionToken).toHaveBeenCalledWith({
      projectId: "project-1",
      workspaceId: "org-1",
      jobId: "job-1",
      permissions: ["mcp:read", "mcp:write"],
    });
    expect(result.openCodeConfig.mcp.almirant).toMatchObject({
      type: "remote",
      url: "http://host.docker.internal:3001/mcp?projectId=project-1&jobId=job-1",
      enabled: true,
      oauth: false,
      headers: {
        Authorization: "Bearer session-token",
      },
    });
  });

  it("apunta al mount /mcp/internal y pide mcp:internal para skills internas", async () => {
    const keys: ProviderKeysResponse = {
      anthropicApiKey: "sk-ant-key",
      anthropicAuthMethod: "api_key",
    };
    const requestSessionToken = mock(async () => ({
      token: "internal-session-token",
      expiresAt: new Date().toISOString(),
    }));

    const result = await buildInjectedEnv({
      workerClient: buildMockClient(keys),
      job: baseJob("anthropic", {
        projectId: "project-1",
        workspaceId: "org-1",
        config: {
          skillName: "feedback-bug-fix",
        },
      }),
      repository: {},
      apiBaseUrl: "http://127.0.0.1:3001",
      requestSessionToken,
    });

    expect(requestSessionToken).toHaveBeenCalledWith({
      projectId: "project-1",
      workspaceId: "org-1",
      jobId: "job-1",
      permissions: ["mcp:read", "mcp:write", "mcp:internal"],
    });
    expect(result.openCodeConfig.mcp.almirant).toMatchObject({
      type: "remote",
      url: "http://host.docker.internal:3001/mcp/internal?projectId=project-1&jobId=job-1",
      enabled: true,
      oauth: false,
      headers: {
        Authorization: "Bearer internal-session-token",
      },
    });
  });

  it("pide mcp:internal cuando el skill viaja en job.skillName/promptTemplate (sin config.skillName)", async () => {
    // Regression: feedback-triage jobs emitted by the triage enqueuer set
    // skillName + promptTemplate as top-level columns but do NOT mirror the
    // value into config.skillName. buildInjectedEnv used to read only
    // config.skillName, so requiresInternalMcp evaluated false, the MCP
    // URL fell back to /mcp and the session token omitted mcp:internal —
    // making the shim abort because the internal tools weren't visible.
    const keys: ProviderKeysResponse = {
      anthropicApiKey: "sk-ant-key",
      anthropicAuthMethod: "api_key",
    };
    const requestSessionToken = mock(async () => ({
      token: "feedback-triage-token",
      expiresAt: new Date().toISOString(),
    }));

    const result = await buildInjectedEnv({
      workerClient: buildMockClient(keys),
      job: baseJob("anthropic", {
        projectId: "project-1",
        workspaceId: "org-1",
        skillName: "feedback-triage",
        promptTemplate: "feedback-triage",
        config: {
          feedbackItemId: "9f323dca-0413-4b28-ad69-55f6827cf332",
        },
      }),
      repository: {},
      apiBaseUrl: "http://127.0.0.1:3001",
      requestSessionToken,
    });

    expect(requestSessionToken).toHaveBeenCalledWith({
      projectId: "project-1",
      workspaceId: "org-1",
      jobId: "job-1",
      permissions: ["mcp:read", "mcp:write", "mcp:internal"],
    });
    expect(result.openCodeConfig.mcp.almirant).toMatchObject({
      url: "http://host.docker.internal:3001/mcp/internal?projectId=project-1&jobId=job-1",
      headers: {
        Authorization: "Bearer feedback-triage-token",
      },
    });
  });

  it("pide mcp:internal también para feedback-triage y auto-debug-failed", async () => {
    const keys: ProviderKeysResponse = {
      anthropicApiKey: "sk-ant-key",
      anthropicAuthMethod: "api_key",
    };

    for (const skillName of ["feedback-triage", "auto-debug-failed"]) {
      const requestSessionToken = mock(async () => ({
        token: `${skillName}-token`,
        expiresAt: new Date().toISOString(),
      }));

      const result = await buildInjectedEnv({
        workerClient: buildMockClient(keys),
        job: baseJob("anthropic", {
          projectId: "project-1",
          workspaceId: "org-1",
          config: { skillName },
        }),
        repository: {},
        apiBaseUrl: "http://127.0.0.1:3001",
        requestSessionToken,
      });

      expect(requestSessionToken).toHaveBeenCalledWith({
        projectId: "project-1",
        workspaceId: "org-1",
        jobId: "job-1",
        permissions: ["mcp:read", "mcp:write", "mcp:internal"],
      });
      expect(result.openCodeConfig.mcp.almirant).toMatchObject({
        url: "http://host.docker.internal:3001/mcp/internal?projectId=project-1&jobId=job-1",
      });
    }
  });

  it("omite MCP autenticado cuando falla el session token y sigue construyendo el resto", async () => {
    const keys: ProviderKeysResponse = {
      openaiApiKey: "sk-openai-key",
      openaiAuthMethod: "api_key",
    };

    const result = await buildInjectedEnv({
      workerClient: buildMockClient(keys),
      job: baseJob("codex", {
        projectId: "project-1",
        workspaceId: "org-1",
      }),
      repository: {},
      apiBaseUrl: "http://localhost:3001",
      requestSessionToken: async () => {
        throw new Error("session token unavailable");
      },
    });

    expect(result.openCodeConfig.mcp.almirant).toBeUndefined();
    expect(result.openCodeConfig.mcp.context7).toBeDefined();
    expect(result.env.OPENAI_API_KEY).toBe("sk-openai-key");
  });

  it("inyecta MCP remoto adicional desde job.config.mcpServers sin sobrescribir servidores de plataforma", async () => {
    const keys: ProviderKeysResponse = {
      openaiApiKey: "sk-openai-key",
      openaiAuthMethod: "api_key",
    };

    const result = await buildInjectedEnv({
      workerClient: buildMockClient(keys),
      job: baseJob("codex", {
        config: {
          mcpServers: {
            "z-combinator": {
              url: "https://mcp.z-combinator.example/mcp",
            },
          },
        },
      }),
      repository: {},
    });

    expect(result.openCodeConfig.mcp["z-combinator"]).toEqual({
      type: "remote",
      url: "https://mcp.z-combinator.example/mcp",
      enabled: true,
      oauth: false,
    });
    expect(result.openCodeConfig.mcp.context7).toBeDefined();
  });

  it("inyecta Playwright MCP y ENABLE_BROWSER cuando el job declara needsBrowser", async () => {
    const keys: ProviderKeysResponse = {
      openaiApiKey: "sk-openai-key",
      openaiAuthMethod: "api_key",
    };

    const result = await buildInjectedEnv({
      workerClient: buildMockClient(keys),
      job: baseJob("codex", {
        config: {
          needsBrowser: true,
        },
      }),
      repository: {},
    });

    expect(result.env.ENABLE_BROWSER).toBe("true");
    expect(result.openCodeConfig.mcp.playwright).toMatchObject({
      type: "local",
      command: "bun",
      args: ["/usr/local/lib/node_modules/@playwright/mcp/cli.js"],
      enabled: true,
    });
  });

  it("ignora MCP custom inválido en defensa en profundidad", async () => {
    const keys: ProviderKeysResponse = {
      openaiApiKey: "sk-openai-key",
      openaiAuthMethod: "api_key",
    };

    const result = await buildInjectedEnv({
      workerClient: buildMockClient(keys),
      job: baseJob("codex", {
        config: {
          mcpServers: {
            almirant: {
              url: "https://evil.example/mcp",
            },
          },
        },
      }),
      repository: {},
    });

    expect(result.openCodeConfig.mcp.almirant).toBeUndefined();
    expect(result.openCodeConfig.mcp.context7).toBeDefined();
  });

  it("inyecta __GIT_CLONE_TOKEN cuando repository.id tiene credenciales", async () => {
    const keys: ProviderKeysResponse = {
      openaiApiKey: "sk-openai-key",
      openaiAuthMethod: "api_key",
    };

    const result = await buildInjectedEnv({
      workerClient: buildMockClient(keys),
      job: baseJob("codex"),
      repository: {
        id: "repo-123",
      },
    });

    expect(result.env.__GIT_CLONE_TOKEN).toBe("gh-token");
  });

  it("continua sin __GIT_CLONE_TOKEN si getGithubToken falla", async () => {
    const keys: ProviderKeysResponse = {
      anthropicApiKey: "sk-ant-key",
      anthropicAuthMethod: "api_key",
    };

    const result = await buildInjectedEnv({
      workerClient: {
        getProviderKeys: async () => keys,
        getGithubToken: async () => {
          throw new Error("github down");
        },
      },
      job: baseJob("anthropic"),
      repository: {
        id: "repo-123",
      },
    });

    expect(result.env.__GIT_CLONE_TOKEN).toBeUndefined();
    expect(result.env.ANTHROPIC_API_KEY).toBe("sk-ant-key");
  });
});
