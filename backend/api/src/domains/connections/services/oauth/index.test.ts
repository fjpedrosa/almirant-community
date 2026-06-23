import { afterAll, describe, expect, it, mock } from "bun:test";
import { restoreRealModules } from "../../../../test/mocks";

mock.module("@almirant/config", () => ({
  env: {
    ANTHROPIC_OAUTH_REDIRECT_URI: undefined,
    ANTHROPIC_OAUTH_CLIENT_ID: undefined,
  },
  logger: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
    trace: () => {},
    child: () => ({
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      fatal: () => {},
      trace: () => {},
      child: () => ({}),
    }),
  },
}));

describe("isAnthropicOAuthAuthMethod", () => {
  it("treats subscription auth as OAuth-compatible for Anthropic", async () => {
    const { isAnthropicOAuthAuthMethod } = await import("./index");

    expect(isAnthropicOAuthAuthMethod("subscription")).toBe(true);
    expect(isAnthropicOAuthAuthMethod("setup_token")).toBe(true);
    expect(isAnthropicOAuthAuthMethod("oauth")).toBe(true);
    expect(isAnthropicOAuthAuthMethod("api_key")).toBe(false);
    expect(isAnthropicOAuthAuthMethod(undefined)).toBe(false);
  });
});

describe("getStealthHeaders", () => {
  it("returns stealth headers for Anthropic subscription auth", async () => {
    const { ANTHROPIC_STEALTH_HEADERS, getStealthHeaders } = await import(
      "./index"
    );

    expect(getStealthHeaders("anthropic", "subscription")).toEqual(
      ANTHROPIC_STEALTH_HEADERS,
    );
  });

  it("does not return stealth headers for Anthropic API keys", async () => {
    const { getStealthHeaders } = await import("./index");

    expect(getStealthHeaders("anthropic", "api_key")).toBeNull();
  });
});

describe("getOAuthProvider", () => {
  it("uses Anthropic subscription OAuth endpoints and scopes compatible with Claude Code", async () => {
    const { getOAuthProvider } = await import("./index");
    const config = await getOAuthProvider("anthropic");

    expect(config).not.toBeNull();
    expect(config?.authorizeUrl).toBe("https://claude.ai/oauth/authorize");
    expect(config?.tokenUrl).toBe("https://platform.claude.com/v1/oauth/token");
    expect(config?.redirectUri).toBe(
      "https://platform.claude.com/oauth/code/callback",
    );
    expect(config?.scopes).toContain("user:profile");
    expect(config?.scopes).toContain("user:inference");
    expect(config?.scopes).toContain("user:sessions:claude_code");
    expect(config?.scopes).toContain("user:mcp_servers");
    expect(config?.scopes).not.toContain("org:create_api_key");
    expect(config?.extraAuthParams).toEqual({ code: "true" });
    expect(config?.tokenRequestFormat).toBe("json");
    expect(config?.includeStateInTokenExchange).toBe(true);
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
});
