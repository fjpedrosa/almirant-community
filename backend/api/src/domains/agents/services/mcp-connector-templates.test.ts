import { describe, expect, it } from "bun:test";
import {
  MCP_CONNECTOR_TEMPLATES,
  buildMcpConnectorCredentials,
  buildMcpConnectorPublicHeaders,
  getMcpConnectorTemplate,
  isMcpConnectorTemplateKey,
  normalizeMcpConnectorConfiguration,
} from "./mcp-connector-templates";

describe("MCP connector templates", () => {
  it("ships verified Context7 and GitHub connectors", () => {
    expect(MCP_CONNECTOR_TEMPLATES.map((template) => template.key)).toEqual([
      "context7",
      "github",
      "scraper",
    ]);

    expect(getMcpConnectorTemplate("context7")).toMatchObject({
      url: "https://mcp.context7.com/mcp",
      authType: "custom_header",
      authHeaderName: "CONTEXT7_API_KEY",
      secretRequired: false,
      runnerServerName: "context7-authenticated",
    });

    expect(getMcpConnectorTemplate("github")).toMatchObject({
      url: "https://api.githubcopilot.com/mcp/",
      authType: "bearer",
      secretRequired: true,
      runnerServerName: "github",
    });

    expect(getMcpConnectorTemplate("scraper")).toMatchObject({
      url: "https://scraper.fjpedrosa.com/mcp",
      authType: "bearer",
      authHeaderName: "Authorization",
      secretRequired: true,
      runnerServerName: "scraper",
      defaultConfiguration: {},
    });
    expect(isMcpConnectorTemplateKey("scraper")).toBe(true);
  });

  it("maps connector secrets to the exact provider header", () => {
    expect(buildMcpConnectorCredentials("github", "github_pat_123")).toEqual({
      Authorization: "Bearer github_pat_123",
    });
    expect(buildMcpConnectorCredentials("context7", "ctx7sk_123")).toEqual({
      CONTEXT7_API_KEY: "ctx7sk_123",
    });
    expect(buildMcpConnectorCredentials("scraper", "scraper_token_123")).toEqual({
      Authorization: "Bearer scraper_token_123",
    });
    expect(
      buildMcpConnectorCredentials("scraper", "Bearer scraper_token_456"),
    ).toEqual({
      Authorization: "Bearer scraper_token_456",
    });
  });

  it("allows Context7 without a key but requires a GitHub token", () => {
    expect(buildMcpConnectorCredentials("context7", null)).toBeNull();
    expect(() => buildMcpConnectorCredentials("github", null)).toThrow(
      "GitHub token is required",
    );
    expect(() => buildMcpConnectorCredentials("scraper", null)).toThrow(
      "Scraper token is required",
    );
  });

  it("converts GitHub least-privilege options to non-secret headers", () => {
    expect(
      buildMcpConnectorPublicHeaders("github", {
        readOnly: true,
        toolsets: ["repos", "issues", "pull_requests"],
      }),
    ).toEqual({
      "X-MCP-Readonly": "true",
      "X-MCP-Toolsets": "repos,issues,pull_requests",
    });
  });

  it("normalizes only the supported public GitHub configuration", () => {
    expect(
      normalizeMcpConnectorConfiguration("github", {
        readOnly: false,
        toolsets: ["repos", "repos", "issues"],
      }),
    ).toEqual({
      readOnly: false,
      toolsets: ["repos", "issues"],
    });

    expect(() =>
      normalizeMcpConnectorConfiguration("github", {
        headers: { Authorization: "must-not-be-public-configuration" },
      }),
    ).toThrow("Unsupported GitHub connector configuration");

    expect(() =>
      normalizeMcpConnectorConfiguration("github", {
        toolsets: ["repos", "not-a-real-toolset"],
      }),
    ).toThrow("Unsupported GitHub toolset");
  });

  it("does not permit arbitrary configuration for Context7", () => {
    expect(normalizeMcpConnectorConfiguration("context7", undefined)).toEqual({});
    expect(() =>
      normalizeMcpConnectorConfiguration("context7", { customHeader: "secret" }),
    ).toThrow("does not accept public configuration");
  });

  it("keeps the managed scraper connector free of public headers", () => {
    expect(normalizeMcpConnectorConfiguration("scraper", undefined)).toEqual({});
    expect(buildMcpConnectorPublicHeaders("scraper", {})).toEqual({});
    expect(() =>
      normalizeMcpConnectorConfiguration("scraper", {
        Authorization: "must-remain-encrypted",
      }),
    ).toThrow("Scraper does not accept public configuration");
  });
});
