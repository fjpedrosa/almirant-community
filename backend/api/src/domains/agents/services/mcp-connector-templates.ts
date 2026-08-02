export const MCP_CONNECTOR_TEMPLATE_KEYS = [
  "context7",
  "github",
  "scraper",
] as const;

export type McpConnectorTemplateKey =
  (typeof MCP_CONNECTOR_TEMPLATE_KEYS)[number];

export interface McpConnectorTemplate {
  key: McpConnectorTemplateKey;
  name: string;
  description: string;
  url: string;
  runnerServerName: string;
  authType: "bearer" | "custom_header";
  authHeaderName: string;
  secretLabel: string;
  secretRequired: boolean;
  docsUrl: string;
  defaultConfiguration: Record<string, unknown>;
}

export const MCP_CONNECTOR_TEMPLATES: readonly McpConnectorTemplate[] = [
  {
    key: "context7",
    name: "Context7",
    description: "Version-aware library documentation and examples for coding agents.",
    url: "https://mcp.context7.com/mcp",
    // `context7` is reserved by the runner for its unauthenticated built-in.
    // Keep an authenticated profile distinct until the runtime supports a
    // trusted override of platform MCP entries.
    runnerServerName: "context7-authenticated",
    authType: "custom_header",
    authHeaderName: "CONTEXT7_API_KEY",
    secretLabel: "Context7 API key",
    secretRequired: false,
    docsUrl: "https://context7.com/docs/resources/all-clients",
    defaultConfiguration: {},
  },
  {
    key: "github",
    name: "GitHub",
    description: "Repository, issue, pull request and Actions tools from GitHub's official MCP server.",
    url: "https://api.githubcopilot.com/mcp/",
    runnerServerName: "github",
    authType: "bearer",
    authHeaderName: "Authorization",
    secretLabel: "GitHub personal access token",
    secretRequired: true,
    docsUrl: "https://github.com/github/github-mcp-server",
    defaultConfiguration: {
      readOnly: true,
      toolsets: ["context", "repos", "issues", "pull_requests"],
    },
  },
  {
    key: "scraper",
    name: "Scraper",
    description:
      "Managed public-web scraping, mapping, crawling and browser rendering.",
    url: "https://scraper.fjpedrosa.com/mcp",
    runnerServerName: "scraper",
    authType: "bearer",
    authHeaderName: "Authorization",
    secretLabel: "Scraper MCP bearer token",
    secretRequired: true,
    docsUrl:
      "https://github.com/almirant-ai/almirant-cloud/tree/main/cloud/scraper",
    defaultConfiguration: {},
  },
] as const;

export const getMcpConnectorTemplate = (
  key: string,
): McpConnectorTemplate => {
  const template = MCP_CONNECTOR_TEMPLATES.find((candidate) => candidate.key === key);
  if (!template) throw new Error(`Unknown MCP connector template: ${key}`);
  return template;
};

export const isMcpConnectorTemplateKey = (
  value: unknown,
): value is McpConnectorTemplateKey =>
  value === "context7" || value === "github" || value === "scraper";

export const buildMcpConnectorCredentials = (
  key: McpConnectorTemplateKey,
  secret: string | null | undefined,
): Record<string, string> | null => {
  const template = getMcpConnectorTemplate(key);
  const normalizedSecret = secret?.trim() || "";
  if (!normalizedSecret) {
    if (template.secretRequired) {
      throw new Error(`${template.name} token is required`);
    }
    return null;
  }

  if (template.authType === "bearer") {
    return {
      Authorization: normalizedSecret.toLowerCase().startsWith("bearer ")
        ? normalizedSecret
        : `Bearer ${normalizedSecret}`,
    };
  }

  return { [template.authHeaderName]: normalizedSecret };
};

const GITHUB_TOOLSETS = new Set([
  "default",
  "context",
  "actions",
  "code_security",
  "copilot",
  "dependabot",
  "discussions",
  "gists",
  "git",
  "issues",
  "labels",
  "notifications",
  "orgs",
  "projects",
  "pull_requests",
  "repos",
  "secret_protection",
  "security_advisories",
  "stargazers",
  "users",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const normalizeMcpConnectorConfiguration = (
  key: McpConnectorTemplateKey,
  configuration: unknown,
): Record<string, unknown> => {
  const template = getMcpConnectorTemplate(key);
  const raw = configuration ?? {};
  if (!isRecord(raw)) {
    throw new Error(`${template.name} connector configuration must be an object`);
  }

  const keys = Object.keys(raw);
  if (key === "context7" || key === "scraper") {
    if (keys.length > 0) {
      throw new Error(`${template.name} does not accept public configuration`);
    }
    return {};
  }

  const unsupported = keys.filter((candidate) =>
    candidate !== "readOnly" && candidate !== "toolsets");
  if (unsupported.length > 0) {
    throw new Error(
      `Unsupported GitHub connector configuration: ${unsupported.join(", ")}`,
    );
  }

  const defaultReadOnly = template.defaultConfiguration.readOnly;
  const readOnly = raw.readOnly ?? defaultReadOnly;
  if (typeof readOnly !== "boolean") {
    throw new Error("GitHub connector readOnly must be a boolean");
  }

  const defaultToolsets = template.defaultConfiguration.toolsets;
  const rawToolsets = raw.toolsets ?? defaultToolsets;
  if (!Array.isArray(rawToolsets) || rawToolsets.length > 25) {
    throw new Error("GitHub connector toolsets must be an array with at most 25 entries");
  }

  const toolsets: string[] = [];
  for (const value of rawToolsets) {
    if (typeof value !== "string" || !GITHUB_TOOLSETS.has(value)) {
      throw new Error(`Unsupported GitHub toolset: ${String(value)}`);
    }
    if (!toolsets.includes(value)) toolsets.push(value);
  }

  return { readOnly, toolsets };
};

export const buildMcpConnectorPublicHeaders = (
  key: McpConnectorTemplateKey,
  configuration: Record<string, unknown> | null | undefined,
): Record<string, string> => {
  if (key !== "github") return {};

  const normalized = normalizeMcpConnectorConfiguration(key, configuration);

  const headers: Record<string, string> = {};
  if (normalized.readOnly === true) {
    headers["X-MCP-Readonly"] = "true";
  }
  if (Array.isArray(normalized.toolsets)) {
    const toolsets = Array.from(
      new Set(
        normalized.toolsets.filter(
          (value): value is string => typeof value === "string" && GITHUB_TOOLSETS.has(value),
        ),
      ),
    );
    if (toolsets.length > 0) headers["X-MCP-Toolsets"] = toolsets.join(",");
  }
  return headers;
};
