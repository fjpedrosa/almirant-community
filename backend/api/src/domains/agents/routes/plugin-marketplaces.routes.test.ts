import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Elysia } from "elysia";
import type {
  AgentPluginDb,
  PluginMarketplaceDb,
} from "@almirant/database";
import { testUser, testWorkspace } from "../../../test/fixtures";
import {
  AgentPluginCatalogError,
  OFFICIAL_CLAUDE_MARKETPLACE_SLUG,
  type AgentPluginCatalogService,
} from "../services/agent-plugin-catalog-service";
import { createPluginMarketplacesRoutes } from "./plugin-marketplaces.routes";

const marketplace = (
  overrides: Partial<PluginMarketplaceDb> = {},
): PluginMarketplaceDb => ({
  id: "7cff4ec7-32a8-4e92-91f1-2748fe4551a4",
  workspaceId: testWorkspace.id,
  name: "Claude Plugins Official",
  slug: OFFICIAL_CLAUDE_MARKETPLACE_SLUG,
  provider: "claude-code",
  source: "anthropics/claude-plugins-official",
  sourceType: "github",
  catalog: {
    name: OFFICIAL_CLAUDE_MARKETPLACE_SLUG,
    ownerName: "Anthropic",
    plugins: [],
  },
  enabled: true,
  lastSyncedAt: new Date("2026-07-10T10:00:00.000Z"),
  ownerUserId: null,
  createdByUserId: null,
  createdAt: new Date("2026-07-10T09:00:00.000Z"),
  updatedAt: new Date("2026-07-10T10:00:00.000Z"),
  ...overrides,
});

const plugin = (overrides: Partial<AgentPluginDb> = {}): AgentPluginDb => ({
  id: "027dc265-8ea3-491d-a893-c11eb523fd53",
  workspaceId: testWorkspace.id,
  name: "review",
  slug: "review-aabbccdd",
  description: "Reviews code",
  instructions: "",
  ownerUserId: testUser.id,
  visibility: "user",
  provider: "claude-code",
  sourceType: "marketplace",
  marketplaceId: "7cff4ec7-32a8-4e92-91f1-2748fe4551a4",
  externalId: "review",
  sourceReference: "review@claude-plugins-official",
  version: "1.0.0",
  checksumSha256: "a".repeat(64),
  storageObjectId: null,
  manifest: { kind: "claude_marketplace_plugin", provider: "claude-code" },
  enabled: true,
  archivedAt: null,
  createdByUserId: testUser.id,
  createdAt: new Date("2026-07-10T10:00:00.000Z"),
  updatedAt: new Date("2026-07-10T10:00:00.000Z"),
  ...overrides,
});

const calls = {
  add: [] as unknown[],
  install: [] as unknown[],
  upload: [] as unknown[],
};

const service = {
  listMarketplaces: mock(async () => [marketplace()]),
  addMarketplace: mock(async (input) => {
    calls.add.push(input);
    return marketplace({
      id: "a22fc568-131f-4317-b260-2b15789ad7a2",
      name: input.name ?? "Acme",
      slug: "acme-plugins",
      source: input.source,
      createdByUserId: input.ownerUserId,
    });
  }),
  syncMarketplace: mock(async (_workspaceId, id) => marketplace({ id })),
  removeMarketplace: mock(async () => true),
  installMarketplacePlugin: mock(async (input) => {
    calls.install.push(input);
    return plugin({ marketplaceId: input.marketplaceId, externalId: input.externalId });
  }),
  uploadPrivateBundle: mock(async (input) => {
    calls.upload.push(input);
    return plugin({
      provider: "portable",
      sourceType: "upload",
      marketplaceId: null,
      storageObjectId: "1b937514-da03-44e8-a1e8-f088d9d067a0",
    });
  }),
  listOwnedPackagePlugins: mock(async () => [plugin()]),
} satisfies AgentPluginCatalogService;

const makeApp = () =>
  new Elysia()
    .derive(() => ({
      user: testUser,
      activeWorkspace: testWorkspace,
      memberRole: "owner" as const,
    }))
    .use(createPluginMarketplacesRoutes(service));

beforeEach(() => {
  calls.add = [];
  calls.install = [];
  calls.upload = [];
  for (const fn of Object.values(service)) fn.mockClear();
});

