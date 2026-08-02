import { createHash } from "node:crypto";
import type {
  AgentPluginDb,
  AgentPluginSourceType,
  NewAgentPlugin,
  NewPluginMarketplace,
  PluginMarketplaceDb,
  UserStorageObjectDb,
} from "@almirant/database";
import {
  validateAgentPluginBundleFiles,
  type AgentPluginBundleFile,
  type AgentPluginBundleValidationOptions,
  type ValidatedAgentPluginBundle,
} from "@almirant/shared";
import type {
  PutUserStorageObjectInput,
  UserStorageService,
} from "../../storage/services/user-storage-service";
import { decodePluginBundleZip } from "./plugin-bundle-archive";
import type {
  ClaudeMarketplaceCatalogLoadResult,
} from "./plugin-marketplace-loader";
import {
  parseClaudeMarketplaceCatalog,
  type ClaudeMarketplaceCatalog,
  type ClaudeMarketplacePlugin,
} from "./plugin-marketplace";

export const OFFICIAL_CLAUDE_MARKETPLACE_SLUG = "claude-plugins-official";
export const OFFICIAL_CLAUDE_MARKETPLACE_SOURCE =
  "anthropics/claude-plugins-official";
export const MAX_PRIVATE_PLUGIN_BUNDLE_BYTES = 25 * 1024 * 1024;
export const MAX_PRIVATE_PLUGIN_FILES = 200;
export const MAX_PRIVATE_PLUGIN_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
export const MAX_PRIVATE_PLUGIN_FILE_BYTES = 10 * 1024 * 1024;

export interface AgentPluginCatalogRepositoryPort {
  ensureMarketplace(input: NewPluginMarketplace): Promise<PluginMarketplaceDb>;
  listMarketplaces(
    workspaceId: string,
    ownerUserId: string,
  ): Promise<PluginMarketplaceDb[]>;
  createMarketplace(input: NewPluginMarketplace): Promise<PluginMarketplaceDb>;
  getMarketplace(
    id: string,
    workspaceId: string,
    ownerUserId: string | null,
  ): Promise<PluginMarketplaceDb | undefined>;
  updateMarketplaceCatalog(
    id: string,
    workspaceId: string,
    ownerUserId: string,
    input: {
      source: string;
      catalog: Record<string, unknown>;
      lastSyncedAt: Date;
    },
  ): Promise<PluginMarketplaceDb | undefined>;
  deleteMarketplace(
    id: string,
    workspaceId: string,
    ownerUserId: string,
  ): Promise<boolean>;
  findOwnedPluginVersion(input: {
    workspaceId: string;
    ownerUserId: string;
    checksumSha256: string;
    sourceType?: AgentPluginSourceType;
  }): Promise<AgentPluginDb | undefined>;
  findOwnedMarketplacePluginVersion(input: {
    workspaceId: string;
    ownerUserId: string;
    marketplaceId: string;
    externalId: string;
    configurationSha256: string;
  }): Promise<AgentPluginDb | undefined>;
  createPluginVersion(input: NewAgentPlugin): Promise<AgentPluginDb>;
  listOwnedPackagePlugins(
    workspaceId: string,
    ownerUserId: string,
  ): Promise<AgentPluginDb[]>;
}

export type AgentPluginStoragePort = Pick<UserStorageService, "put" | "remove">;

export interface AgentPluginCatalogServiceDependencies {
  repository: AgentPluginCatalogRepositoryPort;
  storage: AgentPluginStoragePort;
  loadCatalog: (source: string) => Promise<ClaudeMarketplaceCatalogLoadResult>;
  decodeArchive?: (
    bytes: Uint8Array,
    options?: {
      maxArchiveBytes?: number;
      maxFiles?: number;
      maxTotalBytes?: number;
      maxFileBytes?: number;
    },
  ) => AgentPluginBundleFile[];
  validateBundle?: (
    files: AgentPluginBundleFile[],
    options?: AgentPluginBundleValidationOptions,
  ) => ValidatedAgentPluginBundle;
}

