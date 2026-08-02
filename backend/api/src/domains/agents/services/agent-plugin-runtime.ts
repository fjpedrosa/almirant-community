import type { AgentPluginDb, PluginMarketplaceDb } from "@almirant/database";
import type {
  AgentRuntimePluginReference,
  UnsupportedAgentRuntimePluginReference,
} from "@almirant/shared";

const SHA256_RE = /^[a-f0-9]{64}$/i;
const MARKETPLACE_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const PLUGIN_EXTERNAL_ID_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const GITHUB_MARKETPLACE_SOURCE_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const unsupportedReference = (
  plugin: AgentPluginDb,
  diagnosticCode: UnsupportedAgentRuntimePluginReference["diagnosticCode"],
  diagnostic: string,
): UnsupportedAgentRuntimePluginReference => ({
  id: plugin.id,
  slug: plugin.slug,
  name: plugin.name,
  kind: "unsupported",
  provider: plugin.provider,
  sourceType:
    plugin.sourceType === "marketplace" ? "marketplace" : "upload",
  ...(plugin.version ? { version: plugin.version } : {}),
  diagnosticCode,
  diagnostic,
});

const manifestKind = (manifest: Record<string, unknown> | null): string | null =>
  typeof manifest?.kind === "string" ? manifest.kind : null;

const marketplaceCatalogName = (marketplace: PluginMarketplaceDb): string | null => {
  const catalog = marketplace.catalog;
  const name = typeof catalog?.name === "string" ? catalog.name.trim() : "";
  return MARKETPLACE_NAME_RE.test(name) ? name : null;
};

const normalizeMarketplaceSource = (rawSource: string): string | null => {
  const source = rawSource.trim();
  if (GITHUB_MARKETPLACE_SOURCE_RE.test(source)) return source;

  try {
    const url = new URL(source);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.toString().length > 2_048
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
};

/**
 * Converts selected persistence rows into the small, secret-free references
 * pinned into a job. Prompt-only rows deliberately produce no runtime entry.
 */
export const buildAgentRuntimePluginReferences = (
  plugins: AgentPluginDb[],
  marketplaces: PluginMarketplaceDb[] = [],
): AgentRuntimePluginReference[] => {
  const references: AgentRuntimePluginReference[] = [];
  const marketplacesById = new Map(
    marketplaces.map((marketplace) => [marketplace.id, marketplace]),
  );

  for (const plugin of plugins) {
    if (!plugin.enabled || plugin.archivedAt || plugin.sourceType === "instructions") {
      continue;
    }

    if (plugin.sourceType === "marketplace") {
      if (plugin.provider === "claude-code") {
        const marketplace = plugin.marketplaceId
          ? marketplacesById.get(plugin.marketplaceId)
          : undefined;
        const name = marketplace ? marketplaceCatalogName(marketplace) : null;
        const source = marketplace
          ? normalizeMarketplaceSource(marketplace.source)
          : null;
        const externalId = plugin.externalId?.trim() ?? "";

        if (
          !marketplace ||
          !marketplace.enabled ||
          marketplace.provider !== "claude-code" ||
          !name ||
          !source ||
          !PLUGIN_EXTERNAL_ID_RE.test(externalId)
        ) {
          references.push(
            unsupportedReference(
              plugin,
              "INVALID_PLUGIN_RUNTIME_CONFIGURATION",
              "Claude marketplace plugin is missing an enabled, validated marketplace source, catalog name, or plugin identifier.",
            ),
          );
          continue;
        }

        references.push({
          id: plugin.id,
          slug: plugin.slug,
          name: plugin.name,
          kind: "claude_marketplace",
          provider: "claude-code",
          sourceType: "marketplace",
          ...(plugin.version ? { version: plugin.version } : {}),
          externalId,
          marketplaceName: name,
          marketplaceSource: source,
          resolution: "mutable_catalog",
        });
      } else {
        references.push(
          unsupportedReference(
            plugin,
            "PROVIDER_MARKETPLACE_UNSUPPORTED",
            `Native ${plugin.provider} marketplace plugins are not supported by this runner. No cross-provider emulation is performed.`,
          ),
        );
      }
      continue;
    }

    if (plugin.sourceType === "upload") {
      const kind = manifestKind(plugin.manifest);
      if (kind === "claude_plugin" && plugin.provider === "claude-code") {
        const pluginName = plugin.externalId?.trim() ?? "";
        if (
          !plugin.storageObjectId ||
          !plugin.checksumSha256 ||
          !SHA256_RE.test(plugin.checksumSha256) ||
          !PLUGIN_EXTERNAL_ID_RE.test(pluginName)
        ) {
          references.push(
            unsupportedReference(
              plugin,
              "INVALID_PLUGIN_RUNTIME_CONFIGURATION",
              "Uploaded Claude plugin is missing a validated manifest, storage object, plugin name, or SHA-256 checksum.",
            ),
          );
          continue;
        }

        references.push({
          id: plugin.id,
          slug: plugin.slug,
          name: plugin.name,
          kind: "claude_upload",
          provider: "claude-code",
          sourceType: "upload",
          ...(plugin.version ? { version: plugin.version } : {}),
          pluginName,
          checksumSha256: plugin.checksumSha256.toLowerCase(),
        });
        continue;
      }

      if (plugin.provider !== "portable") {
        references.push(
          unsupportedReference(
            plugin,
            "NATIVE_PLUGIN_UPLOAD_UNSUPPORTED",
            "Uploaded provider-native plugins are not executed by this runner. Upload a portable Agent Skill bundle instead.",
          ),
        );
        continue;
      }

      if (
        kind !== "portable_skill" ||
        !plugin.storageObjectId ||
        !plugin.checksumSha256 ||
        !SHA256_RE.test(plugin.checksumSha256)
      ) {
        references.push(
          unsupportedReference(
            plugin,
            "INVALID_PLUGIN_RUNTIME_CONFIGURATION",
            "Portable plugin upload is missing a validated manifest, storage object, or SHA-256 checksum.",
          ),
        );
        continue;
      }

      references.push({
        id: plugin.id,
        slug: plugin.slug,
        name: plugin.name,
        kind: "portable_skill",
        provider: "portable",
        sourceType: "upload",
        ...(plugin.version ? { version: plugin.version } : {}),
        checksumSha256: plugin.checksumSha256.toLowerCase(),
      });
      continue;
    }

    references.push(
      unsupportedReference(
        plugin,
        "INVALID_PLUGIN_RUNTIME_CONFIGURATION",
        "Plugin has an unsupported runtime source type.",
      ),
    );
  }

  return references;
};
