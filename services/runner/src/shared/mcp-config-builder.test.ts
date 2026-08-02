import { describe, expect, it } from "bun:test";
import { buildClaudeMcpConfig, buildCodexMcpConfig } from "./mcp-config-builder";

describe("mcp-config-builder", () => {
  it("propagates authenticated remote MCP headers to Claude HTTP config", () => {
    expect(
      buildClaudeMcpConfig({
        profileMiner: {
          type: "remote",
          url: "https://mcp.example.com/mcp",
          headers: {
            authorization: "Bearer secret-token",
            "X-Workspace": "org-1",
          },
        },
      }),
    ).toEqual({
      mcpServers: {
        profileMiner: {
          type: "http",
          url: "https://mcp.example.com/mcp",
          headers: {
            authorization: "Bearer secret-token",
            Authorization: "Bearer secret-token",
            "X-Workspace": "org-1",
          },
        },
      },
    });
  });

  it("converts Codex Bearer MCP auth into an env var and preserves non-bearer headers", () => {
    expect(
      buildCodexMcpConfig({
        "profile-miner": {
          type: "remote",
          url: "https://mcp.example.com/mcp",
          headers: {
            Authorization: "Bearer secret-token",
          },
        },
        customHeader: {
          type: "remote",
          url: "https://custom.example.com/mcp",
          headers: {
            "X-API-Key": "custom-secret",
          },
        },
      }),
    ).toEqual({
      servers: {
        "profile-miner": {
          url: "https://mcp.example.com/mcp",
          bearer_token_env_var: "MCP_TOKEN_PROFILE_MINER",
        },
        customHeader: {
          url: "https://custom.example.com/mcp",
          headers: {
            "X-API-Key": "custom-secret",
          },
        },
      },
      tokenEnvVars: {
        MCP_TOKEN_PROFILE_MINER: "secret-token",
      },
    });
  });
});