export interface AddPluginMarketplaceInput {
  workspaceId: string;
  ownerUserId: string;
  source: string;
  name?: string | null;
}

export interface InstallMarketplacePluginInput {
  workspaceId: string;
  ownerUserId: string;
  marketplaceId: string;
  externalId: string;
}

export interface UploadPrivatePluginBundleInput {
  workspaceId: string;
  ownerUserId: string;
  fileName: string;
  bytes: Uint8Array;
  name?: string | null;
  description?: string | null;
}

export class AgentPluginCatalogError extends Error {
  constructor(
    message: string,
    readonly code:
      | "PLUGIN_MARKETPLACE_NOT_FOUND"
      | "PLUGIN_ENTRY_NOT_FOUND"
      | "BUILT_IN_MARKETPLACE"
      | "INVALID_PLUGIN_BUNDLE",
  ) {
    super(message);
    this.name = "AgentPluginCatalogError";
  }
}

const PLUGIN_BUNDLE_LIMITS = {
  maxArchiveBytes: MAX_PRIVATE_PLUGIN_BUNDLE_BYTES,
  maxFiles: MAX_PRIVATE_PLUGIN_FILES,
  maxTotalBytes: MAX_PRIVATE_PLUGIN_UNCOMPRESSED_BYTES,
  maxFileBytes: MAX_PRIVATE_PLUGIN_FILE_BYTES,
};

const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");

const stableJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
};

const slugify = (value: string, maxLength = 64): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength);

const immutablePluginSlug = (name: string, checksum: string): string => {
  const suffix = checksum.slice(0, 8);
  const base = slugify(name, 64 - suffix.length - 1) || "plugin";
  return `${base}-${suffix}`;
};

const normalizeDisplayName = (value: string | null | undefined): string => {
  const name = (value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 255);
  if (!name) {
    throw new AgentPluginCatalogError(
      "Plugin name is required",
      "INVALID_PLUGIN_BUNDLE",
    );
  }
  return name;
};

const sanitizeUploadFileName = (value: string): string => {
  const leaf = value.split(/[\\/]/).at(-1)?.trim() || "plugin.zip";
  const name = leaf
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 180);
  return name || "plugin.zip";
};

const serializeCatalog = (
  catalog: ClaudeMarketplaceCatalog,
): Record<string, unknown> => ({
  name: catalog.name,
  ownerName: catalog.ownerName,
  plugins: catalog.plugins.map((plugin) => ({ ...plugin })),
});

const parseCachedCatalog = (
  cached: Record<string, unknown> | null,
): ClaudeMarketplaceCatalog => {
  if (!cached) {
    throw new AgentPluginCatalogError(
      "Plugin marketplace must be synced before installing an entry",
      "PLUGIN_ENTRY_NOT_FOUND",
    );
  }
  const ownerName = typeof cached.ownerName === "string" ? cached.ownerName : null;
  try {
    return parseClaudeMarketplaceCatalog({
      name: cached.name,
      owner: ownerName ? { name: ownerName } : undefined,
      plugins: cached.plugins,
    });
  } catch {
    throw new AgentPluginCatalogError(
      "Cached plugin marketplace catalog is invalid; sync it again",
      "PLUGIN_ENTRY_NOT_FOUND",
    );
  }
};

const readSourceVersion = (entry: ClaudeMarketplacePlugin, checksum: string): string => {
  if (entry.version) return entry.version;
  if (typeof entry.source === "object") {
    if (entry.source.sha) return entry.source.sha.slice(0, 100);
    if (entry.source.ref) return entry.source.ref.slice(0, 100);
    if (entry.source.version) return entry.source.version.slice(0, 100);
  }
  return checksum.slice(0, 12);
};

const stripSingleArchiveRoot = (
  files: AgentPluginBundleFile[],
): AgentPluginBundleFile[] | null => {
  const firstSegments = files.map((file) => file.path.split("/"));
  if (
    firstSegments.length === 0 ||
    firstSegments.some((segments) => segments.length < 2) ||
    new Set(firstSegments.map((segments) => segments[0])).size !== 1
  ) {
    return null;
  }
  return files.map((file) => ({
    path: file.path.split("/").slice(1).join("/"),
    content: file.content,
  }));
};

