import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import type {
  AgentPluginDb,
  NewAgentPlugin,
  NewPluginMarketplace,
  PluginMarketplaceDb,
  UserStorageObjectDb,
} from "@almirant/database";
import type {
  AgentPluginBundleFile,
  ValidatedAgentPluginBundle,
} from "@almirant/shared";
import {
  MAX_PRIVATE_PLUGIN_BUNDLE_BYTES,
  OFFICIAL_CLAUDE_MARKETPLACE_SLUG,
  createAgentPluginCatalogService,
  type AgentPluginCatalogRepositoryPort,
  type AgentPluginStoragePort,
} from "./agent-plugin-catalog-service";
import type { ClaudeMarketplaceCatalogLoadResult } from "./plugin-marketplace-loader";

const workspaceId = "workspace-1";
const userId = "user-1";

const makeMarketplace = (
  overrides: Partial<PluginMarketplaceDb> = {},
): PluginMarketplaceDb => ({
  id: "7cff4ec7-32a8-4e92-91f1-2748fe4551a4",
  workspaceId,
  name: "Acme Plugins",
  slug: "acme-plugins",
  provider: "claude-code",
  source: "acme/plugins",
  sourceType: "github",
  catalog: null,
  enabled: true,
  lastSyncedAt: null,
  ownerUserId: userId,
  createdByUserId: userId,
  createdAt: new Date("2026-07-10T10:00:00.000Z"),
  updatedAt: new Date("2026-07-10T10:00:00.000Z"),
  ...overrides,
});

const makePlugin = (
  overrides: Partial<AgentPluginDb> = {},
): AgentPluginDb => ({
  id: "027dc265-8ea3-491d-a893-c11eb523fd53",
  workspaceId,
  name: "review",
  slug: "review-aabbccdd",
  description: "Reviews code",
  instructions: "",
  ownerUserId: userId,
  visibility: "user",
  provider: "claude-code",
  sourceType: "marketplace",
  marketplaceId: "7cff4ec7-32a8-4e92-91f1-2748fe4551a4",
  externalId: "review",
  sourceReference: "review@acme-plugins",
  version: "1.0.0",
  checksumSha256: "a".repeat(64),
  storageObjectId: null,
  manifest: {},
  enabled: true,
  archivedAt: null,
  createdByUserId: userId,
  createdAt: new Date("2026-07-10T10:00:00.000Z"),
  updatedAt: new Date("2026-07-10T10:00:00.000Z"),
  ...overrides,
});

const makeStorageObject = (
  overrides: Partial<UserStorageObjectDb> = {},
): UserStorageObjectDb => ({
  id: "1b937514-da03-44e8-a1e8-f088d9d067a0",
  ownerUserId: userId,
  workspaceId,
  objectKey: "user-storage/opaque/bundle.zip",
  virtualPath: "plugins/checksum/review.zip",
  fileName: "review.zip",
  contentType: "application/zip",
  sizeBytes: 4,
  checksumSha256: "9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a",
  kind: "plugin_bundle",
  status: "ready",
  metadata: {},
  reservationExpiresAt: null,
  createdAt: new Date("2026-07-10T10:00:00.000Z"),
  updatedAt: new Date("2026-07-10T10:00:00.000Z"),
  ...overrides,
});

const loadedCatalog = (): ClaudeMarketplaceCatalogLoadResult => ({
  source: {
    cliSource: "acme/plugins",
    catalogUrl:
      "https://raw.githubusercontent.com/acme/plugins/main/.claude-plugin/marketplace.json",
  },
  catalog: {
    name: "acme-plugins",
    ownerName: "Acme",
    plugins: [
      {
        externalId: "review",
        name: "review",
        description: "Reviews code",
        version: "1.0.0",
        category: "quality",
        tags: ["review"],
        source: "./plugins/review",
      },
    ],
  },
});

const portableBundle = (): ValidatedAgentPluginBundle => ({
  kind: "portable_skill",
  providers: ["claude-code", "codex", "opencode"],
  files: [{ path: "SKILL.md", content: new TextEncoder().encode("# Review") }],
  totalBytes: 8,
  skillRoots: [""],
  pluginName: null,
  version: null,
});

