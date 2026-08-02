/**
 * Real-DB regression tests for the plugin marketplace repository (Agents v2
 * tooling port, community issue #69). Cloud (almirant-cloud) never gained a
 * dedicated unit-test file for this repository — its only coverage lived in
 * the API-layer agents domain (`plugin-marketplace.test.ts`,
 * `plugin-marketplace-loader.test.ts`), which is out of scope for this
 * schema/repo batch. These tests were written fresh for the community port
 * to cover the invariants the repository itself is responsible for: the
 * `ensurePluginMarketplace` upsert's idempotency and catalog-reset-on-source-
 * change behavior, and the owner/shared authorization asymmetry between
 * `updatePluginMarketplaceCatalog` (shared rows are updatable by anyone) and
 * `deletePluginMarketplace` (only the literal owner may delete).
 *
 * Gated behind DATABASE_URL, mirroring the other DB-adjacent suites in this
 * package. Auto-skips with no DATABASE_URL set.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("plugin-marketplace-repository (real DB)", () => {
  let db: typeof import("../../client").db;
  let sql: typeof import("drizzle-orm").sql;
  let ensurePluginMarketplace: typeof import("./plugin-marketplace-repository").ensurePluginMarketplace;
  let listPluginMarketplacesByWorkspace: typeof import("./plugin-marketplace-repository").listPluginMarketplacesByWorkspace;
  let getPluginMarketplaceById: typeof import("./plugin-marketplace-repository").getPluginMarketplaceById;
  let createPluginMarketplace: typeof import("./plugin-marketplace-repository").createPluginMarketplace;
  let updatePluginMarketplaceCatalog: typeof import("./plugin-marketplace-repository").updatePluginMarketplaceCatalog;
  let deletePluginMarketplace: typeof import("./plugin-marketplace-repository").deletePluginMarketplace;
  let findOwnedAgentPluginVersion: typeof import("./plugin-marketplace-repository").findOwnedAgentPluginVersion;
  let createAgentPluginVersion: typeof import("./plugin-marketplace-repository").createAgentPluginVersion;
  let findOwnedMarketplaceAgentPluginVersion: typeof import("./plugin-marketplace-repository").findOwnedMarketplaceAgentPluginVersion;
  let listOwnedAgentPackagePlugins: typeof import("./plugin-marketplace-repository").listOwnedAgentPackagePlugins;

  const suffix = randomUUID().slice(0, 8);
  const workspaceId = `pm-test-ws-${suffix}`;
  let ownerA: string;
  let ownerB: string;
  const createdMarketplaceIds: string[] = [];
  const createdPluginIds: string[] = [];

  beforeAll(async () => {
    if (!hasDb) return;
    ({ db, sql } = await import("../../client"));
    ({
      ensurePluginMarketplace,
      listPluginMarketplacesByWorkspace,
      getPluginMarketplaceById,
      createPluginMarketplace,
      updatePluginMarketplaceCatalog,
      deletePluginMarketplace,
      findOwnedAgentPluginVersion,
      createAgentPluginVersion,
      findOwnedMarketplaceAgentPluginVersion,
      listOwnedAgentPackagePlugins,
    } = await import("./plugin-marketplace-repository"));

    await db.execute(sql`
      INSERT INTO workspace (id, name, slug, created_at)
      VALUES (${workspaceId}, 'pm-test-workspace', ${`pm-test-${suffix}`}, NOW())
      ON CONFLICT (id) DO NOTHING
    `);
    ownerA = `pm-test-owner-a-${suffix}`;
    ownerB = `pm-test-owner-b-${suffix}`;
    for (const id of [ownerA, ownerB]) {
      await db.execute(sql`
        INSERT INTO "user" (id, name, email, created_at, updated_at)
        VALUES (${id}, ${id}, ${`${id}@example.test`}, NOW(), NOW())
        ON CONFLICT (id) DO NOTHING
      `);
    }
  });

  afterAll(async () => {
    if (!hasDb) return;
    for (const id of createdPluginIds) {
      await db.execute(sql`DELETE FROM agent_plugins WHERE id = ${id}`);
    }
    for (const id of createdMarketplaceIds) {
      await db.execute(sql`DELETE FROM plugin_marketplaces WHERE id = ${id}`);
    }
    for (const id of [ownerA, ownerB]) {
      await db.execute(sql`DELETE FROM "user" WHERE id = ${id}`);
    }
    await db.execute(sql`DELETE FROM workspace WHERE id = ${workspaceId}`);
  });

  test("ensurePluginMarketplace is idempotent for an unchanged source", async () => {
    const slug = `mp-${randomUUID()}`;
    const input = {
      workspaceId,
      ownerUserId: ownerA,
      name: "My Marketplace",
      slug,
      provider: "claude-code" as const,
      source: "github.com/acme/marketplace",
      sourceType: "github" as const,
    };

    const first = await ensurePluginMarketplace(input);
    createdMarketplaceIds.push(first.id);
    const second = await ensurePluginMarketplace(input);

    expect(second.id).toBe(first.id);
    expect(second.updatedAt.getTime()).toBeGreaterThanOrEqual(first.updatedAt.getTime());
  });

  test("ensurePluginMarketplace resets the cached catalog when the source changes", async () => {
    const slug = `mp-${randomUUID()}`;
    const first = await ensurePluginMarketplace({
      workspaceId,
      ownerUserId: ownerA,
      name: "Rotating Marketplace",
      slug,
      provider: "claude-code",
      source: "github.com/acme/v1",
      sourceType: "github",
    });
    createdMarketplaceIds.push(first.id);
    await updatePluginMarketplaceCatalog(first.id, workspaceId, ownerA, {
      source: "github.com/acme/v1",
      catalog: { plugins: ["a"] },
      lastSyncedAt: new Date(),
    });

    const rotated = await ensurePluginMarketplace({
      workspaceId,
      ownerUserId: ownerA,
      name: "Rotating Marketplace",
      slug,
      provider: "claude-code",
      source: "github.com/acme/v2",
      sourceType: "github",
    });

    expect(rotated.id).toBe(first.id);
    expect(rotated.source).toBe("github.com/acme/v2");
    expect(rotated.catalog).toBeNull();
    expect(rotated.lastSyncedAt).toBeNull();
  });

  test("listPluginMarketplacesByWorkspace returns shared (ownerless) rows plus the caller's own, never another owner's", async () => {
    const shared = await createPluginMarketplace({
      workspaceId,
      ownerUserId: null,
      name: "Official",
      slug: `mp-${randomUUID()}`,
      provider: "claude-code",
      source: "github.com/acme/official",
      sourceType: "github",
    });
    createdMarketplaceIds.push(shared.id);
    const ownedByA = await createPluginMarketplace({
      workspaceId,
      ownerUserId: ownerA,
      name: "Mine",
      slug: `mp-${randomUUID()}`,
      provider: "claude-code",
      source: "github.com/a/mine",
      sourceType: "github",
    });
    createdMarketplaceIds.push(ownedByA.id);
    const ownedByB = await createPluginMarketplace({
      workspaceId,
      ownerUserId: ownerB,
      name: "Theirs",
      slug: `mp-${randomUUID()}`,
      provider: "claude-code",
      source: "github.com/b/theirs",
      sourceType: "github",
    });
    createdMarketplaceIds.push(ownedByB.id);

    const asA = await listPluginMarketplacesByWorkspace(workspaceId, ownerA);
    const ids = asA.map((m) => m.id);

    expect(ids).toContain(shared.id);
    expect(ids).toContain(ownedByA.id);
    expect(ids).not.toContain(ownedByB.id);
  });

  test("updatePluginMarketplaceCatalog: a shared (ownerless) marketplace is updatable by any caller", async () => {
    const shared = await createPluginMarketplace({
      workspaceId,
      ownerUserId: null,
      name: "Shared Sync Target",
      slug: `mp-${randomUUID()}`,
      provider: "claude-code",
      source: "github.com/acme/shared",
      sourceType: "github",
    });
    createdMarketplaceIds.push(shared.id);

    const updated = await updatePluginMarketplaceCatalog(shared.id, workspaceId, ownerB, {
      source: shared.source,
      catalog: { synced: true },
      lastSyncedAt: new Date(),
    });

    expect(updated?.catalog).toEqual({ synced: true });
  });

  test("deletePluginMarketplace requires exact ownership: neither another owner nor a shared row can be deleted by a non-owner caller", async () => {
    const shared = await createPluginMarketplace({
      workspaceId,
      ownerUserId: null,
      name: "Undeletable Shared",
      slug: `mp-${randomUUID()}`,
      provider: "claude-code",
      source: "github.com/acme/undeletable",
      sourceType: "github",
    });
    createdMarketplaceIds.push(shared.id);
    const ownedByA = await createPluginMarketplace({
      workspaceId,
      ownerUserId: ownerA,
      name: "A's Marketplace",
      slug: `mp-${randomUUID()}`,
      provider: "claude-code",
      source: "github.com/a/deletable",
      sourceType: "github",
    });
    createdMarketplaceIds.push(ownedByA.id);

    // A shared (ownerUserId IS NULL) row: eq(ownerUserId, callerId) never
    // matches NULL in SQL, so no caller id can delete it via this path.
    expect(await deletePluginMarketplace(shared.id, workspaceId, ownerB)).toBe(false);
    // Another owner's private row is likewise protected.
    expect(await deletePluginMarketplace(ownedByA.id, workspaceId, ownerB)).toBe(false);
    // The literal owner can delete their own row.
    expect(await deletePluginMarketplace(ownedByA.id, workspaceId, ownerA)).toBe(true);
    createdMarketplaceIds.splice(createdMarketplaceIds.indexOf(ownedByA.id), 1);
  });

  test("findOwnedAgentPluginVersion dedups an uploaded plugin by owner + checksum", async () => {
    const checksum = "b".repeat(64);
    const created = await createAgentPluginVersion({
      workspaceId,
      ownerUserId: ownerA,
      name: "Uploaded",
      slug: `plugin-${randomUUID()}`,
      instructions: "n/a",
      visibility: "user",
      sourceType: "upload",
      checksumSha256: checksum,
    });
    createdPluginIds.push(created.id);

    const found = await findOwnedAgentPluginVersion({
      workspaceId,
      ownerUserId: ownerA,
      checksumSha256: checksum,
    });

    expect(found?.id).toBe(created.id);
    // A different owner never matches, even with the same checksum.
    expect(
      await findOwnedAgentPluginVersion({ workspaceId, ownerUserId: ownerB, checksumSha256: checksum }),
    ).toBeUndefined();
  });

  test("findOwnedMarketplaceAgentPluginVersion dedups by marketplace + externalId + configurationSha256", async () => {
    const marketplace = await createPluginMarketplace({
      workspaceId,
      ownerUserId: ownerA,
      name: "Dedup Marketplace",
      slug: `mp-${randomUUID()}`,
      provider: "claude-code",
      source: "github.com/a/dedup",
      sourceType: "github",
    });
    createdMarketplaceIds.push(marketplace.id);
    const configHash = "c".repeat(40);
    const created = await createAgentPluginVersion({
      workspaceId,
      ownerUserId: ownerA,
      name: "Marketplace Plugin",
      slug: `plugin-${randomUUID()}`,
      instructions: "n/a",
      visibility: "user",
      sourceType: "marketplace",
      marketplaceId: marketplace.id,
      externalId: "acme/reviewer",
      manifest: { configurationSha256: configHash },
    });
    createdPluginIds.push(created.id);

    const found = await findOwnedMarketplaceAgentPluginVersion({
      workspaceId,
      ownerUserId: ownerA,
      marketplaceId: marketplace.id,
      externalId: "acme/reviewer",
      configurationSha256: configHash,
    });

    expect(found?.id).toBe(created.id);
  });

  test("listOwnedAgentPackagePlugins only returns marketplace/upload plugins, never plain instructions plugins", async () => {
    const upload = await createAgentPluginVersion({
      workspaceId,
      ownerUserId: ownerA,
      name: "Uploaded Pkg",
      slug: `plugin-${randomUUID()}`,
      instructions: "n/a",
      visibility: "user",
      sourceType: "upload",
      checksumSha256: "d".repeat(64),
    });
    createdPluginIds.push(upload.id);
    const instructionsOnly = await createAgentPluginVersion({
      workspaceId,
      ownerUserId: ownerA,
      name: "Plain Instructions",
      slug: `plugin-${randomUUID()}`,
      instructions: "just text",
      visibility: "user",
      sourceType: "instructions",
    });
    createdPluginIds.push(instructionsOnly.id);

    const rows = await listOwnedAgentPackagePlugins(workspaceId, ownerA);
    const ids = rows.map((p) => p.id);

    expect(ids).toContain(upload.id);
    expect(ids).not.toContain(instructionsOnly.id);
  });
});