const validateDecodedBundle = (
  files: AgentPluginBundleFile[],
  validateBundle: NonNullable<AgentPluginCatalogServiceDependencies["validateBundle"]>,
): ValidatedAgentPluginBundle => {
  try {
    return validateBundle(files, PLUGIN_BUNDLE_LIMITS);
  } catch (originalError) {
    const stripped = stripSingleArchiveRoot(files);
    if (!stripped) throw originalError;
    return validateBundle(stripped, PLUGIN_BUNDLE_LIMITS);
  }
};

const officialMarketplaceInput = (workspaceId: string): NewPluginMarketplace => ({
  workspaceId,
  name: "Claude Plugins Official",
  slug: OFFICIAL_CLAUDE_MARKETPLACE_SLUG,
  provider: "claude-code",
  source: OFFICIAL_CLAUDE_MARKETPLACE_SOURCE,
  sourceType: "github",
  catalog: null,
  enabled: true,
  ownerUserId: null,
  createdByUserId: null,
});

export const createAgentPluginCatalogService = ({
  repository,
  storage,
  loadCatalog,
  decodeArchive = decodePluginBundleZip,
  validateBundle = validateAgentPluginBundleFiles,
}: AgentPluginCatalogServiceDependencies) => {
  const ensureOfficialMarketplace = (workspaceId: string) =>
    repository.ensureMarketplace(officialMarketplaceInput(workspaceId));

  const getMarketplace = async (
    workspaceId: string,
    ownerUserId: string,
    marketplaceId: string,
  ): Promise<PluginMarketplaceDb> => {
    const marketplace = await repository.getMarketplace(
      marketplaceId,
      workspaceId,
      ownerUserId,
    );
    if (!marketplace) {
      throw new AgentPluginCatalogError(
        "Plugin marketplace not found",
        "PLUGIN_MARKETPLACE_NOT_FOUND",
      );
    }
    return marketplace;
  };

  return {
    listMarketplaces: async (
      workspaceId: string,
      ownerUserId: string,
    ): Promise<PluginMarketplaceDb[]> => {
      await ensureOfficialMarketplace(workspaceId);
      return repository.listMarketplaces(workspaceId, ownerUserId);
    },

    addMarketplace: async (
      input: AddPluginMarketplaceInput,
    ): Promise<PluginMarketplaceDb> => {
      await ensureOfficialMarketplace(input.workspaceId);
      const loaded = await loadCatalog(input.source);
      const slug = slugify(loaded.catalog.name);
      if (
        slug === OFFICIAL_CLAUDE_MARKETPLACE_SLUG ||
        loaded.source.cliSource === OFFICIAL_CLAUDE_MARKETPLACE_SOURCE
      ) {
        throw new AgentPluginCatalogError(
          "The official Claude marketplace is built-in",
          "BUILT_IN_MARKETPLACE",
        );
      }
      if (!slug) {
        throw new Error("Marketplace catalog name cannot be converted to a slug");
      }

      return repository.createMarketplace({
        workspaceId: input.workspaceId,
        name: normalizeDisplayName(input.name ?? loaded.catalog.ownerName ?? loaded.catalog.name),
        slug,
        provider: "claude-code",
        source: loaded.source.cliSource,
        sourceType: loaded.source.cliSource.includes("://") ? "url" : "github",
        catalog: serializeCatalog(loaded.catalog),
        enabled: true,
        lastSyncedAt: new Date(),
        ownerUserId: input.ownerUserId,
        createdByUserId: input.ownerUserId,
      });
    },

    syncMarketplace: async (
      workspaceId: string,
      ownerUserId: string,
      marketplaceId: string,
    ): Promise<PluginMarketplaceDb> => {
      const marketplace = await getMarketplace(
        workspaceId,
        ownerUserId,
        marketplaceId,
      );
      if (marketplace.provider !== "claude-code") {
        throw new Error("Only Claude Code marketplace sources are supported");
      }
      const loaded = await loadCatalog(marketplace.source);
      const updated = await repository.updateMarketplaceCatalog(
        marketplace.id,
        workspaceId,
        ownerUserId,
        {
          source: loaded.source.cliSource,
          catalog: serializeCatalog(loaded.catalog),
          lastSyncedAt: new Date(),
        },
      );
      if (!updated) {
        throw new AgentPluginCatalogError(
          "Plugin marketplace not found",
          "PLUGIN_MARKETPLACE_NOT_FOUND",
        );
      }
      return updated;
    },

    removeMarketplace: async (
      workspaceId: string,
      ownerUserId: string,
      marketplaceId: string,
    ): Promise<boolean> => {
      const marketplace = await getMarketplace(
        workspaceId,
        ownerUserId,
        marketplaceId,
      );
      if (marketplace.slug === OFFICIAL_CLAUDE_MARKETPLACE_SLUG) {
        throw new AgentPluginCatalogError(
          "The built-in Claude marketplace cannot be removed",
          "BUILT_IN_MARKETPLACE",
        );
      }
      return repository.deleteMarketplace(
        marketplace.id,
        workspaceId,
        ownerUserId,
      );
    },

    installMarketplacePlugin: async (
      input: InstallMarketplacePluginInput,
    ): Promise<AgentPluginDb> => {
      const marketplace = await getMarketplace(
        input.workspaceId,
        input.ownerUserId,
        input.marketplaceId,
      );
      if (marketplace.provider !== "claude-code") {
        throw new Error("Only Claude Code marketplace plugins can be installed");
      }
      const catalog = parseCachedCatalog(marketplace.catalog);
      const entry = catalog.plugins.find(
        (plugin) => plugin.externalId === input.externalId,
      );
      if (!entry) {
        throw new AgentPluginCatalogError(
          "Plugin entry not found in cached marketplace catalog",
          "PLUGIN_ENTRY_NOT_FOUND",
        );
      }

      const frozenConfiguration = {
        marketplace: {
          name: catalog.name,
          slug: marketplace.slug,
          source: marketplace.source,
          sourceType: marketplace.sourceType,
        },
        entry: { ...entry },
      };
      const configurationSha256 = sha256(stableJson(frozenConfiguration));
      const manifest: Record<string, unknown> = {
        schemaVersion: 1,
        kind: "claude_marketplace_plugin",
        provider: "claude-code",
        resolution: "mutable_catalog",
        configurationSha256,
        ...frozenConfiguration,
      };
      const existing = await repository.findOwnedMarketplacePluginVersion({
        workspaceId: input.workspaceId,
        ownerUserId: input.ownerUserId,
        marketplaceId: marketplace.id,
        externalId: entry.externalId,
        configurationSha256,
      });
      if (existing) return existing;

      return repository.createPluginVersion({
        workspaceId: input.workspaceId,
        name: entry.name,
        slug: immutablePluginSlug(entry.name, configurationSha256),
        description: entry.description,
        instructions: "",
        ownerUserId: input.ownerUserId,
        visibility: "user",
        provider: "claude-code",
        sourceType: "marketplace",
        marketplaceId: marketplace.id,
        externalId: entry.externalId,
        sourceReference: `${entry.externalId}@${catalog.name}`,
        version: readSourceVersion(entry, configurationSha256),
        // This is a mutable marketplace resolution, not downloaded package content.
        checksumSha256: null,
        storageObjectId: null,
        manifest,
        enabled: true,
        createdByUserId: input.ownerUserId,
      });
    },

    uploadPrivateBundle: async (
      input: UploadPrivatePluginBundleInput,
    ): Promise<AgentPluginDb> => {
      if (!input.fileName.toLowerCase().endsWith(".zip")) {
        throw new AgentPluginCatalogError(
          "Private plugin bundle must be a ZIP file",
          "INVALID_PLUGIN_BUNDLE",
        );
      }
      if (input.bytes.byteLength > MAX_PRIVATE_PLUGIN_BUNDLE_BYTES) {
        throw new AgentPluginCatalogError(
          "Private plugin ZIP cannot exceed 25 MiB",
          "INVALID_PLUGIN_BUNDLE",
        );
      }

      const archiveChecksumSha256 = sha256(input.bytes);

      let validated: ValidatedAgentPluginBundle;
      try {
        const files = decodeArchive(input.bytes, PLUGIN_BUNDLE_LIMITS);
        validated = validateDecodedBundle(files, validateBundle);
      } catch (error) {
        if (error instanceof AgentPluginCatalogError) throw error;
        throw new AgentPluginCatalogError(
          error instanceof Error ? error.message : "Private plugin ZIP is invalid",
          "INVALID_PLUGIN_BUNDLE",
        );
      }

      const fallbackName = sanitizeUploadFileName(input.fileName).replace(/\.zip$/i, "");
      const name = normalizeDisplayName(
        input.name ?? validated.pluginName ?? fallbackName ?? "Private plugin",
      );
      const provider = validated.kind === "claude_plugin" ? "claude-code" : "portable";
      const descriptorBytes = new TextEncoder().encode(
        JSON.stringify({
          schemaVersion: 1,
          kind: validated.kind,
          files: validated.files.map((file) => ({
            type: "file",
            path: file.path,
            contentBase64: Buffer.from(file.content).toString("base64"),
          })),
        }),
      );
      const checksumSha256 = sha256(descriptorBytes);
      const existing = await repository.findOwnedPluginVersion({
        workspaceId: input.workspaceId,
        ownerUserId: input.ownerUserId,
        checksumSha256,
        sourceType: "upload",
      });
      if (existing?.storageObjectId) return existing;
      const slug = immutablePluginSlug(validated.pluginName ?? name, checksumSha256);
      const fileName = `${slug}.bundle.json`;
      const storageInput: PutUserStorageObjectInput = {
        ownerUserId: input.ownerUserId,
        workspaceId: input.workspaceId,
        virtualPath: `plugins/${checksumSha256}/${fileName}`,
        fileName,
        contentType: "application/vnd.almirant.agent-plugin+json",
        bytes: descriptorBytes,
        kind: "plugin_bundle",
        metadata: {
          schemaVersion: 1,
          archiveChecksumSha256,
          bundleKind: validated.kind,
          providers: validated.providers,
          pluginName: validated.pluginName,
          version: validated.version,
          fileCount: validated.files.length,
          totalBytes: validated.totalBytes,
        },
      };
      const stored: UserStorageObjectDb = await storage.put(storageInput);

      try {
        if (stored.checksumSha256 !== checksumSha256) {
          throw new Error("Stored plugin bundle checksum does not match upload");
        }
        const manifest: Record<string, unknown> = {
          schemaVersion: 1,
          kind: validated.kind,
          providers: validated.providers,
          pluginName: validated.pluginName,
          version: validated.version,
          skillRoots: validated.skillRoots,
          fileCount: validated.files.length,
          totalBytes: validated.totalBytes,
        };
        return await repository.createPluginVersion({
          workspaceId: input.workspaceId,
          name,
          slug,
          description: input.description?.trim().slice(0, 2_000) || null,
          instructions: "",
          ownerUserId: input.ownerUserId,
          visibility: "user",
          provider,
          sourceType: "upload",
          marketplaceId: null,
          externalId: validated.pluginName,
          sourceReference: `user-storage:${stored.id}`,
          version: validated.version ?? checksumSha256.slice(0, 12),
          checksumSha256,
          storageObjectId: stored.id,
          manifest,
          enabled: true,
          createdByUserId: input.ownerUserId,
        });
      } catch (error) {
        await storage.remove(input.ownerUserId, stored.id).catch(() => undefined);
        throw error;
      }
    },

    listOwnedPackagePlugins: (workspaceId: string, ownerUserId: string) =>
      repository.listOwnedPackagePlugins(workspaceId, ownerUserId),
  };
};

export type AgentPluginCatalogService = ReturnType<
  typeof createAgentPluginCatalogService
>;
