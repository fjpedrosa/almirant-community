const MARKETPLACE_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const PLUGIN_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const GITHUB_REPO_RE = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/;
const MAX_CATALOG_PLUGINS = 500;
const CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f]/;
const SOURCE_KIND_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const WINDOWS_DRIVE_RE = /^[A-Za-z]:/;
const SOURCE_OBJECT_FIELDS = {
  source: 32,
  repo: 255,
  url: 2_048,
  path: 512,
  ref: 255,
  sha: 128,
  package: 255,
  version: 100,
} as const;

export interface ClaudeMarketplaceSource {
  cliSource: string;
  catalogUrl: string;
}

export interface ClaudeMarketplacePlugin {
  externalId: string;
  name: string;
  description: string | null;
  version: string | null;
  category: string | null;
  tags: string[];
  source: ClaudeMarketplacePluginSource;
}

export type ClaudeMarketplacePluginSource =
  | string
  | Partial<Record<keyof typeof SOURCE_OBJECT_FIELDS, string>>;

export interface ClaudeMarketplaceCatalog {
  name: string;
  ownerName: string | null;
  plugins: ClaudeMarketplacePlugin[];
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const isSafeRelativePath = (value: string): boolean => {
  const normalized = value.startsWith("./") ? value.slice(2) : value;
  if (
    !normalized ||
    normalized.startsWith("/") ||
    WINDOWS_DRIVE_RE.test(normalized) ||
    normalized.includes("\\") ||
    CONTROL_CHARACTER_RE.test(normalized)
  ) {
    return false;
  }
  return normalized
    .split("/")
    .every((segment) => Boolean(segment) && segment !== "." && segment !== "..");
};

const sanitizeClaudePluginSource = (
  input: unknown,
): ClaudeMarketplacePluginSource | null => {
  if (typeof input === "string") {
    const source = input.trim();
    if (
      !source ||
      source.length > 2_048 ||
      source.includes("\\") ||
      CONTROL_CHARACTER_RE.test(source)
    ) {
      return null;
    }
    if (
      source.startsWith(".") ||
      source.startsWith("/") ||
      (!source.includes("://") && source.split("/").includes(".."))
    ) {
      return isSafeRelativePath(source) ? source : null;
    }
    return source;
  }

  const record = asRecord(input);
  if (!record || typeof record.source !== "string") return null;
  const sourceKind = record.source.trim();
  if (!SOURCE_KIND_RE.test(sourceKind)) return null;

  const sanitized: Partial<Record<keyof typeof SOURCE_OBJECT_FIELDS, string>> = {
    source: sourceKind,
  };
  for (const [key, maxLength] of Object.entries(SOURCE_OBJECT_FIELDS) as Array<
    [keyof typeof SOURCE_OBJECT_FIELDS, number]
  >) {
    if (key === "source") continue;
    const rawValue = record[key];
    if (rawValue === undefined) continue;
    if (typeof rawValue !== "string") return null;
    const value = rawValue.trim();
    if (!value || value.length > maxLength || CONTROL_CHARACTER_RE.test(value)) {
      return null;
    }
    if (key === "path" && !isSafeRelativePath(value)) return null;
    sanitized[key] = value;
  }
  return sanitized;
};

export const normalizeClaudeMarketplaceSource = (
  rawSource: string,
): ClaudeMarketplaceSource => {
  const source = rawSource.trim();
  const githubMatch = GITHUB_REPO_RE.exec(source);
  if (githubMatch) {
    const [, owner, repo] = githubMatch;
    return {
      cliSource: source,
      catalogUrl: `https://raw.githubusercontent.com/${owner}/${repo}/main/.claude-plugin/marketplace.json`,
    };
  }

  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new Error("Claude marketplace source must be owner/repo or an HTTPS marketplace URL");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Claude marketplace URL must use HTTPS without embedded credentials");
  }
  return { cliSource: url.toString(), catalogUrl: url.toString() };
};

export const parseClaudeMarketplaceCatalog = (
  input: unknown,
): ClaudeMarketplaceCatalog => {
  const catalog = asRecord(input);
  const name = typeof catalog?.name === "string" ? catalog.name.trim() : "";
  if (!MARKETPLACE_NAME_RE.test(name)) {
    throw new Error("Claude marketplace catalog has an invalid name");
  }
  if (!Array.isArray(catalog?.plugins)) {
    throw new Error("Claude marketplace catalog must contain a plugins array");
  }
  if (catalog.plugins.length > MAX_CATALOG_PLUGINS) {
    throw new Error(`Claude marketplace catalog cannot contain more than ${MAX_CATALOG_PLUGINS} plugins`);
  }

  const plugins: ClaudeMarketplacePlugin[] = [];
  const pluginIds = new Set<string>();
  for (const rawPlugin of catalog.plugins) {
    const plugin = asRecord(rawPlugin);
    if (!plugin) continue;
    const pluginName = typeof plugin.name === "string" ? plugin.name.trim() : "";
    const source = sanitizeClaudePluginSource(plugin.source);
    if (!PLUGIN_NAME_RE.test(pluginName) || !source) continue;
    if (pluginIds.has(pluginName)) {
      throw new Error(`Claude marketplace catalog contains duplicate plugin: ${pluginName}`);
    }
    pluginIds.add(pluginName);

    const description = typeof plugin.description === "string"
      ? plugin.description.trim().slice(0, 2_000) || null
      : null;
    const version = typeof plugin.version === "string"
      ? plugin.version.trim().slice(0, 100) || null
      : null;
    const category = typeof plugin.category === "string"
      ? plugin.category.trim().slice(0, 100) || null
      : null;
    const tags = Array.isArray(plugin.tags)
      ? plugin.tags
          .filter((tag): tag is string => typeof tag === "string")
          .map((tag) => tag.trim().slice(0, 64))
          .filter(Boolean)
          .slice(0, 20)
      : [];

    plugins.push({
      externalId: pluginName,
      name: pluginName,
      description,
      version,
      category,
      tags,
      source,
    });
  }

  const owner = asRecord(catalog.owner);
  return {
    name,
    ownerName: typeof owner?.name === "string" ? owner.name.trim() || null : null,
    plugins,
  };
};
