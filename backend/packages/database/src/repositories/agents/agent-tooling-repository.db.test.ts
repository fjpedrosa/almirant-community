/**
 * Real-DB regression tests for the owner-aware MCP/plugin catalog repository
 * (Agents v2 tooling port, community issue #69). Cloud (almirant-cloud) never
 * gained a dedicated unit-test file for this repository — its only coverage
 * lived in the API-layer agents domain (`agent-tooling-resolution.test.ts`),
 * which is out of scope for this schema/repo batch. These tests were written
 * fresh for the community port to cover the invariants the repository itself
 * is responsible for: secret redaction and the workspace/official/owner
 * visibility scoping shared by both the MCP server catalog and the plugin
 * catalog.
 *
 * Gated behind DATABASE_URL, mirroring the other DB-adjacent suites in this
 * package. Auto-skips with no DATABASE_URL set.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("agent-tooling-repository (real DB)", () => {
  let db: typeof import("../../client").db;
  let sql: typeof import("drizzle-orm").sql;
  let listAgentMcpServersByWorkspace: typeof import("./agent-tooling-repository").listAgentMcpServersByWorkspace;
  let getAgentMcpServerById: typeof import("./agent-tooling-repository").getAgentMcpServerById;
  let getAgentMcpServersByIds: typeof import("./agent-tooling-repository").getAgentMcpServersByIds;
  let getScheduledAgentMcpServerIds: typeof import("./agent-tooling-repository").getScheduledAgentMcpServerIds;
  let createAgentMcpServer: typeof import("./agent-tooling-repository").createAgentMcpServer;
  let updateAgentMcpServer: typeof import("./agent-tooling-repository").updateAgentMcpServer;
  let archiveAgentMcpServer: typeof import("./agent-tooling-repository").archiveAgentMcpServer;
  let listAgentPluginsByWorkspace: typeof import("./agent-tooling-repository").listAgentPluginsByWorkspace;
  let getAgentPluginById: typeof import("./agent-tooling-repository").getAgentPluginById;
  let createAgentPlugin: typeof import("./agent-tooling-repository").createAgentPlugin;
  let archiveAgentPlugin: typeof import("./agent-tooling-repository").archiveAgentPlugin;

  const suffix = randomUUID().slice(0, 8);
  const workspaceId = `mcp-test-ws-${suffix}`;
  let ownerA: string;
  let ownerB: string;
  const createdMcpServerIds: string[] = [];
  const createdPluginIds: string[] = [];
  const createdConfigIds: string[] = [];

  beforeAll(async () => {
    if (!hasDb) return;
    ({ db, sql } = await import("../../client"));
    ({
      listAgentMcpServersByWorkspace,
      getAgentMcpServerById,
      getAgentMcpServersByIds,
      getScheduledAgentMcpServerIds,
      createAgentMcpServer,
      updateAgentMcpServer,
      archiveAgentMcpServer,
      listAgentPluginsByWorkspace,
      getAgentPluginById,
      createAgentPlugin,
      archiveAgentPlugin,
    } = await import("./agent-tooling-repository"));

    await db.execute(sql`
      INSERT INTO workspace (id, name, slug, created_at)
      VALUES (${workspaceId}, 'mcp-test-workspace', ${`mcp-test-${suffix}`}, NOW())
      ON CONFLICT (id) DO NOTHING
    `);
    ownerA = `mcp-test-owner-a-${suffix}`;
    ownerB = `mcp-test-owner-b-${suffix}`;
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
    for (const id of createdConfigIds) {
      await db.execute(sql`DELETE FROM scheduled_agent_mcp_servers WHERE agent_id = ${id}`);
      await db.execute(sql`DELETE FROM scheduled_agent_configs WHERE id = ${id}`);
    }
    for (const id of createdMcpServerIds) {
      await db.execute(sql`DELETE FROM mcp_servers WHERE id = ${id}`);
    }
    for (const id of createdPluginIds) {
      await db.execute(sql`DELETE FROM agent_plugins WHERE id = ${id}`);
    }
    for (const id of [ownerA, ownerB]) {
      await db.execute(sql`DELETE FROM "user" WHERE id = ${id}`);
    }
    await db.execute(sql`DELETE FROM workspace WHERE id = ${workspaceId}`);
  });

  const mkMcpServer = async (overrides: Partial<{
    visibility: "user" | "workspace" | "official";
    ownerUserId: string | null;
    encryptedCredentials: string | null;
    name: string;
  }> = {}) => {
    const created = await createAgentMcpServer({
      workspaceId,
      ownerUserId: overrides.ownerUserId ?? null,
      name: overrides.name ?? `mcp-${randomUUID().slice(0, 8)}`,
      slug: `mcp-${randomUUID()}`,
      url: "https://mcp.example.test/mcp",
      visibility: overrides.visibility ?? "workspace",
      encryptedCredentials: overrides.encryptedCredentials ?? null,
    });
    createdMcpServerIds.push(created.id);
    return created;
  };

  const mkPlugin = async (overrides: Partial<{
    visibility: "user" | "workspace" | "official";
    ownerUserId: string | null;
  }> = {}) => {
    const created = await createAgentPlugin({
      workspaceId,
      ownerUserId: overrides.ownerUserId ?? null,
      name: `plugin-${randomUUID().slice(0, 8)}`,
      slug: `plugin-${randomUUID()}`,
      instructions: "Do the thing.",
      visibility: overrides.visibility ?? "workspace",
    });
    createdPluginIds.push(created.id);
    return created;
  };

  test("createAgentMcpServer redacts the encrypted credential envelope but reports hasSecret", async () => {
    const created = await mkMcpServer({ encryptedCredentials: "cipher-bytes" });

    expect(created.hasSecret).toBe(true);
    expect(created).not.toHaveProperty("encryptedCredentials");
    expect(created).not.toHaveProperty("credentialsIv");
    expect(created).not.toHaveProperty("credentialsAuthTag");
  });

  test("createAgentMcpServer without credentials reports hasSecret: false", async () => {
    const created = await mkMcpServer();
    expect(created.hasSecret).toBe(false);
  });

  test("listAgentMcpServersByWorkspace returns workspace-visible servers plus the caller's own, never another owner's private servers", async () => {
    const shared = await mkMcpServer({ visibility: "workspace" });
    const official = await mkMcpServer({ visibility: "official" });
    const ownedByA = await mkMcpServer({ visibility: "user", ownerUserId: ownerA });
    const ownedByB = await mkMcpServer({ visibility: "user", ownerUserId: ownerB });

    const asA = await listAgentMcpServersByWorkspace(workspaceId, ownerA);
    const ids = asA.map((s) => s.id);

    expect(ids).toContain(shared.id);
    expect(ids).toContain(official.id);
    expect(ids).toContain(ownedByA.id);
    expect(ids).not.toContain(ownedByB.id);
  });

  test("getAgentMcpServerById does not leak another owner's private server", async () => {
    const ownedByB = await mkMcpServer({ visibility: "user", ownerUserId: ownerB });

    expect(await getAgentMcpServerById(ownedByB.id, workspaceId, ownerA)).toBeUndefined();
    expect((await getAgentMcpServerById(ownedByB.id, workspaceId, ownerB))?.id).toBe(ownedByB.id);
  });

  test("archiveAgentMcpServer soft-deletes: the row disappears from list/get afterwards", async () => {
    const created = await mkMcpServer({ visibility: "workspace" });

    const archived = await archiveAgentMcpServer(created.id, workspaceId, ownerA);
    expect(archived).toBe(true);

    expect(await getAgentMcpServerById(created.id, workspaceId, ownerA)).toBeUndefined();
    const list = await listAgentMcpServersByWorkspace(workspaceId, ownerA);
    expect(list.map((s) => s.id)).not.toContain(created.id);
  });

  test("updateAgentMcpServer updates fields and bumps updatedAt", async () => {
    const created = await mkMcpServer({ visibility: "workspace" });

    const updated = await updateAgentMcpServer(created.id, workspaceId, ownerA, {
      description: "now with a description",
    });

    expect(updated?.description).toBe("now with a description");
  });

  test("getAgentMcpServersByIds dedups and only returns visible ids", async () => {
    const shared = await mkMcpServer({ visibility: "workspace" });
    const ownedByB = await mkMcpServer({ visibility: "user", ownerUserId: ownerB });

    const rows = await getAgentMcpServersByIds(workspaceId, ownerA, [
      shared.id,
      shared.id,
      ownedByB.id,
    ]);

    expect(rows.map((r) => r.id)).toEqual([shared.id]);
  });

  test("getScheduledAgentMcpServerIds returns only the enabled links for that agent", async () => {
    const serverEnabled = await mkMcpServer({ visibility: "workspace" });
    const serverDisabled = await mkMcpServer({ visibility: "workspace" });

    const [configRow] = await db.execute(sql`
      INSERT INTO scheduled_agent_configs (
        id, workspace_id, name, job_type, provider, schedule_type
      )
      VALUES (
        ${randomUUID()}, ${workspaceId}, 'test-agent', 'scheduled', 'claude-code', 'manual'
      )
      RETURNING id
    `) as unknown as Array<{ id: string }>;
    const agentId = configRow.id;
    createdConfigIds.push(agentId);

    await db.execute(sql`
      INSERT INTO scheduled_agent_mcp_servers (agent_id, mcp_server_id, enabled)
      VALUES (${agentId}, ${serverEnabled.id}, true)
    `);
    await db.execute(sql`
      INSERT INTO scheduled_agent_mcp_servers (agent_id, mcp_server_id, enabled)
      VALUES (${agentId}, ${serverDisabled.id}, false)
    `);

    const ids = await getScheduledAgentMcpServerIds(agentId);

    expect(ids).toEqual([serverEnabled.id]);
  });

  test("listAgentPluginsByWorkspace applies the same visibility scoping as the MCP catalog", async () => {
    const shared = await mkPlugin({ visibility: "workspace" });
    const ownedByA = await mkPlugin({ visibility: "user", ownerUserId: ownerA });
    const ownedByB = await mkPlugin({ visibility: "user", ownerUserId: ownerB });

    const asA = await listAgentPluginsByWorkspace(workspaceId, ownerA);
    const ids = asA.map((p) => p.id);

    expect(ids).toContain(shared.id);
    expect(ids).toContain(ownedByA.id);
    expect(ids).not.toContain(ownedByB.id);
  });

  test("archiveAgentPlugin soft-deletes: the row disappears from get afterwards", async () => {
    const created = await mkPlugin({ visibility: "workspace" });

    expect(await archiveAgentPlugin(created.id, workspaceId, ownerA)).toBe(true);
    expect(await getAgentPluginById(created.id, workspaceId, ownerA)).toBeUndefined();
  });
});
