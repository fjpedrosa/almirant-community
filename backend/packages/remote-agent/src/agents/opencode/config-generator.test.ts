import { describe, expect, it } from "bun:test";
import {
  buildOpenCodeConfig,
  buildOpenCodeConfigJson,
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
