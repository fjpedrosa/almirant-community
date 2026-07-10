import { describe, expect, it } from "bun:test";
import {
  buildOpenCodeConfig,
  buildOpenCodeConfigJson,
  buildOpenCodeReasoningOption,
} from "./config-generator";

describe("opencode config-generator", () => {
  it("builds model string as provider/model", () => {
    const config = buildOpenCodeConfig({
      provider: "openai",
      model: "o3",
      apiKeyEnvVar: "OPENAI_API_KEY",
    });

    expect(config.model).toBe("openai/o3");
  });

  it("builds provider map with options and apiKey using {env:} format", () => {
    const config = buildOpenCodeConfig({
      provider: "anthropic",
      model: "claude-sonnet-5",
      apiKeyEnvVar: "ANTHROPIC_API_KEY",
    });

    expect(config.provider.anthropic).toBeDefined();
    expect(config.provider.anthropic.options.apiKey).toBe("{env:ANTHROPIC_API_KEY}");
  });

  it("includes endpoint for providers with baseUrl", () => {
    const config = buildOpenCodeConfig({
      provider: "openai-compatible",
      model: "glm-5.2",
      baseUrl: "https://api.z.ai/v1",
    });

    expect(config.model).toBe("openai-compatible/glm-5.2");
    expect(config.provider["openai-compatible"].options.endpoint).toBe("https://api.z.ai/v1");
  });

  it("supports official zai provider identifiers", () => {
    const config = buildOpenCodeConfig({
      provider: "zai",
      model: "glm-5",
      smallModel: "glm-4.7-flash",
      apiKeyEnvVar: "OPENAI_API_KEY",
    });

    expect(config.model).toBe("zai/glm-5");
    expect(config.small_model).toBe("zai/glm-4.7-flash");
    expect(config.provider.zai.options.apiKey).toBe("{env:OPENAI_API_KEY}");
  });

  it("configures OpenCode in YOLO mode", () => {
    const config = buildOpenCodeConfig({
      provider: "anthropic",
      model: "claude-sonnet-5",
    });

    expect(config.instructions).toEqual(["AGENTS.md"]);
    expect(config.permission).toBe("allow");
    expect(config.agent.build.permission.edit).toBe("allow");
    expect(config.agent.build.permission.bash).toBe("allow");
  });

  it("embeds MCP servers in config", () => {
    const config = buildOpenCodeConfig({
      provider: "openai",
      model: "o3",
      mcpServers: {
        almirant: {
          type: "remote",
          url: "https://api.almirant.ai/mcp?projectId=123",
          enabled: true,
          headers: { Authorization: "Bearer key-123" },
        },
      },
    });

    const almirantServer = config.mcp.almirant;
    expect(almirantServer).toBeDefined();
    expect(almirantServer?.type).toBe("remote");
    if (!almirantServer || almirantServer.type !== "remote") {
      throw new Error("Expected almirant MCP server to be remote");
    }

    expect(almirantServer.url).toContain("projectId=123");
    expect(almirantServer.headers?.Authorization).toBe("Bearer key-123");
  });

  it("serializes to valid JSON with schema", () => {
    const json = buildOpenCodeConfigJson({
      provider: "anthropic",
      model: "claude-sonnet-5",
    });
    const parsed = JSON.parse(json);
    expect(parsed.$schema).toBe("https://opencode.ai/config.json");
    expect(parsed.model).toBe("anthropic/claude-sonnet-5");
  });
});

describe("buildOpenCodeReasoningOption", () => {
  it("returns undefined when no budget is provided", () => {
    expect(buildOpenCodeReasoningOption(undefined)).toBeUndefined();
    expect(buildOpenCodeReasoningOption("")).toBeUndefined();
    expect(buildOpenCodeReasoningOption("   ")).toBeUndefined();
  });

  it("passes through the built-in REASONING_BUDGET vocabulary 1:1", () => {
    for (const level of ["minimal", "low", "medium", "high", "xhigh", "max"]) {
      expect(buildOpenCodeReasoningOption(level)).toEqual({
        reasoningEffort: level,
      });
    }
  });

  it("accepts the OpenAI-style `none` effort", () => {
    expect(buildOpenCodeReasoningOption("none")).toEqual({
      reasoningEffort: "none",
    });
  });

  it("normalizes casing and surrounding whitespace", () => {
    expect(buildOpenCodeReasoningOption("  High ")).toEqual({
      reasoningEffort: "high",
    });
  });

  it("maps the `min` alias to `minimal` like the claude/codex shims", () => {
    expect(buildOpenCodeReasoningOption("min")).toEqual({
      reasoningEffort: "minimal",
    });
  });

  it("returns undefined for unknown values", () => {
    expect(buildOpenCodeReasoningOption("turbo")).toBeUndefined();
    expect(buildOpenCodeReasoningOption("ultra")).toBeUndefined();
  });
});

describe("buildOpenCodeConfig reasoningEffort wiring", () => {
  it("injects reasoningEffort under the model options when a budget is set", () => {
    const config = buildOpenCodeConfig({
      provider: "xai",
      model: "grok-4.3",
      apiKeyEnvVar: "XAI_API_KEY",
      baseUrl: "https://api.x.ai/v1",
      reasoningBudget: "high",
    });

    expect(config.provider.xai.models?.["grok-4.3"]?.options.reasoningEffort).toBe(
      "high",
    );
    // The provider options (apiKey/endpoint) must remain untouched.
    expect(config.provider.xai.options.apiKey).toBe("{env:XAI_API_KEY}");
    expect(config.provider.xai.options.endpoint).toBe("https://api.x.ai/v1");
  });

  it("normalizes the budget value before injecting it", () => {
    const config = buildOpenCodeConfig({
      provider: "zai-coding-plan",
      model: "glm-5.2",
      apiKeyEnvVar: "ZAI_API_KEY",
      reasoningBudget: "MAX",
    });

    expect(
      config.provider["zai-coding-plan"].models?.["glm-5.2"]?.options
        .reasoningEffort,
    ).toBe("max");
  });

  it("omits the models key entirely when no budget is set (byte-identical)", () => {
    const withoutBudget = buildOpenCodeConfig({
      provider: "xai",
      model: "grok-4.3",
      apiKeyEnvVar: "XAI_API_KEY",
      baseUrl: "https://api.x.ai/v1",
    });
    const withUndefinedBudget = buildOpenCodeConfig({
      provider: "xai",
      model: "grok-4.3",
      apiKeyEnvVar: "XAI_API_KEY",
      baseUrl: "https://api.x.ai/v1",
      reasoningBudget: undefined,
    });

    expect(withoutBudget.provider.xai.models).toBeUndefined();
    // Passing an explicit `undefined` budget must produce byte-identical output.
    expect(JSON.stringify(withUndefinedBudget)).toBe(
      JSON.stringify(withoutBudget),
    );
  });

  it("omits the models key when the budget value is unknown", () => {
    const config = buildOpenCodeConfig({
      provider: "xai",
      model: "grok-4.3",
      apiKeyEnvVar: "XAI_API_KEY",
      reasoningBudget: "turbo",
    });

    expect(config.provider.xai.models).toBeUndefined();
  });
});