describe("plugin marketplace routes", () => {
  it("lists the built-in Claude source and its cached sanitized catalog", async () => {
    const response = await makeApp().handle(
      new Request("http://localhost/scheduled-agents/plugin-marketplaces"),
    );

    expect(response.status).toBe(200);
    const body = await response.json() as {
      data: Array<Record<string, unknown>>;
    };
    expect(body.data[0]).toMatchObject({
      slug: OFFICIAL_CLAUDE_MARKETPLACE_SLUG,
      provider: "claude-code",
      isBuiltIn: true,
    });
    expect(service.listMarketplaces).toHaveBeenCalledWith(
      testWorkspace.id,
      testUser.id,
    );
    expect(JSON.stringify(body)).not.toContain("createdByUserId");
  });

  it("adds a custom source using authenticated ownership, never payload ownership", async () => {
    const response = await makeApp().handle(
      new Request("http://localhost/scheduled-agents/plugin-marketplaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: "acme/plugins",
          name: "Acme Catalog",
          ownerUserId: "attacker-controlled",
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(calls.add).toEqual([
      {
        workspaceId: testWorkspace.id,
        ownerUserId: testUser.id,
        source: "acme/plugins",
        name: "Acme Catalog",
      },
    ]);
  });

  it("syncs and removes workspace-scoped custom sources", async () => {
    const app = makeApp();
    const id = "7cff4ec7-32a8-4e92-91f1-2748fe4551a4";

    const sync = await app.handle(
      new Request(`http://localhost/scheduled-agents/plugin-marketplaces/${id}/sync`, {
        method: "POST",
      }),
    );
    const remove = await app.handle(
      new Request(`http://localhost/scheduled-agents/plugin-marketplaces/${id}`, {
        method: "DELETE",
      }),
    );

    expect(sync.status).toBe(200);
    expect(remove.status).toBe(200);
    expect(service.syncMarketplace).toHaveBeenCalledWith(
      testWorkspace.id,
      testUser.id,
      id,
    );
    expect(service.removeMarketplace).toHaveBeenCalledWith(
      testWorkspace.id,
      testUser.id,
      id,
    );
  });

  it("installs a cached entry with the authenticated user and explicit Claude provider", async () => {
    const response = await makeApp().handle(
      new Request(
        "http://localhost/scheduled-agents/plugin-marketplaces/7cff4ec7-32a8-4e92-91f1-2748fe4551a4/plugins/review/install",
        { method: "POST" },
      ),
    );

    expect(response.status).toBe(201);
    expect(calls.install).toEqual([
      {
        workspaceId: testWorkspace.id,
        ownerUserId: testUser.id,
        marketplaceId: "7cff4ec7-32a8-4e92-91f1-2748fe4551a4",
        externalId: "review",
      },
    ]);
    const body = await response.json() as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({ provider: "claude-code", sourceType: "marketplace" });
    expect(JSON.stringify(body)).not.toContain("sourceReference");
    expect(JSON.stringify(body)).not.toContain("storageObjectId");
  });

  it("uploads ZIP bytes as a private user-owned package without an ownership field", async () => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array([1, 2, 3, 4])], "private.zip", {
      type: "application/zip",
    }));
    form.set("name", "Private Review");
    form.set("description", "My private workflow");

    const response = await makeApp().handle(
      new Request("http://localhost/scheduled-agents/plugin-packages/upload", {
        method: "POST",
        body: form,
      }),
    );

    expect(response.status).toBe(201);
    expect(calls.upload).toHaveLength(1);
    expect(calls.upload[0]).toMatchObject({
      workspaceId: testWorkspace.id,
      ownerUserId: testUser.id,
      fileName: "private.zip",
      name: "Private Review",
      description: "My private workflow",
    });
    expect((calls.upload[0] as { bytes: Uint8Array }).bytes).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
  });

  it("lists only package records selected by authenticated ownership", async () => {
    const response = await makeApp().handle(
      new Request("http://localhost/scheduled-agents/plugin-packages"),
    );

    expect(response.status).toBe(200);
    expect(service.listOwnedPackagePlugins).toHaveBeenCalledWith(
      testWorkspace.id,
      testUser.id,
    );
  });

  it("maps missing and built-in marketplace errors without leaking internals", async () => {
    service.syncMarketplace.mockRejectedValueOnce(
      new AgentPluginCatalogError(
        "Plugin marketplace not found",
        "PLUGIN_MARKETPLACE_NOT_FOUND",
      ),
    );
    service.removeMarketplace.mockRejectedValueOnce(
      new AgentPluginCatalogError(
        "The built-in Claude marketplace cannot be removed",
        "BUILT_IN_MARKETPLACE",
      ),
    );
    const app = makeApp();

    const missing = await app.handle(
      new Request(
        "http://localhost/scheduled-agents/plugin-marketplaces/7cff4ec7-32a8-4e92-91f1-2748fe4551a4/sync",
        { method: "POST" },
      ),
    );
    const builtIn = await app.handle(
      new Request(
        "http://localhost/scheduled-agents/plugin-marketplaces/7cff4ec7-32a8-4e92-91f1-2748fe4551a4",
        { method: "DELETE" },
      ),
    );

    expect(missing.status).toBe(404);
    expect(builtIn.status).toBe(400);
  });
});
