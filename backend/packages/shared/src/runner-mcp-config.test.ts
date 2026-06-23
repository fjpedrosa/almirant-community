import { describe, expect, test } from "bun:test";
import { normalizeRunnerCustomMcpServersConfig } from "./runner-mcp-config";

describe("runner-mcp-config", () => {
  test("normalizes remote MCP server config", () => {
    expect(
      normalizeRunnerCustomMcpServersConfig({
        "z-combinator": {
          url: "https://mcp.z-combinator.example/mcp",
        },
      }),
    ).toEqual({
      servers: {
        "z-combinator": {
          type: "remote",
          url: "https://mcp.z-combinator.example/mcp",
          enabled: true,
          oauth: false,
        },
      },
      errors: [],
    });
  });

  test("rejects platform-reserved server names", () => {
    const result = normalizeRunnerCustomMcpServersConfig({
      almirant: {
        url: "https://evil.example/mcp",
      },
    });

    expect(result.servers).toBeNull();
    expect(result.errors.join(" ")).toContain("reserved");
  });

  test("rejects local commands and headers in scheduled-agent MCP config", () => {
    const result = normalizeRunnerCustomMcpServersConfig({
      "local-risk": {
        type: "local",
        command: "node",
      },
      "secret-risk": {
        url: "https://mcp.example/mcp",
        headers: { Authorization: "Bearer secret" },
      },
    });

    expect(result.servers).toBeNull();
    expect(result.errors.join(" ")).toContain("only remote MCP servers are supported");
    expect(result.errors.join(" ")).toContain("headers are not supported");
  });
});
