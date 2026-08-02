import { describe, expect, it } from "bun:test";
import type { AgentPluginDb, PluginMarketplaceDb } from "@almirant/database";
import { buildAgentRuntimePluginReferences } from "./agent-plugin-runtime";

const plugin = (
  overrides: Partial<AgentPluginDb> = {},
): AgentPluginDb => ({
  id: "plugin-1",
  workspaceId: "workspace-1",
  name: "Private review",
  slug: "private-review",
  description: null,
  instructions: "Use the private review workflow.",
  ownerUserId: "user-1",
  visibility: "user",
  provider: "portable",
  sourceType: "upload",
  marketplaceId: null,
  externalId: null,
  sourceReference: null,
  version: "1.2.3",
  checksumSha256: "a".repeat(64),
  storageObjectId: "storage-1",
  manifest: { kind: "portable_skill", schemaVersion: 1 },
  enabled: true,
  archivedAt: null,
  createdByUserId: "user-1",
  createdAt: new Date("2026-07-10T10:00:00.000Z"),
  updatedAt: new Date("2026-07-10T10:00:00.000Z"),
  ...overrides,
});

const marketplace = (
  overrides: Partial<PluginMarketplaceDb> = {},
): PluginMarketplaceDb => ({
  id: "marketplace-1",
  workspaceId: "workspace-1",
  name: "Official Claude plugins",
  slug: "claude-official",
  provider: "claude-code",
  source: "anthropics/claude-plugins-official",
  sourceType: "github",
  catalog: { name: "claude-plugins-official" },
  enabled: true,
  lastSyncedAt: new Date("2026-07-10T09:00:00.000Z"),
  ownerUserId: null,
  createdByUserId: "user-1",
  createdAt: new Date("2026-07-10T09:00:00.000Z"),
  updatedAt: new Date("2026-07-10T09:00:00.000Z"),
  ...overrides,
});

describe("buildAgentRuntimePluginReferences", () => {
  it("keeps legacy instruction-only plugins out of runtime materialization", () => {
    expect(
      buildAgentRuntimePluginReferences([
        plugin({
          sourceType: "instructions",
          storageObjectId: null,
          checksumSha256: null,
          manifest: null,
        }),
      ]),
    ).toEqual([]);
  });

  it("pins portable uploads by id and checksum without leaking source data", () => {
    const [reference] = buildAgentRuntimePluginReferences([
      plugin({ sourceReference: "https://example.test/path?token=do-not-copy" }),
    ]);

    expect(reference).toEqual({
      id: "plugin-1",
      slug: "private-review",
      name: "Private review",
      kind: "portable_skill",
      provider: "portable",
      sourceType: "upload",
      version: "1.2.3",
      checksumSha256: "a".repeat(64),
    });
    expect(reference).not.toHaveProperty("sourceReference");
  });

  it("builds a deterministic native Claude marketplace bootstrap reference", () => {
    expect(
      buildAgentRuntimePluginReferences([
        plugin({
          provider: "claude-code",
          sourceType: "marketplace",
          marketplaceId: "marketplace-1",
          externalId: "security-review",
          storageObjectId: null,
          checksumSha256: null,
          manifest: null,
        }),
      ], [marketplace()]),
    ).toEqual([
      {
        id: "plugin-1",
        slug: "private-review",
        name: "Private review",
        kind: "claude_marketplace",
        provider: "claude-code",
        sourceType: "marketplace",
        version: "1.2.3",
        externalId: "security-review",
        marketplaceName: "claude-plugins-official",
        marketplaceSource: "anthropics/claude-plugins-official",
        resolution: "mutable_catalog",
      },
    ]);
  });

  it("builds native Claude upload references and fails closed for non-Claude marketplaces", () => {
    const references = buildAgentRuntimePluginReferences([
      plugin({
        id: "plugin-native-upload",
        provider: "claude-code",
        externalId: "private-review",
        manifest: { kind: "claude_plugin", schemaVersion: 1 },
      }),
      plugin({
        id: "plugin-opencode-marketplace",
        provider: "opencode",
        sourceType: "marketplace",
        storageObjectId: null,
        checksumSha256: null,
        manifest: null,
      }),
    ], [marketplace()]);

    expect(references).toEqual([
      {
        id: "plugin-native-upload",
        slug: "private-review",
        name: "Private review",
        kind: "claude_upload",
        provider: "claude-code",
        sourceType: "upload",
        version: "1.2.3",
        pluginName: "private-review",
        checksumSha256: "a".repeat(64),
      },
      expect.objectContaining({
        id: "plugin-opencode-marketplace",
        kind: "unsupported",
        diagnosticCode: "PROVIDER_MARKETPLACE_UNSUPPORTED",
      }),
    ]);
  });
});