const createHarness = (
  validatedBundle: ValidatedAgentPluginBundle = portableBundle(),
) => {
  const marketplaces: PluginMarketplaceDb[] = [];
  const plugins: AgentPluginDb[] = [];
  const repository: AgentPluginCatalogRepositoryPort = {
    ensureMarketplace: mock(async (input: NewPluginMarketplace) => {
      const existing = marketplaces.find((row) => row.slug === input.slug);
      if (existing) return existing;
      const row = makeMarketplace({
        ...input,
        id: crypto.randomUUID(),
        catalog: input.catalog ?? null,
        lastSyncedAt: input.lastSyncedAt ?? null,
        ownerUserId: input.ownerUserId ?? null,
        createdByUserId: input.createdByUserId ?? null,
      });
      marketplaces.push(row);
      return row;
    }),
    listMarketplaces: mock(async (_workspaceId, ownerUserId) =>
      marketplaces.filter(
        (row) => row.ownerUserId === null || row.ownerUserId === ownerUserId,
      ),
    ),
    createMarketplace: mock(async (input: NewPluginMarketplace) => {
      const row = makeMarketplace({
        ...input,
        id: crypto.randomUUID(),
        catalog: input.catalog ?? null,
        lastSyncedAt: input.lastSyncedAt ?? null,
        ownerUserId: input.ownerUserId ?? null,
        createdByUserId: input.createdByUserId ?? null,
      });
      marketplaces.push(row);
      return row;
    }),
    getMarketplace: mock(async (id: string, _workspaceId, ownerUserId) =>
      marketplaces.find(
        (row) =>
          row.id === id &&
          (row.ownerUserId === null || row.ownerUserId === ownerUserId),
      ),
    ),
    updateMarketplaceCatalog: mock(async (id, _workspaceId, _ownerUserId, input) => {
      const row = marketplaces.find((candidate) => candidate.id === id);
      if (!row) return undefined;
      Object.assign(row, input, { updatedAt: new Date() });
      return row;
    }),
    deleteMarketplace: mock(async (id: string, _workspaceId, ownerUserId) => {
      const index = marketplaces.findIndex(
        (row) => row.id === id && row.ownerUserId === ownerUserId,
      );
      if (index < 0) return false;
      marketplaces.splice(index, 1);
      return true;
    }),
    findOwnedPluginVersion: mock(async (input) =>
      plugins.find(
        (plugin) =>
          plugin.workspaceId === input.workspaceId &&
          plugin.ownerUserId === input.ownerUserId &&
          plugin.checksumSha256 === input.checksumSha256 &&
          (input.sourceType === undefined || plugin.sourceType === input.sourceType),
      ),
    ),
    findOwnedMarketplacePluginVersion: mock(async (input) =>
      plugins.find(
        (plugin) =>
          plugin.workspaceId === input.workspaceId &&
          plugin.ownerUserId === input.ownerUserId &&
          plugin.marketplaceId === input.marketplaceId &&
          plugin.externalId === input.externalId &&
          (plugin.manifest as { configurationSha256?: string } | null)
            ?.configurationSha256 === input.configurationSha256,
      ),
    ),
    createPluginVersion: mock(async (input: NewAgentPlugin) => {
      const row = makePlugin({
        ...input,
        id: crypto.randomUUID(),
        description: input.description ?? null,
        ownerUserId: input.ownerUserId ?? null,
        marketplaceId: input.marketplaceId ?? null,
        externalId: input.externalId ?? null,
        sourceReference: input.sourceReference ?? null,
        version: input.version ?? null,
        checksumSha256: input.checksumSha256 ?? null,
        storageObjectId: input.storageObjectId ?? null,
        manifest: input.manifest ?? null,
        archivedAt: input.archivedAt ?? null,
        createdByUserId: input.createdByUserId ?? null,
      });
      plugins.push(row);
      return row;
    }),
    listOwnedPackagePlugins: mock(async () => plugins),
  };
  const storageObjects: UserStorageObjectDb[] = [];
  const storage: AgentPluginStoragePort = {
    put: mock(async (input) => {
      const object = makeStorageObject({
        id: crypto.randomUUID(),
        ownerUserId: input.ownerUserId,
        workspaceId: input.workspaceId,
        virtualPath: input.virtualPath,
        fileName: input.fileName,
        contentType: input.contentType,
        sizeBytes: input.bytes.byteLength,
        checksumSha256: createHash("sha256").update(input.bytes).digest("hex"),
        kind: input.kind,
        metadata: input.metadata ?? {},
      });
      storageObjects.push(object);
      return object;
    }),
    remove: mock(async (_ownerUserId, objectId) => {
      const index = storageObjects.findIndex((object) => object.id === objectId);
      if (index < 0) return false;
      storageObjects.splice(index, 1);
      return true;
    }),
  };
  const loadCatalog = mock(async () => loadedCatalog());
  const decodeArchive = mock(
    (_bytes: Uint8Array): AgentPluginBundleFile[] => [
      { path: "SKILL.md", content: new TextEncoder().encode("# Review") },
    ],
  );
  const validateBundle = mock(() => validatedBundle);
  const service = createAgentPluginCatalogService({
    repository,
    storage,
    loadCatalog,
    decodeArchive,
    validateBundle,
  });

  return {
    service,
    repository,
    storage,
    loadCatalog,
    decodeArchive,
    validateBundle,
    marketplaces,
    plugins,
    storageObjects,
  };
};

