import { describe, expect, it } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { deleteOrganizationAtomically } from "./organization-deletion";

const createDatabase = async () => {
  const client = new PGlite();
  await client.waitReady;
  await client.exec(`
    CREATE TABLE "workspace" ("id" text PRIMARY KEY, "name" text NOT NULL, "slug" text NOT NULL UNIQUE, "logo" text, "metadata" text, "created_at" timestamptz NOT NULL);
    CREATE TABLE "user" ("id" text PRIMARY KEY, "name" text NOT NULL, "email" text NOT NULL UNIQUE, "email_verified" boolean NOT NULL DEFAULT false, "created_at" timestamptz NOT NULL, "updated_at" timestamptz NOT NULL);
    CREATE TABLE "member" ("id" text PRIMARY KEY, "workspace_id" text NOT NULL REFERENCES "workspace"("id") ON DELETE CASCADE, "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE, "role" text NOT NULL, "created_at" timestamptz NOT NULL);
    CREATE TABLE "invitation" ("id" text PRIMARY KEY, "workspace_id" text NOT NULL REFERENCES "workspace"("id") ON DELETE CASCADE, "email" text NOT NULL, "role" text, "status" text NOT NULL, "expires_at" timestamptz NOT NULL, "created_at" timestamptz NOT NULL, "inviter_id" text REFERENCES "user"("id") ON DELETE SET NULL);
    CREATE TABLE "session" ("id" text PRIMARY KEY, "expires_at" timestamptz NOT NULL, "token" text NOT NULL UNIQUE, "created_at" timestamptz NOT NULL, "updated_at" timestamptz NOT NULL, "ip_address" text, "user_agent" text, "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE, "active_workspace_id" text);
    CREATE TABLE "note_pages" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "workspace_id" text NOT NULL REFERENCES "workspace"("id") ON DELETE CASCADE, "parent_id" uuid, "title" text NOT NULL DEFAULT '');
    INSERT INTO "workspace" VALUES ('w1', 'One', 'one', NULL, NULL, now()), ('w2', 'Two', 'two', NULL, NULL, now());
    INSERT INTO "user" VALUES ('u1', 'Owner', 'owner@example.test', false, now(), now()), ('u2', 'Member', 'member@example.test', false, now(), now());
    INSERT INTO "member" VALUES ('m1', 'w1', 'u1', 'owner', now()), ('m2', 'w1', 'u2', 'member', now()), ('m3', 'w2', 'u1', 'owner', now());
    INSERT INTO "invitation" VALUES ('i1', 'w1', 'invite@example.test', 'member', 'pending', now() + interval '1 day', now(), 'u1');
    INSERT INTO "session" VALUES ('s1', now() + interval '1 day', 'token-1', now(), now(), NULL, NULL, 'u1', 'w1'), ('s2', now() + interval '1 day', 'token-2', now(), now(), NULL, NULL, 'u1', 'w2');
    INSERT INTO "note_pages" ("id", "workspace_id", "title") VALUES ('10000000-0000-4000-8000-000000000001', 'w1', 'root'), ('10000000-0000-4000-8000-000000000002', 'w1', 'child');
  `);
  return client;
};

describe("atomic Better-Auth organization deletion", () => {
  it("deletes the workspace hierarchy and clears active sessions atomically", async () => {
    const client = await createDatabase();
    try {
      const database = drizzle(client) as never;
      const deleted = await deleteOrganizationAtomically({ organizationId: "w1", userId: "u1" }, { db: database });
      expect(deleted.id).toBe("w1");
      expect((await client.query(`SELECT 1 FROM workspace WHERE id = 'w1'`)).rows).toHaveLength(0);
      expect((await client.query(`SELECT 1 FROM member WHERE workspace_id = 'w1'`)).rows).toHaveLength(0);
      expect((await client.query(`SELECT 1 FROM invitation WHERE workspace_id = 'w1'`)).rows).toHaveLength(0);
      expect((await client.query(`SELECT 1 FROM note_pages WHERE workspace_id = 'w1'`)).rows).toHaveLength(0);
      expect((await client.query(`SELECT active_workspace_id FROM session WHERE id = 's1'`)).rows).toEqual([{ active_workspace_id: null }]);
      expect((await client.query(`SELECT 1 FROM workspace WHERE id = 'w2'`)).rows).toHaveLength(1);
    } finally {
      await client.close();
    }
  });

  it("rejects unauthorized members without touching the workspace", async () => {
    const client = await createDatabase();
    try {
      await expect(deleteOrganizationAtomically({ organizationId: "w1", userId: "u2" }, { db: drizzle(client) as never })).rejects.toThrow("not allowed");
      expect((await client.query(`SELECT 1 FROM workspace WHERE id = 'w1'`)).rows).toHaveLength(1);
      expect((await client.query(`SELECT 1 FROM note_pages WHERE workspace_id = 'w1'`)).rows).toHaveLength(2);
    } finally {
      await client.close();
    }
  });

  it("accepts an exact comma-separated owner role when any role grants deletion", async () => {
    const client = await createDatabase();
    try {
      await client.exec(`UPDATE "member" SET role = 'member,owner' WHERE id = 'm2'`);
      const deleted = await deleteOrganizationAtomically({ organizationId: "w1", userId: "u2" }, { db: drizzle(client) as never });
      expect(deleted.id).toBe("w1");
      expect((await client.query(`SELECT 1 FROM workspace WHERE id = 'w1'`)).rows).toHaveLength(0);
    } finally {
      await client.close();
    }
  });

  it("keeps organization deletion owner-only and does not trim role tokens", async () => {
    const client = await createDatabase();
    try {
      await client.exec(`UPDATE "member" SET role = 'admin' WHERE id = 'm2'`);
      await expect(deleteOrganizationAtomically({ organizationId: "w1", userId: "u2" }, { db: drizzle(client) as never })).rejects.toThrow("not allowed");
      await client.exec(`UPDATE "member" SET role = ' owner ' WHERE id = 'm2'`);
      await expect(deleteOrganizationAtomically({ organizationId: "w1", userId: "u2" }, { db: drizzle(client) as never })).rejects.toThrow("not allowed");
      expect((await client.query(`SELECT 1 FROM workspace WHERE id = 'w1'`)).rows).toHaveLength(1);
    } finally {
      await client.close();
    }
  });

  it("rolls back cascades and session cleanup when deletion fails after RETURNING", async () => {
    const client = await createDatabase();
    try {
      await expect(deleteOrganizationAtomically({ organizationId: "w1", userId: "u1" }, { db: drizzle(client) as never, failAfterDelete: true })).rejects.toThrow("ORGANIZATION_DELETE_INJECTED_FAILURE");
      expect((await client.query(`SELECT 1 FROM workspace WHERE id = 'w1'`)).rows).toHaveLength(1);
      expect((await client.query(`SELECT 1 FROM member WHERE workspace_id = 'w1'`)).rows).toHaveLength(2);
      expect((await client.query(`SELECT 1 FROM note_pages WHERE workspace_id = 'w1'`)).rows).toHaveLength(2);
      expect((await client.query(`SELECT active_workspace_id FROM session WHERE id = 's1'`)).rows).toEqual([{ active_workspace_id: "w1" }]);
    } finally {
      await client.close();
    }
  });
});
