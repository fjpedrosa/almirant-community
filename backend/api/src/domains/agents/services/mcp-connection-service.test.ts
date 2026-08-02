import { describe, expect, it } from "bun:test";
import type { ValidatedOutboundUrl } from "../../../shared/services/outbound-http-policy";
import { OutboundResponseLimitError } from "../../../shared/services/outbound-http-policy";
import {
  buildMcpServerHeaders,
  testMcpConnection,
  type McpConnectionClient,
  type McpConnectionServiceDependencies,
} from "./mcp-connection-service";

const validatedUrl: ValidatedOutboundUrl = {
  url: new URL("https://mcp.example.com/mcp"),
  addresses: [{ address: "93.184.216.34", family: 4 }],
  isLocalDevelopment: false,
};

const makeClient = (overrides: Partial<McpConnectionClient> = {}): McpConnectionClient => ({
  connect: async () => {},
  listTools: async () => ({ tools: [{ name: "search" }, { name: "read" }] }),
  getServerVersion: () => ({ name: "test-mcp", version: "1.2.3" }),
  close: async () => {},
  ...overrides,
});

const makeDependencies = (
  client: McpConnectionClient,
  onCreate?: (input: { headers: Record<string, string> }) => void,
): McpConnectionServiceDependencies => ({
  validateUrl: async () => validatedUrl,
  createSafeFetch: () => async () => new Response(null, { status: 204 }),
  createTransport: (_url, input) => ({ url: _url, ...input }),
  createClient: () => client,
  onTransportCreated: onCreate,
});

describe("buildMcpServerHeaders", () => {
  it("merges public template headers with encrypted credentials without exposing either layer", () => {
    expect(
      buildMcpServerHeaders({
        templateKey: "github",
        configuration: {
          readOnly: true,
          toolsets: ["repos", "issues"],
        },
        credentials: { Authorization: "Bearer github_pat_secret" },
      }),
    ).toEqual({
      "X-MCP-Readonly": "true",
      "X-MCP-Toolsets": "repos,issues",
      Authorization: "Bearer github_pat_secret",
    });
  });

  it("rejects invalid credential header names and values", () => {
    expect(() =>
      buildMcpServerHeaders({
        templateKey: null,
        configuration: {},
        credentials: { "Bad Header": "secret" },
      }),
    ).toThrow("Invalid MCP credential header");

    expect(() =>
      buildMcpServerHeaders({
        templateKey: null,
        configuration: {},
        credentials: { Authorization: "Bearer secret\r\nX-Injected: yes" },
      }),
    ).toThrow("Invalid MCP credential header");
  });
});

describe("testMcpConnection", () => {
  it("uses the official MCP client contract and returns only sanitized metadata", async () => {
    let capturedHeaders: Record<string, string> | null = null;
    const result = await testMcpConnection(
      {
        url: "https://mcp.example.com/mcp",
        headers: { Authorization: "Bearer top-secret" },
      },
      makeDependencies(makeClient(), (input) => {
        capturedHeaders = input.headers;
      }),
    );

    expect(capturedHeaders as Record<string, string> | null).toEqual({
      Authorization: "Bearer top-secret",
    });
    expect(result).toEqual({
      connected: true,
      server: { name: "test-mcp", version: "1.2.3" },
      toolCount: 2,
    });
    expect(JSON.stringify(result)).not.toContain("top-secret");
    expect(JSON.stringify(result)).not.toContain("mcp.example.com");
  });

  it("maps authentication failures to a sanitized error", async () => {
    const authError = Object.assign(new Error("Bearer top-secret rejected by https://mcp.example.com"), {
      code: 401,
    });
    const result = await testMcpConnection(
      {
        url: "https://mcp.example.com/mcp",
        headers: { Authorization: "Bearer top-secret" },
      },
      makeDependencies(makeClient({ connect: async () => Promise.reject(authError) })),
    );

    expect(result).toEqual({
      connected: false,
      error: {
        code: "AUTHENTICATION_FAILED",
        message: "The MCP server rejected the supplied credentials.",
      },
    });
    expect(JSON.stringify(result)).not.toContain("top-secret");
    expect(JSON.stringify(result)).not.toContain("mcp.example.com");
  });

  it("closes the MCP client after success and failure", async () => {
    let closeCalls = 0;
    const client = makeClient({
      connect: async () => {
        throw Object.assign(new Error("timeout"), { name: "AbortError" });
      },
      close: async () => {
        closeCalls += 1;
      },
    });

    const result = await testMcpConnection(
      { url: "https://mcp.example.com/mcp", headers: {} },
      makeDependencies(client),
    );

    expect(result).toEqual({
      connected: false,
      error: {
        code: "TIMEOUT",
        message: "The MCP server did not respond before the timeout.",
      },
    });
    expect(closeCalls).toBe(1);
  });

  it("sanitizes an oversized hostile MCP response as a connection failure", async () => {
    const result = await testMcpConnection(
      {
        url: "https://mcp.example.com/mcp",
        headers: { Authorization: "Bearer top-secret" },
      },
      makeDependencies(
        makeClient({
          connect: async () => {
            throw new OutboundResponseLimitError();
          },
        }),
      ),
    );

    expect(result).toEqual({
      connected: false,
      error: {
        code: "CONNECTION_FAILED",
        message: "Almirant could not establish a valid MCP connection.",
      },
    });
    expect(JSON.stringify(result)).not.toContain("top-secret");
    expect(JSON.stringify(result)).not.toContain("mcp.example.com");
  });
});
