import { describe, expect, test } from "bun:test";
import { normalizeRunnerCustomMcpServersConfig } from "./runner-mcp-config";

describe("runner-mcp-config", () => {
  test("rejects unmanaged remote MCP servers so runners cannot bypass the safe gateway", () => {
    const result = normalizeRunnerCustomMcpServersConfig({
      "z-combinator": {
        url: "https://mcp.z-combinator.example/mcp",
      },
    });

    expect(result.servers).toBeNull();
    expect(result.errors.join(" ")).toContain("MCP profile");
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

  test("rejects inline MCP headers so secrets cannot be persisted in job config", () => {
    const result = normalizeRunnerCustomMcpServersConfig({
      "private-search": {
        url: "https://mcp.example/mcp",
        headers: { Authorization: "Bearer secret" },
      },
    });

    expect(result.servers).toBeNull();
    expect(result.errors.join(" ")).toContain("MCP profile");
  });

  test("preserves a validated Almirant gateway server id", () => {
    expect(
      normalizeRunnerCustomMcpServersConfig({
        private_docs: {
          url: "https://mcp.example.com/mcp",
          almirantServerId: "6e9fa58b-3490-4e39-982f-444e5c697e55",
        },
      }),
    ).toEqual({
      servers: {
        private_docs: {
          type: "remote",
          url: "https://mcp.example.com/mcp",
          enabled: true,
          oauth: false,
          almirantServerId: "6e9fa58b-3490-4e39-982f-444e5c697e55",
        },
      },
      errors: [],
    });
  });

  test("rejects local commands and unsafe header values in scheduled-agent MCP config", () => {
    const result = normalizeRunnerCustomMcpServersConfig({
      "local-risk": {
        type: "local",
        command: "node",
      },
      "secret-risk": {
        url: "https://mcp.example/mcp",
        headers: { Authorization: "Bearer secret\nX-Evil: yes" },
      },
    });

    expect(result.servers).toBeNull();
    expect(result.errors.join(" ")).toContain("only remote MCP servers are supported");
    expect(result.errors.join(" ")).toContain("MCP profile");
  });
});
