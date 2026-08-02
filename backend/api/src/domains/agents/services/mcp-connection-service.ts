import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  OutboundUrlPolicyError,
  createSafeOutboundFetch,
  validateOutboundHttpUrl,
  type ValidatedOutboundUrl,
} from "../../../shared/services/outbound-http-policy";
import {
  buildMcpConnectorPublicHeaders,
  isMcpConnectorTemplateKey,
} from "./mcp-connector-templates";

const MCP_HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/;
const FORBIDDEN_TRANSPORT_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const DEFAULT_CONNECTION_TIMEOUT_MS = 8_000;

export interface BuildMcpServerHeadersInput {
  templateKey?: string | null;
  configuration?: Record<string, unknown> | null;
  credentials?: Record<string, unknown> | null;
}

export const buildMcpServerHeaders = (
  input: BuildMcpServerHeadersInput,
): Record<string, string> => {
  const headers = input.templateKey && isMcpConnectorTemplateKey(input.templateKey)
    ? buildMcpConnectorPublicHeaders(input.templateKey, input.configuration)
    : {};

  for (const [name, rawValue] of Object.entries(input.credentials ?? {})) {
    const normalizedName = name.trim();
    if (
      !MCP_HEADER_NAME_RE.test(normalizedName) ||
      FORBIDDEN_TRANSPORT_HEADERS.has(normalizedName.toLowerCase()) ||
      typeof rawValue !== "string"
    ) {
      throw new Error("Invalid MCP credential header");
    }
    const value = rawValue.trim();
    if (!value || value.length > 4_096 || /[\r\n]/.test(value)) {
      throw new Error("Invalid MCP credential header");
    }
    headers[normalizedName] = value;
  }

  if (Object.keys(headers).length > 10) {
    throw new Error("MCP headers exceed the safety limit");
  }
  return headers;
};

export interface McpConnectionClient {
  connect(
    transport: unknown,
    options?: { timeout?: number; maxTotalTimeout?: number; signal?: AbortSignal },
  ): Promise<void>;
  listTools(
    params?: Record<string, never>,
    options?: { timeout?: number; maxTotalTimeout?: number; signal?: AbortSignal },
  ): Promise<{ tools: Array<{ name: string }> }>;
  getServerVersion(): { name: string; version: string } | undefined;
  close(): Promise<void>;
}

export interface McpConnectionServiceDependencies {
  validateUrl: (url: string | URL) => Promise<ValidatedOutboundUrl>;
  createSafeFetch: () => (url: string | URL, init?: RequestInit) => Promise<Response>;
  createTransport: (
    url: URL,
    input: {
      headers: Record<string, string>;
      fetch: (url: string | URL, init?: RequestInit) => Promise<Response>;
    },
  ) => unknown;
  createClient: () => McpConnectionClient;
  onTransportCreated?: (input: { headers: Record<string, string> }) => void;
  timeoutMs?: number;
}

const defaultDependencies: McpConnectionServiceDependencies = {
  validateUrl: validateOutboundHttpUrl,
  createSafeFetch: () => createSafeOutboundFetch(),
  createTransport: (url, input) =>
    new StreamableHTTPClientTransport(url, {
      fetch: input.fetch,
      requestInit: { headers: input.headers, redirect: "manual" },
      reconnectionOptions: {
        initialReconnectionDelay: 100,
        maxReconnectionDelay: 500,
        reconnectionDelayGrowFactor: 1,
        maxRetries: 0,
      },
    }),
  createClient: () => {
    const client = new Client(
      { name: "almirant-mcp-connection-test", version: "1.0.0" },
      { capabilities: {} },
    );
    return {
      connect: (transport, options) =>
        client.connect(
          transport as Parameters<Client["connect"]>[0],
          options,
        ),
      listTools: (_params, options) => client.listTools(undefined, options),
      getServerVersion: () => client.getServerVersion(),
      close: () => client.close(),
    };
  },
};

export type McpConnectionTestResult =
  | {
      connected: true;
      server: { name: string; version: string };
      toolCount: number;
    }
  | {
      connected: false;
      error: {
        code:
          | "UNSAFE_URL"
          | "AUTHENTICATION_FAILED"
          | "ENDPOINT_NOT_FOUND"
          | "TIMEOUT"
          | "CONNECTION_FAILED";
        message: string;
      };
    };

const sanitizeServerMetadata = (value: unknown, fallback: string): string => {
  if (typeof value !== "string") return fallback;
  const sanitized = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 128);
  return sanitized || fallback;
};

const getErrorStatus = (error: unknown): number | null => {
  if (!error || typeof error !== "object") return null;
  for (const key of ["code", "status", "statusCode"] as const) {
    const value = (error as Record<string, unknown>)[key];
    if (typeof value === "number") return value;
    if (typeof value === "string" && /^\d{3}$/.test(value)) return Number(value);
  }
  return null;
};

const sanitizeConnectionError = (error: unknown): McpConnectionTestResult => {
  if (error instanceof OutboundUrlPolicyError) {
    return {
      connected: false,
      error: {
        code: "UNSAFE_URL",
        message: "The MCP URL is not allowed by the outbound network policy.",
      },
    };
  }

  const status = getErrorStatus(error);
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (status === 401 || status === 403 || name === "UnauthorizedError") {
    return {
      connected: false,
      error: {
        code: "AUTHENTICATION_FAILED",
        message: "The MCP server rejected the supplied credentials.",
      },
    };
  }
  if (status === 404) {
    return {
      connected: false,
      error: {
        code: "ENDPOINT_NOT_FOUND",
        message: "No MCP endpoint was found at the configured URL.",
      },
    };
  }
  if (
    name === "AbortError" ||
    name === "TimeoutError" ||
    message.includes("timeout") ||
    message.includes("timed out")
  ) {
    return {
      connected: false,
      error: {
        code: "TIMEOUT",
        message: "The MCP server did not respond before the timeout.",
      },
    };
  }
  return {
    connected: false,
    error: {
      code: "CONNECTION_FAILED",
      message: "Almirant could not establish a valid MCP connection.",
    },
  };
};

export const testMcpConnection = async (
  input: { url: string; headers: Record<string, string> },
  dependencies: McpConnectionServiceDependencies = defaultDependencies,
): Promise<McpConnectionTestResult> => {
  let client: McpConnectionClient | null = null;
  const timeoutMs = Math.min(
    Math.max(dependencies.timeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS, 100),
    30_000,
  );

  try {
    const validated = await dependencies.validateUrl(input.url);
    const safeFetch = dependencies.createSafeFetch();
    const transport = dependencies.createTransport(validated.url, {
      headers: input.headers,
      fetch: safeFetch,
    });
    dependencies.onTransportCreated?.({ headers: input.headers });
    client = dependencies.createClient();

    await client.connect(transport, {
      timeout: timeoutMs,
      maxTotalTimeout: timeoutMs,
    });
    const tools = await client.listTools(undefined, {
      timeout: timeoutMs,
      maxTotalTimeout: timeoutMs,
    });
    const version = client.getServerVersion();

    return {
      connected: true,
      server: {
        name: sanitizeServerMetadata(version?.name, "MCP server"),
        version: sanitizeServerMetadata(version?.version, "unknown"),
      },
      toolCount: Array.isArray(tools.tools) ? tools.tools.length : 0,
    };
  } catch (error) {
    return sanitizeConnectionError(error);
  } finally {
    if (client) {
      await client.close().catch(() => undefined);
    }
  }
};