describe("agent plugin catalog service", () => {
  beforeEach(() => {
    mock.restore();
  });

  it("always exposes a workspace-scoped built-in official Claude marketplace", async () => {
    const harness = createHarness();

    const rows = await harness.service.listMarketplaces(workspaceId, userId);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      slug: OFFICIAL_CLAUDE_MARKETPLACE_SLUG,
      provider: "claude-code",
      source: "anthropics/claude-plugins-official",
      ownerUserId: null,
      createdByUserId: null,
    });
  });

  it("validates a custom source before caching only the sanitized catalog", async () => {
    const harness = createHarness();

    const created = await harness.service.addMarketplace({
      workspaceId,
      ownerUserId: userId,
      source: "acme/plugins",
      name: "Acme Catalog",
    });

    expect(harness.loadCatalog).toHaveBeenCalledWith("acme/plugins");
    expect(created).toMatchObject({
      name: "Acme Catalog",
      slug: "acme-plugins",
      provider: "claude-code",
      sourceType: "github",
      createdByUserId: userId,
    });
    expect(created.catalog).toEqual({ ...loadedCatalog().catalog });
  });

  it("syncs custom and official sources but never removes the built-in source", async () => {
    const harness = createHarness();
    const [official] = await harness.service.listMarketplaces(workspaceId, userId);
    const custom = await harness.service.addMarketplace({
      workspaceId,
      ownerUserId: userId,
      source: "acme/plugins",
    });

    expect((await harness.service.syncMarketplace(workspaceId, userId, custom.id)).catalog)
      .toEqual({ ...loadedCatalog().catalog });
    expect((await harness.service.syncMarketplace(workspaceId, userId, official!.id)).catalog)
      .toEqual({ ...loadedCatalog().catalog });
    await expect(
      harness.service.removeMarketplace(workspaceId, userId, official!.id),
    ).rejects.toThrow("built-in");
    expect(await harness.service.removeMarketplace(workspaceId, userId, custom.id)).toBe(true);
  });

  it("installs a cached entry as immutable, user-owned Claude metadata", async () => {
    const harness = createHarness();
    const marketplace = await harness.service.addMarketplace({
      workspaceId,
      ownerUserId: userId,
      source: "acme/plugins",
    });

    const installed = await harness.service.installMarketplacePlugin({
      workspaceId,
      ownerUserId: userId,
      marketplaceId: marketplace.id,
      externalId: "review",
    });
    const repeated = await harness.service.installMarketplacePlugin({
      workspaceId,
      ownerUserId: userId,
      marketplaceId: marketplace.id,
      externalId: "review",
    });

    expect(installed).toMatchObject({
      ownerUserId: userId,
      visibility: "user",
      provider: "claude-code",
      sourceType: "marketplace",
      marketplaceId: marketplace.id,
      externalId: "review",
      version: "1.0.0",
      instructions: "",
    });
    expect(installed.checksumSha256).toBeNull();
    expect(installed.manifest).toMatchObject({
      kind: "claude_marketplace_plugin",
      provider: "claude-code",
      resolution: "mutable_catalog",
    });
    expect(
      (installed.manifest as { configurationSha256: string }).configurationSha256,
    ).toMatch(/^[a-f0-9]{64}$/);
    expect(repeated.id).toBe(installed.id);
    expect(harness.repository.createPluginVersion).toHaveBeenCalledTimes(1);
  });

  it("stores a validated canonical descriptor in user storage and creates a portable package version", async () => {
    const harness = createHarness();
    const bytes = new Uint8Array([1, 2, 3, 4]);

    const plugin = await harness.service.uploadPrivateBundle({
      workspaceId,
      ownerUserId: userId,
      fileName: "My Review.zip",
      name: "My Review",
      description: "Private review workflow",
      bytes,
    });

    expect(harness.decodeArchive).toHaveBeenCalledWith(bytes, expect.any(Object));
    expect(harness.validateBundle).toHaveBeenCalledTimes(1);
    expect(harness.storage.put).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: userId,
        workspaceId,
        contentType: "application/vnd.almirant.agent-plugin+json",
        kind: "plugin_bundle",
      }),
    );
    const storedInput = (harness.storage.put as ReturnType<typeof mock>).mock
      .calls[0]![0] as { bytes: Uint8Array; metadata: Record<string, unknown> };
    expect(JSON.parse(new TextDecoder().decode(storedInput.bytes))).toEqual({
      schemaVersion: 1,
      kind: "portable_skill",
      files: [
        {
          type: "file",
          path: "SKILL.md",
          contentBase64: Buffer.from("# Review").toString("base64"),
        },
      ],
    });
    expect(storedInput.metadata.archiveChecksumSha256).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
    expect(plugin).toMatchObject({
      ownerUserId: userId,
      visibility: "user",
      provider: "portable",
      sourceType: "upload",
      description: "Private review workflow",
      instructions: "",
    });
    expect(plugin.storageObjectId).toBe(harness.storageObjects[0]!.id);
    expect(plugin.checksumSha256).toBe(harness.storageObjects[0]!.checksumSha256);
    expect(plugin.manifest).toMatchObject({
      kind: "portable_skill",
      providers: ["claude-code", "codex", "opencode"],
      fileCount: 1,
    });
  });

  it("cleans up the user-storage object if plugin metadata persistence fails", async () => {
    const harness = createHarness();
    harness.repository.createPluginVersion = mock(async () => {
      throw new Error("database unavailable");
    });

    await expect(
      harness.service.uploadPrivateBundle({
        workspaceId,
        ownerUserId: userId,
        fileName: "review.zip",
        bytes: new Uint8Array([1, 2, 3, 4]),
      }),
    ).rejects.toThrow("database unavailable");

    expect(harness.storage.remove).toHaveBeenCalledTimes(1);
    expect(harness.storageObjects).toHaveLength(0);
  });

  it("creates an executable user-owned Claude package for a native plugin upload", async () => {
    const harness = createHarness({
      kind: "claude_plugin",
      providers: ["claude-code"],
      files: [
        {
          path: ".claude-plugin/plugin.json",
          content: new TextEncoder().encode(
            JSON.stringify({ name: "native-review", version: "1.0.0" }),
          ),
        },
      ],
      totalBytes: 50,
      skillRoots: [],
      pluginName: "native-review",
      version: "1.0.0",
    });

    const plugin = await harness.service.uploadPrivateBundle({
      workspaceId,
      ownerUserId: userId,
      fileName: "native-review.zip",
      bytes: new Uint8Array([1, 2, 3, 4]),
    });

    expect(plugin).toMatchObject({
      ownerUserId: userId,
      provider: "claude-code",
      sourceType: "upload",
      externalId: "native-review",
      version: "1.0.0",
      manifest: { kind: "claude_plugin" },
    });
    expect(plugin.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects compressed uploads larger than 25 MiB before decoding or storage", async () => {
    const harness = createHarness();

    await expect(
      harness.service.uploadPrivateBundle({
        workspaceId,
        ownerUserId: userId,
        fileName: "too-large.zip",
        bytes: new Uint8Array(MAX_PRIVATE_PLUGIN_BUNDLE_BYTES + 1),
      }),
    ).rejects.toThrow("25 MiB");

    expect(harness.decodeArchive).not.toHaveBeenCalled();
    expect(harness.storage.put).not.toHaveBeenCalled();
  });
});
