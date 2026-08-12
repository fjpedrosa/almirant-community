import { describe, expect, it } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { createNotePage, createNotesRepository } from "./notes-repository-core";
import {
  MAX_LEGACY_CONVERSION_DEPTH,
  MAX_LEGACY_CONVERSION_NODES,
  MAX_LEGACY_CONVERSION_SNAPSHOT_BYTES,
} from "../../notes/legacy-snapshot-serializer";

const migrationSql = await Bun.file(new URL("../../../migrations/0229_green_santa_claus.sql", import.meta.url)).text();
const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const legacySummaryKeys = [
  "convertedActionId",
  "convertedPageId",
  "createdAt",
  "disposition",
  "dispositionAt",
  "id",
  "sourceId",
  "sourcePreview",
  "sourceTitle",
  "sourceType",
  "updatedAt",
];

const setup = async () => {
  const database = new PGlite();
  await database.waitReady;
  await database.exec(`
    CREATE TABLE "workspace" ("id" text PRIMARY KEY);
    CREATE TABLE "user" ("id" text PRIMARY KEY);
    CREATE TABLE "member" ("id" text PRIMARY KEY, "workspace_id" text NOT NULL, "user_id" text NOT NULL);
    CREATE TABLE "agent_jobs" ("id" uuid PRIMARY KEY, "workspace_id" text REFERENCES "workspace"("id") ON DELETE SET NULL);
    INSERT INTO "workspace" VALUES ('w1'), ('w2');
    INSERT INTO "user" VALUES ('u1'), ('u2'), ('u3');
    INSERT INTO "member" VALUES ('m1', 'w1', 'u1'), ('m2', 'w1', 'u2'), ('m3', 'w2', 'u3');
  `);
  await database.exec(migrationSql);
  await database.exec(`INSERT INTO "agent_jobs" ("id", "workspace_id") VALUES ('50000000-0000-4000-8000-000000000001', 'w1')`);
  return database;
};

describe("notes repository ACL and state", () => {
  it("lists only bounded ACL-safe checklist audit summaries with stable pagination", async () => {
    const database = await setup();
    try {
      const repo = createNotesRepository(drizzle(database) as never);
      const owner = { workspaceId: "w1", userId: "u1" };
      const viewer = { workspaceId: "w1", userId: "u2" };
      const foreign = { workspaceId: "w2", userId: "u3" };
      const firstId = "21000000-0000-4000-8000-000000000001";
      const secondId = "21000000-0000-4000-8000-000000000002";
      const page = await repo.createPage({
        ...owner,
        visibility: "workspace",
        lexicalJson: {
          root: {
            type: "root",
            version: 1,
            children: [
              { type: "check-listitem", version: 1, checked: false, itemId: firstId, children: [{ type: "text", version: 1, text: "A".repeat(5_000) }] },
              { type: "check-listitem", version: 1, checked: false, itemId: secondId, children: [{ type: "text", version: 1, text: "Second" }] },
            ],
          },
        },
      });
      const completed = await repo.updateChecklistItem({
        ...owner,
        pageId: page.id,
        itemId: firstId,
        checked: true,
        expectedStateVersion: page.stateVersion,
      });

      const first = await repo.listChecklistItems(viewer, page.id, { limit: 1, offset: 0 });
      expect(first.pagination).toEqual({ limit: 1, offset: 0, hasMore: true, nextOffset: 1 });
      expect([...first.items[0]!.text]).toHaveLength(512);
      expect(first.items[0]).toEqual(expect.objectContaining({
        itemId: firstId,
        checked: true,
        completedByUserId: owner.userId,
        completedAt: completed!.item.completedAt,
      }));
      expect(Object.keys(first.items[0]!).sort()).toEqual([
        "checked",
        "completedAt",
        "completedByUserId",
        "itemId",
        "ordinal",
        "text",
        "updatedAt",
      ]);
      expect((await repo.listChecklistItems(foreign, page.id, { limit: 10 })).items).toEqual([]);
    } finally {
      await database.close();
    }
  });
  it("projects effective capabilities and exposes archived pages only to their owner", async () => {
    const database = await setup();
    try {
      const repo = createNotesRepository(drizzle(database) as never);
      const owner = { workspaceId: "w1", userId: "u1" };
      const collaborator = { workspaceId: "w1", userId: "u2" };
      const root = await repo.createPage({ ...owner, title: "Capability root" });
      const inherited = await repo.createPage({ ...owner, parentId: root.id, title: "Capability child" });
      const workspacePage = await repo.createPage({ ...owner, title: "Workspace viewer", visibility: "workspace" });
      await repo.setShare({ ...owner, pageId: root.id, sharedWithUserId: collaborator.userId, role: "editor" });

      expect(await repo.getPage(owner, root.id)).toEqual(expect.objectContaining({
        canEdit: true,
        canManageShares: true,
        canReparent: true,
        canArchive: true,
        canChangeVisibility: true,
        canRestore: false,
      }));
      expect(await repo.getPage(collaborator, inherited.id)).toEqual(expect.objectContaining({
        canEdit: true,
        canManageShares: false,
        canReparent: false,
        canArchive: false,
        canChangeVisibility: false,
        canRestore: false,
      }));
      const summaries = await repo.pageTree(collaborator, { limit: 10, offset: 0 });
      expect(summaries.items.find((item: any) => item.id === inherited.id)).toEqual(expect.objectContaining({
        canEdit: true,
        canManageShares: false,
      }));
      expect(summaries.items.find((item: any) => item.id === workspacePage.id)).toEqual(expect.objectContaining({
        canEdit: false,
        canManageShares: false,
        canReparent: false,
        canArchive: false,
        canChangeVisibility: false,
        canRestore: false,
      }));

      const firstArchived = await repo.updatePage({
        ...owner,
        pageId: workspacePage.id,
        expectedStateVersion: workspacePage.stateVersion,
        archivedAt: new Date("2026-08-10T00:00:00.000Z"),
      });
      const secondPage = await repo.createPage({ ...owner, title: "Second archived" });
      await repo.updatePage({
        ...owner,
        pageId: secondPage.id,
        expectedStateVersion: secondPage.stateVersion,
        archivedAt: new Date("2026-08-11T00:00:00.000Z"),
      });
      const archived = await repo.archivedPages(owner, { limit: 1, offset: 0 });
      expect(archived.items).toHaveLength(1);
      expect(archived.pagination).toEqual({ limit: 1, offset: 0, hasMore: true, nextOffset: 1 });
      expect(archived.items[0]).toEqual(expect.objectContaining({
        id: secondPage.id,
        stateVersion: secondPage.stateVersion + 1,
        canEdit: false,
        canManageShares: false,
        canReparent: false,
        canArchive: false,
        canChangeVisibility: false,
        canRestore: true,
      }));
      expect(archived.items[0]).not.toHaveProperty("lexicalJson");
      expect((await repo.archivedPages(collaborator, { limit: 10, offset: 0 })).items).toEqual([]);
      expect(firstArchived?.archivedAt).not.toBeNull();
    } finally {
      await database.close();
    }
  });

  it("reports only state-, kind-, and operation-executable capabilities", async () => {
    const database = await setup();
    try {
      const repo = createNotesRepository(drizzle(database) as never);
      const owner = { workspaceId: "w1", userId: "u1" };
      const collaborator = { workspaceId: "w1", userId: "u2" };
      const parent = await repo.createPage({ ...owner, title: "Agenda parent" });
      const daily = await repo.getOrCreateDaily(owner, "2026-08-12");

      expect(await repo.getPage(owner, daily.id)).toEqual(expect.objectContaining({
        kind: "daily",
        canEdit: true,
        canManageShares: true,
        canReparent: true,
        canArchive: false,
        canChangeVisibility: true,
        canRestore: false,
      }));

      await repo.setShare({
        ...owner,
        pageId: daily.id,
        sharedWithUserId: collaborator.userId,
        role: "editor",
      });
      const edited = await repo.updatePage({
        ...owner,
        pageId: daily.id,
        expectedStateVersion: daily.stateVersion,
        title: "Editable agenda day",
      });
      const reparented = await repo.reparent({
        ...owner,
        pageId: daily.id,
        parentId: parent.id,
        expectedStateVersion: edited!.stateVersion,
      });
      const visible = await repo.updatePage({
        ...owner,
        pageId: daily.id,
        expectedStateVersion: reparented!.stateVersion,
        visibility: "workspace",
      });
      expect(visible).toEqual(expect.objectContaining({
        title: "Editable agenda day",
        parentId: parent.id,
        visibility: "workspace",
      }));
      await expect(repo.updatePage({
        ...owner,
        pageId: daily.id,
        expectedStateVersion: visible!.stateVersion,
        archivedAt: new Date(),
      })).rejects.toThrow("DAILY_PAGE_CANNOT_ARCHIVE");
    } finally {
      await database.close();
    }
  });

  it("returns capability-bearing snapshots from create, daily, update, visibility, and reparent transactions", async () => {
    const database = await setup();
    try {
      const repo = createNotesRepository(drizzle(database) as never);
      const owner = { workspaceId: "w1", userId: "u1" };
      const editor = { workspaceId: "w1", userId: "u2" };
      const parent = await repo.createPage({ ...owner, title: "Snapshot parent" });
      expect(parent).toEqual(expect.objectContaining({
        stateVersion: 1,
        canEdit: true,
        canManageShares: true,
        canReparent: true,
        canArchive: true,
        canChangeVisibility: true,
        canRestore: false,
      }));

      const daily = await repo.getOrCreateDaily(owner, "2026-08-13");
      expect(daily).toEqual(expect.objectContaining({
        stateVersion: 1,
        kind: "daily",
        canEdit: true,
        canArchive: false,
        canRestore: false,
      }));

      const sharedRoot = await repo.createPage({ ...owner, title: "Shared snapshot root" });
      const inherited = await repo.createPage({ ...owner, parentId: sharedRoot.id, title: "Inherited snapshot" });
      await repo.setShare({ ...owner, pageId: sharedRoot.id, sharedWithUserId: editor.userId, role: "editor" });
      const edited = await repo.updatePage({
        ...editor,
        pageId: inherited.id,
        expectedStateVersion: inherited.stateVersion,
        title: "Committed inherited edit",
      });
      expect(edited).toEqual(expect.objectContaining({
        title: "Committed inherited edit",
        stateVersion: inherited.stateVersion + 1,
        canEdit: true,
        canManageShares: false,
        canReparent: false,
        canArchive: false,
        canChangeVisibility: false,
        canRestore: false,
      }));

      const visible = await repo.updatePage({
        ...owner,
        pageId: inherited.id,
        expectedStateVersion: edited!.stateVersion,
        visibility: "workspace",
      });
      expect(visible).toEqual(expect.objectContaining({
        visibility: "workspace",
        stateVersion: edited!.stateVersion + 1,
        canChangeVisibility: true,
      }));
      const reparented = await repo.reparent({
        ...owner,
        pageId: inherited.id,
        parentId: parent.id,
        expectedStateVersion: visible!.stateVersion,
      });
      expect(reparented).toEqual(expect.objectContaining({
        parentId: parent.id,
        stateVersion: visible!.stateVersion + 1,
        canReparent: true,
      }));
    } finally {
      await database.close();
    }
  });

  it("returns exact archived, restored, and checklist snapshots from their write transactions", async () => {
    const database = await setup();
    try {
      const repo = createNotesRepository(drizzle(database) as never);
      const owner = { workspaceId: "w1", userId: "u1" };
      const itemId = "20000000-0000-4000-8000-000000000121";
      const page = await repo.createPage({
        ...owner,
        title: "Atomic command snapshot",
        lexicalJson: {
          root: {
            type: "root",
            version: 1,
            children: [{
              type: "check-listitem",
              version: 1,
              checked: false,
              itemId,
              children: [{ type: "text", version: 1, text: "Atomic completion" }],
            }],
          },
        },
      });
      const archived = await repo.updatePage({
        ...owner,
        pageId: page.id,
        expectedStateVersion: page.stateVersion,
        archivedAt: new Date("2026-08-13T08:00:00.000Z"),
      });
      expect(archived).toEqual(expect.objectContaining({
        stateVersion: page.stateVersion + 1,
        archivedAt: new Date("2026-08-13T08:00:00.000Z"),
        canEdit: false,
        canManageShares: false,
        canReparent: false,
        canArchive: false,
        canChangeVisibility: false,
        canRestore: true,
      }));

      const restored = await repo.updatePage({
        ...owner,
        pageId: page.id,
        expectedStateVersion: archived!.stateVersion,
        archivedAt: null,
      });
      expect(restored).toEqual(expect.objectContaining({
        stateVersion: archived!.stateVersion + 1,
        archivedAt: null,
        canEdit: true,
        canArchive: true,
        canRestore: false,
      }));

      const completion = await repo.updateChecklistItem({
        ...owner,
        pageId: page.id,
        itemId,
        checked: true,
        expectedStateVersion: restored!.stateVersion,
      });
      expect(completion).toEqual(expect.objectContaining({
        item: expect.objectContaining({ itemId, checked: true }),
        page: expect.objectContaining({
          id: page.id,
          stateVersion: restored!.stateVersion + 1,
          canEdit: true,
          canArchive: true,
          canRestore: false,
        }),
      }));
    } finally {
      await database.close();
    }
  });

  it("terminates inherited read, search, editor, and destination ACL at archived ancestors", async () => {
    const database = await setup();
    try {
      const repo = createNotesRepository(drizzle(database) as never);
      const owner = { workspaceId: "w1", userId: "u1" };
      const collaborator = { workspaceId: "w1", userId: "u2" };

      const sharedRoot = await repo.createPage({ ...owner, title: "shared-root-marker" });
      const directChild = await repo.createPage({ ...owner, parentId: sharedRoot.id, title: "direct-inherited-marker" });
      await repo.setShare({ ...owner, pageId: sharedRoot.id, sharedWithUserId: collaborator.userId, role: "editor" });

      const activeSharedRoot = await repo.createPage({ ...owner, title: "active-shared-root-marker" });
      const bridge = await repo.createPage({ ...owner, parentId: activeSharedRoot.id, title: "archive-bridge-marker" });
      const deepChild = await repo.createPage({ ...owner, parentId: bridge.id, title: "deep-inherited-marker" });
      await repo.setShare({ ...owner, pageId: activeSharedRoot.id, sharedWithUserId: collaborator.userId, role: "editor" });

      const workspaceRoot = await repo.createPage({ ...owner, title: "workspace-root-marker", visibility: "workspace" });
      const workspaceChild = await repo.createPage({ ...owner, parentId: workspaceRoot.id, title: "workspace-inherited-marker" });

      expect((await repo.getPage(collaborator, directChild.id))?.id).toBe(directChild.id);
      expect((await repo.getPage(collaborator, deepChild.id))?.id).toBe(deepChild.id);
      expect((await repo.getPage(collaborator, workspaceChild.id))?.id).toBe(workspaceChild.id);
      expect((await repo.search(collaborator, "direct-inherited-marker")).items.map((page: any) => page.id)).toEqual([directChild.id]);
      expect((await repo.search(collaborator, "deep-inherited-marker")).items.map((page: any) => page.id)).toEqual([deepChild.id]);
      expect((await repo.search(collaborator, "workspace-inherited-marker")).items.map((page: any) => page.id)).toEqual([workspaceChild.id]);

      const directEdited = await repo.updatePage({ ...collaborator, pageId: directChild.id, expectedStateVersion: directChild.stateVersion, title: "direct-inherited-edited" });
      const deepEdited = await repo.updatePage({ ...collaborator, pageId: deepChild.id, expectedStateVersion: deepChild.stateVersion, title: "deep-inherited-edited" });
      expect(directEdited?.title).toBe("direct-inherited-edited");
      expect(deepEdited?.title).toBe("deep-inherited-edited");
      const preArchiveDestinationChild = await repo.createPage({ ...collaborator, parentId: deepChild.id, title: "pre-archive-destination" });
      expect(preArchiveDestinationChild.parentId).toBe(deepChild.id);

      const archivedSharedRoot = await repo.updatePage({ ...owner, pageId: sharedRoot.id, expectedStateVersion: sharedRoot.stateVersion, archivedAt: new Date("2026-08-11T01:00:00.000Z") });
      const archivedBridge = await repo.updatePage({ ...owner, pageId: bridge.id, expectedStateVersion: bridge.stateVersion, archivedAt: new Date("2026-08-11T02:00:00.000Z") });
      const archivedWorkspaceRoot = await repo.updatePage({ ...owner, pageId: workspaceRoot.id, expectedStateVersion: workspaceRoot.stateVersion, archivedAt: new Date("2026-08-11T03:00:00.000Z") });

      expect(await repo.getPage(collaborator, directChild.id)).toBeNull();
      expect(await repo.getPage(collaborator, deepChild.id)).toBeNull();
      expect(await repo.getPage(collaborator, workspaceChild.id)).toBeNull();
      expect((await repo.search(collaborator, "direct-inherited-edited")).items).toEqual([]);
      expect((await repo.search(collaborator, "deep-inherited-edited")).items).toEqual([]);
      expect((await repo.search(collaborator, "workspace-inherited-marker")).items).toEqual([]);
      expect(await repo.updatePage({ ...collaborator, pageId: directChild.id, expectedStateVersion: directEdited!.stateVersion, title: "blocked-direct-edit" })).toBeNull();
      expect(await repo.updatePage({ ...collaborator, pageId: deepChild.id, expectedStateVersion: deepEdited!.stateVersion, title: "blocked-deep-edit" })).toBeNull();
      await expect(repo.createPage({ ...collaborator, parentId: directChild.id, title: "blocked-direct-destination" })).rejects.toThrow("PARENT_NOT_FOUND");
      await expect(repo.createPage({ ...collaborator, parentId: deepChild.id, title: "blocked-deep-destination" })).rejects.toThrow("PARENT_NOT_FOUND");

      expect((await repo.getPage(owner, directChild.id))?.id).toBe(directChild.id);
      expect((await repo.getPage(owner, deepChild.id))?.id).toBe(deepChild.id);
      await repo.setShare({ ...owner, pageId: deepChild.id, sharedWithUserId: collaborator.userId, role: "editor" });
      expect((await repo.getPage(collaborator, deepChild.id))?.id).toBe(deepChild.id);
      const directGrantEdit = await repo.updatePage({ ...collaborator, pageId: deepChild.id, expectedStateVersion: deepEdited!.stateVersion, title: "direct-grant-edit" });
      expect(directGrantEdit?.title).toBe("direct-grant-edit");
      expect((await repo.createPage({ ...collaborator, parentId: deepChild.id, title: "direct-grant-destination" })).parentId).toBe(deepChild.id);
      await repo.removeShare({ ...owner, pageId: deepChild.id, sharedWithUserId: collaborator.userId });

      await repo.updatePage({ ...owner, pageId: sharedRoot.id, expectedStateVersion: archivedSharedRoot!.stateVersion, archivedAt: null });
      await repo.updatePage({ ...owner, pageId: bridge.id, expectedStateVersion: archivedBridge!.stateVersion, archivedAt: null });
      await repo.updatePage({ ...owner, pageId: workspaceRoot.id, expectedStateVersion: archivedWorkspaceRoot!.stateVersion, archivedAt: null });
      expect((await repo.getPage(collaborator, directChild.id))?.id).toBe(directChild.id);
      expect((await repo.getPage(collaborator, deepChild.id))?.id).toBe(deepChild.id);
      expect((await repo.getPage(collaborator, workspaceChild.id))?.id).toBe(workspaceChild.id);
      expect((await repo.search(collaborator, "direct-inherited-edited")).items.map((page: any) => page.id)).toEqual([directChild.id]);
      expect((await repo.search(collaborator, "direct-grant-edit")).items.map((page: any) => page.id)).toEqual([deepChild.id]);
      expect((await repo.search(collaborator, "workspace-inherited-marker")).items.map((page: any) => page.id)).toEqual([workspaceChild.id]);
      expect((await repo.createPage({ ...collaborator, parentId: deepChild.id, title: "restored-inherited-destination" })).parentId).toBe(deepChild.id);
    } finally {
      await database.close();
    }
  });

  it("returns source versions for carryover mutations and bounded backlink source titles", async () => {
    const database = await setup();
    try {
      const repo = createNotesRepository(drizzle(database) as never);
      const owner = { workspaceId: "w1", userId: "u1" };
      const itemId = "20000000-0000-4000-8000-000000000099";
      const daily = await repo.createPage({
        ...owner,
        kind: "daily",
        dailyDate: "2026-08-08",
        lexicalJson: { root: { type: "root", version: 1, children: [{ type: "check-listitem", version: 1, checked: false, itemId, children: [{ type: "text", version: 1, text: "versioned carryover" }] }] } },
      });
      const carryover = await repo.dailyCarryover({ ...owner, dailyDate: "2026-08-09" });
      expect(carryover.items[0]).toEqual(expect.objectContaining({
        sourcePageId: daily.id,
        sourceStateVersion: daily.stateVersion,
      }));
      const mutation = await repo.updateChecklistItem({
        ...owner,
        pageId: daily.id,
        itemId,
        checked: true,
        expectedStateVersion: daily.stateVersion,
      });
      expect(mutation).toEqual(expect.objectContaining({
        item: expect.objectContaining({ itemId, checked: true }),
        page: expect.objectContaining({ id: daily.id, stateVersion: daily.stateVersion + 1 }),
      }));

      const target = await repo.createPage({ ...owner, title: "Backlink destination" });
      const sourceTitle = "🚀".repeat(600);
      const source = await repo.createPage({
        ...owner,
        title: sourceTitle,
        lexicalJson: { root: { type: "root", version: 1, children: [{ type: "paragraph", version: 1, children: [{ type: "link", version: 1, url: `note://${target.id}`, children: [{ type: "text", version: 1, text: "bounded anchor" }] }] }] } },
      });
      const backlinks = await repo.backlinks({ ...owner, pageId: target.id }, { limit: 10, offset: 0 });
      expect(backlinks.items).toEqual([
        expect.objectContaining({ sourcePageId: source.id, sourceTitle: "🚀".repeat(256) }),
      ]);
      expect(Array.from(backlinks.items[0]!.sourceTitle)).toHaveLength(256);
    } finally {
      await database.close();
    }
  });

  it("atomically converts a full immutable legacy snapshot into one deterministic private page", async () => {
    const database = await setup();
    try {
      const repo = createNotesRepository(drizzle(database) as never);
      const owner = { workspaceId: "w1", userId: "u1" };
      const archiveId = uuid(879);
      const snapshot = {
        _legacy_source_type: "idea",
        id: "legacy-full-snapshot",
        title: "Preserve every field",
        description: "A full description\nwith a second line",
        metadata: { nested: { answer: 42 }, tags: ["one", "two"] },
        unicodeOrdering: { "ä": "umlaut", z: "last ASCII", a: "first ASCII" },
        discussed: false,
      };
      await database.query(`
        INSERT INTO "note_legacy_archive_items" ("id", "workspace_id", "source_type", "source_id", "snapshot")
        VALUES ('${archiveId}', 'w1', 'idea', 'legacy-full-snapshot', '${JSON.stringify(snapshot).replaceAll("'", "''")}'::jsonb)
      `);

      const converted = await repo.convertLegacy({
        ...owner,
        archiveId,
        actionId: "atomic-create-action",
      } as never);
      expect(converted.convertedPageId).toBeString();
      const page = await repo.getPage(owner, converted.convertedPageId!);
      expect(page).toEqual(expect.objectContaining({
        id: converted.convertedPageId,
        title: snapshot.title,
        kind: "page",
        parentId: null,
        visibility: "private",
      }));
      const code = (page!.lexicalJson as any).root.children.find((child: any) => child.type === "code");
      expect(JSON.parse(code.children[0].text)).toEqual(snapshot);
      expect(code.children[0].text.indexOf('"a": "first ASCII"')).toBeLessThan(
        code.children[0].text.indexOf('"z": "last ASCII"'),
      );
      expect(code.children[0].text.indexOf('"z": "last ASCII"')).toBeLessThan(
        code.children[0].text.indexOf('"ä": "umlaut"'),
      );
      const frozenLexical = structuredClone(page!.lexicalJson);

      const replay = await repo.convertLegacy({
        ...owner,
        archiveId,
        actionId: "atomic-create-action",
      } as never);
      expect(replay.convertedPageId).toBe(converted.convertedPageId);
      expect((await database.query(`SELECT id FROM note_pages`)).rows).toHaveLength(1);
      expect((await repo.getPage(owner, converted.convertedPageId!))?.lexicalJson).toEqual(frozenLexical);
      expect((await database.query<{ snapshot: typeof snapshot }>(`SELECT snapshot FROM note_legacy_archive_items WHERE id = '${archiveId}'`)).rows[0]?.snapshot).toEqual(snapshot);
    } finally {
      await database.close();
    }
  });

  it("returns exact bounded legacy summaries from convert, discard, and replay commands", async () => {
    const database = await setup();
    try {
      const repo = createNotesRepository(drizzle(database) as never);
      const owner = { workspaceId: "w1", userId: "u1" };
      const target = await repo.createPage({ ...owner, title: "Existing conversion target" });
      const convertedArchiveId = uuid(880);
      const discardedArchiveId = uuid(881);
      const hugeSnapshot = {
        title: "🧱".repeat(2_000),
        description: "📝".repeat(300_000),
        internal: { mustNeverLeaveTheRepository: true },
      };
      for (const [archiveId, sourceId] of [
        [convertedArchiveId, "bounded-convert"],
        [discardedArchiveId, "bounded-discard"],
      ]) {
        await database.query(
          `INSERT INTO note_legacy_archive_items (id, workspace_id, source_type, source_id, snapshot)
           VALUES ($1, 'w1', 'idea', $2, $3::jsonb)`,
          [archiveId, sourceId, JSON.stringify(hugeSnapshot)],
        );
      }

      const converted = await repo.convertLegacy({
        ...owner,
        archiveId: convertedArchiveId,
        pageId: target.id,
        actionId: "bounded-convert-action",
      });
      const convertedReplay = await repo.convertLegacy({
        ...owner,
        archiveId: convertedArchiveId,
        pageId: target.id,
        actionId: "bounded-convert-action",
      });
      const discarded = await repo.discardLegacy({
        ...owner,
        archiveId: discardedArchiveId,
        actionId: "bounded-discard-action",
      });
      const discardedReplay = await repo.discardLegacy({
        ...owner,
        archiveId: discardedArchiveId,
        actionId: "bounded-discard-action",
      });

      for (const summary of [converted, convertedReplay, discarded, discardedReplay]) {
        expect(Object.keys(summary).sort()).toEqual(legacySummaryKeys);
        expect(Array.from(summary.sourceTitle)).toHaveLength(500);
        expect(Array.from(summary.sourcePreview)).toHaveLength(500);
        expect(summary).not.toHaveProperty("snapshot");
        expect(summary).not.toHaveProperty("workspaceId");
        expect(summary).not.toHaveProperty("dispositionByUserId");
        expect(summary).not.toHaveProperty("dispositionByAgentJobId");
        expect(summary).not.toHaveProperty("dispositionByChannel");
        expect(summary).not.toHaveProperty("dispositionByTool");
      }
      expect(convertedReplay).toEqual(converted);
      expect(discardedReplay).toEqual(discarded);
      expect(converted.convertedPageId).toBe(target.id);
      expect(discarded.convertedPageId).toBeNull();
      expect(new TextEncoder().encode(JSON.stringify([
        converted,
        convertedReplay,
        discarded,
        discardedReplay,
      ])).byteLength).toBeLessThan(20_000);
    } finally {
      await database.close();
    }
  });

  it("rejects legacy conversion byte, depth, node, and output amplification limits while accepting the exact byte boundary", async () => {
    const database = await setup();
    try {
      const repo = createNotesRepository(drizzle(database) as never);
      const owner = { workspaceId: "w1", userId: "u1" };
      const boundaryArchiveId = uuid(882);
      const oversizedArchiveId = uuid(883);
      const deepArchiveId = uuid(884);
      const wideArchiveId = uuid(885);
      const outputArchiveId = uuid(886);
      const [{ bytes: emptySnapshotBytes }] = (await database.query<{ bytes: number }>(
        `SELECT octet_length('{"title":"Boundary","description":""}'::jsonb::text) AS bytes`,
      )).rows;
      const boundarySnapshot = {
        title: "Boundary",
        description: "x".repeat(MAX_LEGACY_CONVERSION_SNAPSHOT_BYTES - emptySnapshotBytes!),
      };
      const oversizedSnapshot = {
        title: "Boundary",
        description: `${boundarySnapshot.description}x`,
      };
      let deepSnapshot: Record<string, unknown> = { leaf: true };
      for (let depth = 0; depth <= MAX_LEGACY_CONVERSION_DEPTH; depth += 1) {
        deepSnapshot = { nested: deepSnapshot };
      }
      const wideSnapshot = Array.from({ length: MAX_LEGACY_CONVERSION_NODES }, () => 0);
      const outputAmplificationSnapshot = { controls: "\u0001".repeat(200_000) };
      for (const [archiveId, sourceId, snapshot] of [
        [boundaryArchiveId, "boundary", boundarySnapshot],
        [oversizedArchiveId, "oversized", oversizedSnapshot],
        [deepArchiveId, "deep", deepSnapshot],
        [wideArchiveId, "wide", wideSnapshot],
        [outputArchiveId, "output-amplification", outputAmplificationSnapshot],
      ] as const) {
        await database.query(
          `INSERT INTO note_legacy_archive_items (id, workspace_id, source_type, source_id, snapshot)
           VALUES ($1, 'w1', 'todo', $2, $3::jsonb)`,
          [archiveId, sourceId, JSON.stringify(snapshot)],
        );
      }
      expect((await database.query<{ bytes: number }>(
        `SELECT octet_length(snapshot::text) AS bytes FROM note_legacy_archive_items WHERE id = '${boundaryArchiveId}'`,
      )).rows[0]?.bytes).toBe(MAX_LEGACY_CONVERSION_SNAPSHOT_BYTES);

      for (const [archiveId, actionId] of [
        [oversizedArchiveId, "oversized-action"],
        [deepArchiveId, "deep-action"],
        [wideArchiveId, "wide-action"],
        [outputArchiveId, "output-action"],
      ]) {
        await expect(repo.convertLegacy({ ...owner, archiveId, actionId })).rejects.toThrow(
          "LEGACY_SNAPSHOT_TOO_LARGE",
        );
      }
      const converted = await repo.convertLegacy({
        ...owner,
        archiveId: boundaryArchiveId,
        actionId: "boundary-action",
      });
      const replay = await repo.convertLegacy({
        ...owner,
        archiveId: boundaryArchiveId,
        actionId: "boundary-action",
      });

      expect(replay).toEqual(converted);
      const page = await repo.getPage(owner, converted.convertedPageId!);
      const code = (page!.lexicalJson as any).root.children.find((child: any) => child.type === "code");
      expect(JSON.parse(code.children[0].text)).toEqual(boundarySnapshot);
      expect((await database.query<{ disposition: string }>(
        `SELECT disposition FROM note_legacy_archive_items
         WHERE id IN ('${oversizedArchiveId}', '${deepArchiveId}', '${wideArchiveId}', '${outputArchiveId}')`,
      )).rows.every((row) => row.disposition === "pending")).toBe(true);
    } finally {
      await database.close();
    }
  });

  it("rejects positions outside PostgreSQL int4 before mutating a page", async () => {
    const database = await setup();
    try {
      const repo = createNotesRepository(drizzle(database) as never);
      const owner = { workspaceId: "w1", userId: "u1" };
      await expect(repo.createPage({
        ...owner,
        title: "overflow",
        position: 2_147_483_648,
      })).rejects.toThrow("INVALID_POSITION");
      expect((await database.query("SELECT id FROM note_pages")).rows).toHaveLength(0);

      const page = await repo.createPage({
        ...owner,
        title: "maximum",
        position: 2_147_483_647,
      });
      await expect(repo.updatePage({
        ...owner,
        pageId: page.id,
        expectedStateVersion: page.stateVersion,
        position: 2_147_483_648,
      })).rejects.toThrow("INVALID_POSITION");
      expect((await repo.getPage(owner, page.id))?.position).toBe(2_147_483_647);
    } finally {
      await database.close();
    }
  });

  it("bounds collection queries and returns summary DTOs with stable pagination", async () => {
    const database = await setup();
    try {
      const repo = createNotesRepository(drizzle(database) as never);
      const owner = { workspaceId: "w1", userId: "u1" };
      const largeDocument = (label: string) => ({
        root: {
          type: "root",
          version: 1,
          children: [{ type: "paragraph", version: 1, children: [{ type: "text", version: 1, text: `${label}-${"x".repeat(8_000)}` }] }],
        },
      });
      const pages = [];
      for (let index = 0; index < 4; index += 1) {
        pages.push(await repo.createPage({
          ...owner,
          title: `Bounded ${index}`,
          position: index,
          lexicalJson: largeDocument(`page-${index}`),
        }));
      }

      const treeFirst = await repo.pageTree(owner, { limit: 2, offset: 0 } as never);
      const treeSecond = await repo.pageTree(owner, { limit: 2, offset: 2 } as never);
      expect(treeFirst.items).toHaveLength(2);
      expect(treeFirst.pagination).toEqual({ limit: 2, offset: 0, hasMore: true, nextOffset: 2 });
      expect(treeSecond.items.map((item: any) => item.id)).toEqual(pages.slice(2).map((item) => item.id));
      expect(treeFirst.items[0]).not.toHaveProperty("lexicalJson");
      expect(treeFirst.items[0]).not.toHaveProperty("markdownProjection");
      expect(treeFirst.items[0]).not.toHaveProperty("plaintextProjection");

      const search = await repo.search(owner, "Bounded", { limit: 2, offset: 0 } as never);
      expect(search.items).toHaveLength(2);
      expect(search.pagination.hasMore).toBe(true);
      expect(search.items[0]).not.toHaveProperty("lexicalJson");
      await expect(repo.search(owner, "Bounded", { limit: 101, offset: 0 } as never)).rejects.toThrow("INVALID_PAGINATION");
      await expect(repo.pageTree(owner, { limit: 2, offset: -1 } as never)).rejects.toThrow("INVALID_PAGINATION");

      const dailyIds: string[] = [];
      for (let day = 1; day <= 3; day += 1) {
        const itemId = `20000000-0000-4000-8000-${String(700 + day).padStart(12, "0")}`;
        const daily = await repo.createPage({
          ...owner,
          kind: "daily",
          dailyDate: `2026-07-0${day}`,
          title: `daily-${day}`,
          lexicalJson: { root: { type: "root", version: 1, children: [{ type: "check-listitem", version: 1, checked: false, itemId, children: [{ type: "text", version: 1, text: `carry-${day}` }] }] } },
        });
        dailyIds.push(daily.id);
      }
      const agenda = await repo.listDailyByMonth(owner, "2026-07", { limit: 2, offset: 0 } as never);
      expect(agenda.items.map((item: any) => item.id)).toEqual(dailyIds.slice(0, 2));
      expect(agenda.items[0]).not.toHaveProperty("lexicalJson");
      const carryover = await repo.listDailyCarryover({ ...owner, dailyDate: "2026-07-31" }, { limit: 2, offset: 0 } as never);
      expect(carryover.items).toHaveLength(2);
      expect(carryover.pagination.hasMore).toBe(true);

      const linkTargets = await Promise.all([0, 1, 2].map((index) => repo.createPage({ ...owner, title: `Link target ${index}` })));
      const linkSource = await repo.createPage({
        ...owner,
        title: "Link source",
        lexicalJson: { root: { type: "root", version: 1, children: linkTargets.map((target) => ({ type: "paragraph", version: 1, children: [{ type: "link", version: 1, url: `note://${target.id}`, children: [{ type: "text", version: 1, text: target.title }] }] })) } },
      });
      const links = await repo.links({ ...owner, pageId: linkSource.id }, { limit: 2, offset: 0 } as never);
      expect(links.items).toHaveLength(2);
      expect(links.pagination.hasMore).toBe(true);

      const backlinkTarget = await repo.createPage({ ...owner, title: "Backlink target" });
      for (let index = 0; index < 3; index += 1) {
        await repo.createPage({
          ...owner,
          title: `Backlink source ${index}`,
          lexicalJson: { root: { type: "root", version: 1, children: [{ type: "paragraph", version: 1, children: [{ type: "link", version: 1, url: `note://${backlinkTarget.id}`, children: [{ type: "text", version: 1, text: "target" }] }] }] } },
        });
      }
      const backlinks = await repo.backlinks({ ...owner, pageId: backlinkTarget.id }, { limit: 2, offset: 0 } as never);
      expect(backlinks.items).toHaveLength(2);
      expect(backlinks.pagination.hasMore).toBe(true);

      await database.exec(`INSERT INTO "user" VALUES ('u4'), ('u5'); INSERT INTO "member" VALUES ('m4', 'w1', 'u4'), ('m5', 'w1', 'u5');`);
      for (const sharedWithUserId of ["u2", "u4", "u5"]) {
        await repo.setShare({ ...owner, pageId: pages[0]!.id, sharedWithUserId, role: "viewer" });
      }
      const shares = await repo.listShares(owner, pages[0]!.id, { limit: 2, offset: 0 } as never);
      expect(shares?.items).toHaveLength(2);
      expect(shares?.pagination.hasMore).toBe(true);

      const legacyIds = [uuid(880), uuid(881), uuid(882)];
      await database.query(`
        INSERT INTO "note_legacy_archive_items" ("id", "workspace_id", "source_type", "source_id", "snapshot") VALUES
          ('${legacyIds[0]}', 'w1', 'todo', 'bounded-legacy-1', '{"title":"one","description":"${"z".repeat(2_000)}"}'),
          ('${legacyIds[1]}', 'w1', 'idea', 'bounded-legacy-2', '{"title":"two"}'),
          ('${legacyIds[2]}', 'w1', 'seed', 'bounded-legacy-3', '{"title":"three"}')
      `);
      await repo.discardLegacy({ ...owner, archiveId: legacyIds[0]!, actionId: "bounded-terminal" });
      const pendingLegacy = await repo.legacy(owner, { disposition: "pending", limit: 1, offset: 0 } as never);
      expect(pendingLegacy.items).toHaveLength(1);
      expect(pendingLegacy.items[0]?.disposition).toBe("pending");
      expect(pendingLegacy.pagination.hasMore).toBe(true);
      expect(pendingLegacy.items[0]).not.toHaveProperty("snapshot");
    } finally {
      await database.close();
    }
  });

  it("redacts converted targets unless the actor can currently read them", async () => {
    const database = await setup();
    try {
      const repo = createNotesRepository(drizzle(database) as never);
      const owner = { workspaceId: "w1", userId: "u1" };
      const member = { workspaceId: "w1", userId: "u2" };
      const privateTarget = await repo.createPage({ ...owner, title: "Private conversion" });
      const workspaceTarget = await repo.createPage({ ...owner, title: "Workspace conversion", visibility: "workspace" });
      const sharedParent = await repo.createPage({ ...owner, title: "Shared parent" });
      const inheritedTarget = await repo.createPage({ ...owner, title: "Inherited conversion", parentId: sharedParent.id });
      const archiveIds = [uuid(883), uuid(884), uuid(885)];
      await database.query(`
        INSERT INTO "note_legacy_archive_items" ("id", "workspace_id", "source_type", "source_id", "snapshot") VALUES
          ('${archiveIds[0]}', 'w1', 'todo', 'private-target', '{"title":"private"}'),
          ('${archiveIds[1]}', 'w1', 'idea', 'workspace-target', '{"title":"workspace"}'),
          ('${archiveIds[2]}', 'w1', 'seed', 'inherited-target', '{"title":"inherited"}')
      `);
      await repo.convertLegacy({ ...owner, archiveId: archiveIds[0]!, pageId: privateTarget.id, actionId: "private-target-action" });
      await repo.convertLegacy({ ...owner, archiveId: archiveIds[1]!, pageId: workspaceTarget.id, actionId: "workspace-target-action" });
      await repo.convertLegacy({ ...owner, archiveId: archiveIds[2]!, pageId: inheritedTarget.id, actionId: "inherited-target-action" });
      await repo.setShare({ ...owner, pageId: sharedParent.id, sharedWithUserId: member.userId, role: "viewer" });

      const initial = await repo.legacy(member, { disposition: "converted", limit: 10, offset: 0 } as never);
      expect(initial.items.find((item: any) => item.id === archiveIds[0])?.convertedPageId).toBeNull();
      expect(initial.items.find((item: any) => item.id === archiveIds[1])?.convertedPageId).toBe(workspaceTarget.id);
      expect(initial.items.find((item: any) => item.id === archiveIds[2])?.convertedPageId).toBe(inheritedTarget.id);

      await repo.setShare({ ...owner, pageId: privateTarget.id, sharedWithUserId: member.userId, role: "viewer" });
      const explicit = await repo.legacy(member, { disposition: "converted", limit: 10, offset: 0 } as never);
      expect(explicit.items.find((item: any) => item.id === archiveIds[0])?.convertedPageId).toBe(privateTarget.id);
      await repo.removeShare({ ...owner, pageId: privateTarget.id, sharedWithUserId: member.userId });
      const revokedShare = await repo.legacy(member, { disposition: "converted", limit: 10, offset: 0 } as never);
      expect(revokedShare.items.find((item: any) => item.id === archiveIds[0])?.convertedPageId).toBeNull();

      await database.exec(`DELETE FROM "member" WHERE "workspace_id" = 'w1' AND "user_id" = 'u2'`);
      expect((await repo.legacy(member, { disposition: "converted", limit: 10, offset: 0 } as never)).items).toEqual([]);
    } finally {
      await database.close();
    }
  });

  it("bounds search reads and exposes owner-only share and archived-page reads", async () => {
    const database = await setup();
    try {
      const repo = createNotesRepository(drizzle(database) as never);
      const owner = { workspaceId: "w1", userId: "u1" };
      const otherMember = { workspaceId: "w1", userId: "u2" };
      const first = await repo.createPage({ ...owner, title: "Bounded match one" });
      await repo.createPage({ ...owner, title: "Bounded match two" });
      await repo.createPage({ ...owner, title: "Bounded match three" });
      await repo.setShare({
        ...owner,
        pageId: first.id,
        sharedWithUserId: otherMember.userId,
        role: "editor",
      });

      expect((await repo.search(owner, "Bounded match", { limit: 2 })).items.map((page) => page.title)).toEqual([
        "Bounded match three",
        "Bounded match two",
      ]);
      expect(await repo.listShares(otherMember, first.id)).toBeNull();
      expect((await repo.listShares(owner, first.id))?.items).toEqual([
        expect.objectContaining({
          pageId: first.id,
          sharedWithUserId: otherMember.userId,
          role: "editor",
        }),
      ]);

      const archived = await repo.updatePage({
        ...owner,
        pageId: first.id,
        expectedStateVersion: first.stateVersion,
        archivedAt: new Date("2026-08-11T00:00:00.000Z"),
      });
      expect(await repo.getPage(owner, first.id)).toBeNull();
      expect((await repo.getOwnedPageIncludingArchived(owner, first.id))?.id).toBe(first.id);
      expect(await repo.getOwnedPageIncludingArchived(otherMember, first.id)).toBeNull();
      expect((await repo.getOwnedPageIncludingArchived(owner, first.id))?.stateVersion).toBe(
        archived?.stateVersion,
      );
    } finally {
      await database.close();
    }
  });

  it("hides private pages, inherits ancestor shares, and rejects CAS conflicts", async () => {
    const database = await setup();
    try {
      const repo = createNotesRepository(drizzle(database) as never);
      const owner = { workspaceId: "w1", userId: "u1" };
      const viewer = { workspaceId: "w1", userId: "u2" };
      const root = await repo.createPage({ ...owner, title: "Root", visibility: "private" });
      const child = await repo.createPage({ ...owner, parentId: root.id, title: "Child", visibility: "private" });
      expect(await repo.getPage(viewer, root.id)).toBeNull();
      await repo.setShare({ ...owner, pageId: root.id, sharedWithUserId: "u2", role: "viewer" });
      expect((await repo.getPage(viewer, child.id))?.id).toBe(child.id);
      expect(await repo.updatePage({ ...viewer, pageId: child.id, expectedStateVersion: child.stateVersion, title: "blocked" })).toBeNull();
      expect(await repo.updatePage({ ...owner, pageId: child.id, expectedStateVersion: child.stateVersion - 1, title: "conflict" })).toBeNull();
      const workspaceRoot = await repo.createPage({ ...owner, visibility: "workspace", title: "Workspace root" });
      const workspaceChild = await repo.createPage({ ...owner, parentId: workspaceRoot.id, title: "Private child" });
      expect((await repo.getPage(viewer, workspaceChild.id))?.id).toBe(workspaceChild.id);
      expect(await repo.updatePage({ ...viewer, pageId: workspaceChild.id, expectedStateVersion: workspaceChild.stateVersion, title: "still blocked" })).toBeNull();
      await expect(repo.reparent({ ...owner, pageId: workspaceRoot.id, parentId: workspaceChild.id, expectedStateVersion: workspaceRoot.stateVersion })).rejects.toThrow("NOTE_PAGE_CYCLE");
    } finally {
      await database.close();
    }
  });

  it("allows editors to edit content but reserves visibility and archive controls to owners", async () => {
    const database = await setup();
    try {
      const repo = createNotesRepository(drizzle(database) as never);
      const owner = { workspaceId: "w1", userId: "u1" };
      const editor = { workspaceId: "w1", userId: "u2" };
      const root = await repo.createPage({ ...owner, title: "Root" });
      const child = await repo.createPage({ ...owner, parentId: root.id, title: "Child" });
      await repo.setShare({ ...owner, pageId: root.id, sharedWithUserId: "u2", role: "editor" });
      expect((await repo.updatePage({ ...editor, pageId: root.id, expectedStateVersion: root.stateVersion, title: "Edited" }))?.title).toBe("Edited");
      const rootEdited = await repo.getPage(owner, root.id);
      expect(await repo.updatePage({ ...editor, pageId: root.id, expectedStateVersion: rootEdited!.stateVersion, visibility: "workspace" })).toBeNull();
      expect(await repo.updatePage({ ...editor, pageId: root.id, expectedStateVersion: rootEdited!.stateVersion, archivedAt: new Date() })).toBeNull();
      expect((await repo.updatePage({ ...editor, pageId: child.id, expectedStateVersion: child.stateVersion, title: "Inherited edit" }))?.title).toBe("Inherited edit");
      const childEdited = await repo.getPage(owner, child.id);
      expect(await repo.updatePage({ ...editor, pageId: child.id, expectedStateVersion: childEdited!.stateVersion, visibility: "workspace" })).toBeNull();
      expect(await repo.updatePage({ ...editor, pageId: child.id, expectedStateVersion: childEdited!.stateVersion, archivedAt: new Date() })).toBeNull();
      const archived = await repo.updatePage({ ...owner, pageId: child.id, expectedStateVersion: childEdited!.stateVersion, archivedAt: new Date() });
      expect(archived?.archivedAt).not.toBeNull();
      expect(await repo.getPage(owner, child.id)).toBeNull();
      const unarchived = await repo.updatePage({ ...owner, pageId: child.id, expectedStateVersion: archived!.stateVersion, archivedAt: null });
      expect(unarchived?.archivedAt).toBeNull();
    } finally {
      await database.close();
    }
  });

  it("fails closed when a non-transaction-capable database handle is supplied", async () => {
    await expect(createNotePage({ workspaceId: "w1", userId: "u1" }, {} as never)).rejects.toThrow("TRANSACTION_REQUIRED");
  });

  it("derives trusted agent provenance and completion attribution from actorKind", async () => {
    const database = await setup();
    try {
      const repo = createNotesRepository(drizzle(database) as never);
      const agent = { workspaceId: "w1", userId: "u1", actorKind: "agent" as const, agentJobId: "50000000-0000-4000-8000-000000000001", channel: "runner", tool: "notes" };
      const page = await repo.createPage({ ...agent, lexicalJson: { root: { type: "root", version: 1, children: [{ type: "check-listitem", version: 1, checked: false, itemId: "55555555-5555-4555-8555-555555555555", children: [{ type: "text", version: 1, text: "agent item" }] }] } } });
      expect(page.provenance).toBe("agent");
      expect(page.createdByKind).toBe("agent");
      const item = await repo.updateChecklistItem({ ...agent, pageId: page.id, itemId: "55555555-5555-4555-8555-555555555555", checked: true, expectedStateVersion: page.stateVersion });
      expect(item?.completedByKind).toBe("agent");
      expect(item?.completedByUserId).toBe("u1");
      expect(item?.completedByAgentJobId).toBe(agent.agentJobId);
      await expect(repo.createPage({ workspaceId: "w1", userId: "u1", actorKind: "agent" })).rejects.toThrow("AGENT_JOB_REQUIRED");
      await expect(repo.updateChecklistItem({ ...agent, actorKind: "system" as never, pageId: page.id, itemId: "55555555-5555-4555-8555-555555555555", checked: false, expectedStateVersion: page.stateVersion })).rejects.toThrow("ACTOR_CONTRACT_INVALID");
      await expect(repo.removeShare({ workspaceId: "w1", userId: "u1", actorKind: "system" as never, pageId: page.id, sharedWithUserId: "u2" })).rejects.toThrow("ACTOR_CONTRACT_INVALID");
    } finally {
      await database.close();
    }
  });

  it("keeps daily pages unique and prevents cross-workspace parents", async () => {
    const database = await setup();
    try {
      const repo = createNotesRepository(drizzle(database) as never);
      const owner = { workspaceId: "w1", userId: "u1" };
      const first = await repo.getOrCreateDaily(owner, "2026-08-09");
      const second = await repo.getOrCreateDaily(owner, "2026-08-09");
      expect(second.id).toBe(first.id);
      const otherOwner = await repo.getOrCreateDaily({ workspaceId: "w1", userId: "u2" }, "2026-08-09");
      expect(otherOwner.id).not.toBe(first.id);
      await expect(repo.createPage({ workspaceId: "w1", userId: "u1", ownerUserId: "u2", title: "delegated" })).rejects.toThrow("OWNER_MUST_MATCH_ACTOR");
      await expect(repo.createPage({ workspaceId: "w1", userId: "u1", ownerUserId: "u2", kind: "daily", dailyDate: "2026-08-10" })).rejects.toThrow("OWNER_MUST_MATCH_ACTOR");
      const foreign = await repo.createPage({ workspaceId: "w2", userId: "u3", title: "foreign" });
      await expect(repo.createPage({ ...owner, parentId: foreign.id, title: "invalid" })).rejects.toThrow("PARENT_NOT_FOUND");
    } finally {
      await database.close();
    }
  });

  it("scopes monthly Agenda results to the requesting owner", async () => {
    const database = await setup();
    try {
      const repo = createNotesRepository(drizzle(database) as never);
      const owner = { workspaceId: "w1", userId: "u1" };
      const other = { workspaceId: "w1", userId: "u2" };
      const own = await repo.getOrCreateDaily(owner, "2026-08-10");
      const shared = await repo.getOrCreateDaily(other, "2026-08-11");
      await repo.setShare({ ...other, pageId: shared.id, sharedWithUserId: owner.userId, role: "viewer" });
      expect((await repo.listDailyByMonth(owner, "2026-08" )).items.map((page) => page.id)).toEqual([own.id]);

      const lowYear = await repo.getOrCreateDaily(owner, "0099-12-15");
      await repo.getOrCreateDaily(owner, "0100-01-01");
      expect((await repo.listDailyByMonth(owner, "0099-12")).items.map((page) => page.id)).toEqual([
        lowYear.id,
      ]);
    } finally {
      await database.close();
    }
  });

  it("authorizes checklist no-op requests before returning the existing audit row", async () => {
    const database = await setup();
    try {
      const repo = createNotesRepository(drizzle(database) as never);
      const owner = { workspaceId: "w1", userId: "u1" };
      const viewer = { workspaceId: "w1", userId: "u2" };
      const itemId = "20000000-0000-4000-8000-000000000077";
      const page = await repo.createPage({ ...owner, visibility: "workspace", lexicalJson: { root: { type: "root", version: 1, children: [{ type: "check-listitem", version: 1, checked: false, itemId, children: [{ type: "text", version: 1, text: "no-op" }] }] } } });
      const result = await repo.updateChecklistItem({ ...viewer, pageId: page.id, itemId, checked: false, expectedStateVersion: page.stateVersion });
      expect(result).toBeNull();
      await repo.setShare({ ...owner, pageId: page.id, sharedWithUserId: viewer.userId, role: "editor" });
      const editorResult = await repo.updateChecklistItem({ ...viewer, pageId: page.id, itemId, checked: false, expectedStateVersion: page.stateVersion });
      expect(editorResult?.itemId).toBe(itemId);
      expect(await repo.updateChecklistItem({ ...viewer, pageId: page.id, itemId, checked: false, expectedStateVersion: page.stateVersion - 1 })).toBeNull();
      await repo.removeShare({ ...owner, pageId: page.id, sharedWithUserId: viewer.userId });
      expect(await repo.updateChecklistItem({ ...viewer, pageId: page.id, itemId, checked: false, expectedStateVersion: page.stateVersion })).toBeNull();
    } finally {
      await database.close();
    }
  });

  it("reconciles checklist ordinal swaps and insertion at zero without collisions", async () => {
    const database = await setup();
    try {
      const repo = createNotesRepository(drizzle(database) as never);
      const owner = { workspaceId: "w1", userId: "u1" };
      const firstId = "20000000-0000-4000-8000-000000000081";
      const secondId = "20000000-0000-4000-8000-000000000082";
      const thirdId = "20000000-0000-4000-8000-000000000083";
      const doc = (ids: string[], labels = ids.map((_, index) => `item-${index}`)) => ({ root: { type: "root", version: 1, children: ids.map((itemId, index) => ({ type: "check-listitem", version: 1, checked: false, itemId, children: [{ type: "text", version: 1, text: labels[index] }] })) } });
      const page = await repo.createPage({ ...owner, lexicalJson: doc([firstId, secondId]) });
      const identical = await repo.updatePage({ ...owner, pageId: page.id, expectedStateVersion: page.stateVersion, lexicalJson: doc([firstId, secondId]) });
      const identicalRows = await database.query<{ item_id: string; ordinal: number }>(`SELECT item_id, ordinal FROM note_checklist_items WHERE page_id = '${page.id}' ORDER BY ordinal`);
      expect(identicalRows.rows).toEqual([{ item_id: firstId, ordinal: 0 }, { item_id: secondId, ordinal: 1 }]);
      const partial = await repo.updatePage({ ...owner, pageId: page.id, expectedStateVersion: identical!.stateVersion, lexicalJson: doc([firstId, secondId], ["changed", "item-1"]) });
      const partialRows = await database.query<{ item_id: string; ordinal: number }>(`SELECT item_id, ordinal FROM note_checklist_items WHERE page_id = '${page.id}' ORDER BY ordinal`);
      expect(partialRows.rows).toEqual([{ item_id: firstId, ordinal: 0 }, { item_id: secondId, ordinal: 1 }]);
      const swapped = await repo.updatePage({ ...owner, pageId: page.id, expectedStateVersion: partial!.stateVersion, lexicalJson: doc([secondId, firstId]) });
      expect(swapped).not.toBeNull();
      const inserted = await repo.updatePage({ ...owner, pageId: page.id, expectedStateVersion: swapped!.stateVersion, lexicalJson: doc([thirdId, secondId, firstId]) });
      expect(inserted).not.toBeNull();
      const rows = await database.query<{ item_id: string; ordinal: number }>(`SELECT item_id, ordinal FROM note_checklist_items WHERE page_id = '${page.id}' ORDER BY ordinal`);
      expect(rows.rows).toEqual([{ item_id: thirdId, ordinal: 0 }, { item_id: secondId, ordinal: 1 }, { item_id: firstId, ordinal: 2 }]);
      expect((inserted!.lexicalJson as any).root.children.map((node: any) => node.itemId)).toEqual([thirdId, secondId, firstId]);
    } finally {
      await database.close();
    }
  });

  it("reserves direct and inherited reparent ACL mutations to owners without disclosing destinations", async () => {
    const database = await setup();
    try {
      const repo = createNotesRepository(drizzle(database) as never);
      const owner = { workspaceId: "w1", userId: "u1" };
      const editor = { workspaceId: "w1", userId: "u2" };
      const source = await repo.createPage({ ...owner, title: "Source" });
      const destination = await repo.createPage({ ...owner, title: "Destination" });
      const sharedAncestor = await repo.createPage({ ...owner, title: "Shared ancestor" });
      const inheritedSource = await repo.createPage({ ...owner, parentId: sharedAncestor.id, title: "Inherited source" });
      await repo.setShare({ ...owner, pageId: source.id, sharedWithUserId: editor.userId, role: "editor" });
      await repo.setShare({ ...owner, pageId: destination.id, sharedWithUserId: editor.userId, role: "editor" });
      await repo.setShare({ ...owner, pageId: sharedAncestor.id, sharedWithUserId: editor.userId, role: "editor" });

      const directEdit = await repo.updatePage({ ...editor, pageId: source.id, expectedStateVersion: source.stateVersion, title: "Direct content edit" });
      const inheritedEdit = await repo.updatePage({ ...editor, pageId: inheritedSource.id, expectedStateVersion: inheritedSource.stateVersion, title: "Inherited content edit" });
      expect(directEdit?.title).toBe("Direct content edit");
      expect(inheritedEdit?.title).toBe("Inherited content edit");

      expect(await repo.reparent({ ...editor, pageId: source.id, parentId: destination.id, expectedStateVersion: directEdit!.stateVersion })).toBeNull();
      expect(await repo.reparent({ ...editor, pageId: inheritedSource.id, parentId: destination.id, expectedStateVersion: inheritedEdit!.stateVersion })).toBeNull();
      await expect(repo.reparent({ ...editor, pageId: source.id, parentId: uuid(999), expectedStateVersion: directEdit!.stateVersion })).resolves.toBeNull();

      const movedDirect = await repo.reparent({ ...owner, pageId: source.id, parentId: destination.id, expectedStateVersion: directEdit!.stateVersion });
      const movedInherited = await repo.reparent({ ...owner, pageId: inheritedSource.id, parentId: destination.id, expectedStateVersion: inheritedEdit!.stateVersion });
      expect(movedDirect?.parentId).toBe(destination.id);
      expect(movedInherited?.parentId).toBe(destination.id);
    } finally {
      await database.close();
    }
  });

  it("preserves agent updater provenance on user-created pages and checklist changes", async () => {
    const database = await setup();
    try {
      const repo = createNotesRepository(drizzle(database) as never);
      const user = { workspaceId: "w1", userId: "u1" };
      const agent = { workspaceId: "w1", userId: "u1", actorKind: "agent" as const, agentJobId: "50000000-0000-4000-8000-000000000001" };
      const itemId = "20000000-0000-4000-8000-000000000078";
      const page = await repo.createPage({ ...user, lexicalJson: { root: { type: "root", version: 1, children: [{ type: "check-listitem", version: 1, checked: false, itemId, children: [{ type: "text", version: 1, text: "audit" }] }] } } });
      const updated = await repo.updatePage({ ...agent, pageId: page.id, expectedStateVersion: page.stateVersion, title: "agent edit" });
      expect(updated?.updatedByKind).toBe("agent");
      expect(updated?.updatedByAgentJobId).toBe(agent.agentJobId);
      const item = await repo.updateChecklistItem({ ...agent, pageId: page.id, itemId, checked: true, expectedStateVersion: updated!.stateVersion });
      expect(item?.updatedByKind).toBe("agent");
      expect(item?.updatedByAgentJobId).toBe(agent.agentJobId);
    } finally {
      await database.close();
    }
  });

  it("rejects null Lexical content instead of treating it as omitted", async () => {
    const database = await setup();
    try {
      const repo = createNotesRepository(drizzle(database) as never);
      await expect(repo.createPage({ workspaceId: "w1", userId: "u1", lexicalJson: null as never })).rejects.toThrow("Invalid Lexical document");
      const page = await repo.createPage({ workspaceId: "w1", userId: "u1", title: "non-null" });
      await expect(repo.updatePage({ workspaceId: "w1", userId: "u1", pageId: page.id, expectedStateVersion: page.stateVersion, lexicalJson: null as never })).rejects.toThrow("Invalid Lexical document");
      const unchanged = await repo.getPage({ workspaceId: "w1", userId: "u1" }, page.id);
      expect(unchanged?.stateVersion).toBe(page.stateVersion);
      expect(unchanged?.lexicalJson).toEqual(page.lexicalJson);
    } finally {
      await database.close();
    }
  });

  it("stores one immutable Lexical snapshot rather than a caller-owned object", async () => {
    const database = await setup();
    try {
      const lexical: any = { root: { type: "root", children: [{ type: "paragraph", children: [{ type: "text", text: "before" }] }] } };
      const page = await createNotesRepository(drizzle(database) as never).createPage({ workspaceId: "w1", userId: "u1", lexicalJson: lexical });
      lexical.root.children[0].children[0].text = "after";
      expect((page.lexicalJson as any).root.children[0].children[0].text).toBe("before");
    } finally {
      await database.close();
    }
  });

  it("snapshots Lexical input before a blocked transaction can observe caller mutation", async () => {
    const database = await setup();
    try {
      const root = drizzle(database) as any;
      let release!: () => void;
      const blocked = new Promise<void>((resolve) => { release = resolve; });
      const wrapped = {
        transaction: (callback: (transaction: any) => Promise<unknown>) => root.transaction(async (transaction: any) => {
          await blocked;
          return callback(transaction);
        }),
      };
      const lexical: any = { root: { type: "root", version: 1, children: [{ type: "paragraph", children: [{ type: "text", text: "before lock" }] }] } };
      const pending = createNotesRepository(wrapped as never).createPage({ workspaceId: "w1", userId: "u1", lexicalJson: lexical });
      lexical.root.children[0].children[0].text = "after lock";
      release();
      const page = await pending;
      expect((page.lexicalJson as any).root.children[0].children[0].text).toBe("before lock");
      expect(page.plaintextProjection).toContain("before lock");
      expect(page.plaintextProjection).not.toContain("after lock");
    } finally {
      await database.close();
    }
  });

  it("snapshots update optional-field presence before a blocked transaction", async () => {
    const database = await setup();
    try {
      const root = drizzle(database) as any;
      const repo = createNotesRepository(root);
      const page = await repo.createPage({ workspaceId: "w1", userId: "u1" });
      const document = { root: { type: "root", version: 1, children: [{ type: "paragraph", children: [{ type: "text", text: "captured document" }] }] } };
      let release!: () => void;
      const blocked = new Promise<void>((resolve) => { release = resolve; });
      const wrapped = { transaction: (callback: (transaction: any) => Promise<unknown>) => root.transaction(async (transaction: any) => { await blocked; return callback(transaction); }) };
      const input: any = { workspaceId: "w1", userId: "u1", pageId: page.id, expectedStateVersion: page.stateVersion, lexicalJson: document };
      const pending = createNotesRepository(wrapped as never).updatePage(input);
      input.lexicalJson = undefined;
      release();
      const updated = await pending;
      expect((updated?.lexicalJson as any).root.children[0].children[0].text).toBe("captured document");

      const nextDocument = { root: { type: "root", version: 1, children: [{ type: "paragraph", children: [{ type: "text", text: "captured replacement" }] }] } };
      let releaseSecond!: () => void;
      const blockedSecond = new Promise<void>((resolve) => { releaseSecond = resolve; });
      const wrappedSecond = { transaction: (callback: (transaction: any) => Promise<unknown>) => root.transaction(async (transaction: any) => { await blockedSecond; return callback(transaction); }) };
      const secondInput: any = { workspaceId: "w1", userId: "u1", pageId: page.id, expectedStateVersion: updated!.stateVersion, lexicalJson: nextDocument };
      const pendingSecond = createNotesRepository(wrappedSecond as never).updatePage(secondInput);
      secondInput.lexicalJson = undefined;
      releaseSecond();
      const replaced = await pendingSecond;
      expect((replaced?.lexicalJson as any).root.children[0].children[0].text).toBe("captured replacement");
    } finally {
      await database.close();
    }
  });

  it("snapshots share authorization fields before a blocked transaction", async () => {
    const database = await setup();
    try {
      const root = drizzle(database) as any;
      const owner = { workspaceId: "w1", userId: "u1" };
      const pageA = await createNotesRepository(root).createPage({ ...owner, title: "A" });
      const pageB = await createNotesRepository(root).createPage({ ...owner, title: "B" });
      let release!: () => void;
      const blocked = new Promise<void>((resolve) => { release = resolve; });
      const wrapped = { transaction: (callback: (transaction: any) => Promise<unknown>) => root.transaction(async (transaction: any) => { await blocked; return callback(transaction); }) };
      const input: any = { ...owner, pageId: pageA.id, sharedWithUserId: "u2", role: "viewer" };
      const pending = createNotesRepository(wrapped as never).setShare(input);
      input.pageId = pageB.id;
      input.sharedWithUserId = "u1";
      release();
      await pending;
      expect((await createNotesRepository(root).getPage({ workspaceId: "w1", userId: "u2" }, pageA.id))?.id).toBe(pageA.id);
      expect(await createNotesRepository(root).getPage({ workspaceId: "w1", userId: "u2" }, pageB.id)).toBeNull();
      expect((await database.query(`SELECT page_id, shared_with_user_id FROM note_page_shares WHERE workspace_id = 'w1' ORDER BY page_id`)).rows).toEqual([{ page_id: pageA.id, shared_with_user_id: "u2" }]);
    } finally {
      await database.close();
    }
  });

  it("treats explicit undefined lexicalJson as no content change", async () => {
    const database = await setup();
    try {
      const repo = createNotesRepository(drizzle(database) as never);
      const owner = { workspaceId: "w1", userId: "u1" };
      const document = { root: { type: "root", version: 1, children: [{ type: "paragraph", children: [{ type: "text", text: "keep" }] }] } };
      const page = await repo.createPage({ ...owner, lexicalJson: document });
      const updated = await repo.updatePage({ ...owner, pageId: page.id, expectedStateVersion: page.stateVersion, lexicalJson: undefined });
      expect(updated?.stateVersion).toBe(page.stateVersion);
      expect(updated?.lexicalJson).toEqual(page.lexicalJson);
      expect(updated?.markdownProjection).toBe(page.markdownProjection);
      expect(updated?.plaintextProjection).toBe(page.plaintextProjection);
    } finally {
      await database.close();
    }
  });

  it("reads lexicalJson exactly once at invocation", async () => {
    const database = await setup();
    try {
      const repo = createNotesRepository(drizzle(database) as never);
      const owner = { workspaceId: "w1", userId: "u1" };
      const original = { root: { type: "root", version: 1, children: [{ type: "paragraph", children: [{ type: "text", text: "first read" }] }] } };
      const page = await repo.createPage({ ...owner });
      let reads = 0;
      const input: any = { ...owner, pageId: page.id, expectedStateVersion: page.stateVersion };
      Object.defineProperty(input, "lexicalJson", { enumerable: true, get: () => (++reads === 1 ? original : undefined) });
      const updated = await repo.updatePage(input);
      expect(reads).toBe(1);
      expect((updated?.lexicalJson as any).root.children[0].children[0].text).toBe("first read");
    } finally {
      await database.close();
    }
  });

  it("clones structured values before later getters can mutate them", async () => {
    const database = await setup();
    try {
      const root = drizzle(database) as any;
      const repo = createNotesRepository(root);
      const owner = { workspaceId: "w1", userId: "u1" };
      const page = await repo.createPage({ ...owner });
      const lexical: any = { root: { type: "root", version: 1, children: [{ type: "paragraph", children: [{ type: "text", text: "before" }] }] } };
      const input: any = { ...owner, pageId: page.id, expectedStateVersion: page.stateVersion, lexicalJson: lexical };
      Object.defineProperty(input, "title", { enumerable: true, get: () => { lexical.root.children[0].children[0].text = "mutated"; return "captured title"; } });
      const updated = await repo.updatePage(input);
      expect((updated?.lexicalJson as any).root.children[0].children[0].text).toBe("before");
      expect(updated?.title).toBe("captured title");

      const archivedAt = new Date("2026-08-10T00:00:00Z");
      let release!: () => void;
      const blocked = new Promise<void>((resolve) => { release = resolve; });
      const wrapped = { transaction: (callback: (transaction: any) => Promise<unknown>) => root.transaction(async (transaction: any) => { await blocked; return callback(transaction); }) };
      const archiveInput: any = { ...owner, pageId: page.id, expectedStateVersion: updated!.stateVersion, archivedAt };
      const pending = createNotesRepository(wrapped as never).updatePage(archiveInput);
      archivedAt.setTime(Date.parse("2027-08-10T00:00:00Z"));
      release();
      const archived = await pending;
      expect(archived?.archivedAt?.toISOString()).toBe("2026-08-10T00:00:00.000Z");
    } finally {
      await database.close();
    }
  });

  it("keeps workspace visibility read-only and revokes every access path when membership ends", async () => {
    const database = await setup();
    try {
      const repo = createNotesRepository(drizzle(database) as never);
      const owner = { workspaceId: "w1", userId: "u1" };
      const member = { workspaceId: "w1", userId: "u2" };
      const page = await repo.createPage({ ...owner, visibility: "workspace", title: "Shared" });
      expect(await repo.updatePage({ ...member, pageId: page.id, expectedStateVersion: page.stateVersion, title: "must fail" })).toBeNull();
      await repo.setShare({ ...owner, pageId: page.id, sharedWithUserId: "u2", role: "editor" });
      expect((await repo.updatePage({ ...member, pageId: page.id, expectedStateVersion: page.stateVersion, title: "edited" }))?.title).toBe("edited");
      await database.exec(`DELETE FROM "member" WHERE "workspace_id" = 'w1' AND "user_id" = 'u2'`);
      expect((await repo.getPage(owner, page.id))?.id).toBe(page.id);
      expect(await repo.getPage(member, page.id)).toBeNull();
      expect((await repo.search(member, "edited")).items).toEqual([]);
    } finally {
      await database.close();
    }
  });

  it("rejects cross-page checklist UUID reuse and rolls back projections on link failure", async () => {
    const database = await setup();
    try {
      const repo = createNotesRepository(drizzle(database) as never);
      const itemId = "20000000-0000-4000-8000-000000000099";
      const lexical = { root: { type: "root", version: 1, children: [{ type: "check-listitem", version: 1, checked: false, itemId, children: [{ type: "text", version: 1, text: "one" }] }] } };
      const first = await repo.createPage({ workspaceId: "w1", userId: "u1", lexicalJson: lexical });
      await expect(repo.createPage({ workspaceId: "w1", userId: "u1", lexicalJson: lexical })).rejects.toThrow("CHECKLIST_ITEM_ID_REUSED");
      const foreign = await repo.createPage({ workspaceId: "w2", userId: "u3", title: "Foreign" });
      await expect(repo.updatePage({ workspaceId: "w1", userId: "u1", pageId: first.id, expectedStateVersion: first.stateVersion, title: "should rollback", lexicalJson: { root: { type: "root", version: 1, children: [{ type: "paragraph", version: 1, children: [{ type: "link", version: 1, url: `note://${foreign.id}`, children: [{ type: "text", version: 1, text: "foreign" }] }] }] } } })).rejects.toThrow("NOTE_LINK_TARGET_NOT_FOUND");
      const after = await repo.getPage({ workspaceId: "w1", userId: "u1" }, first.id);
      expect(after?.title).toBe("");
      expect(after?.stateVersion).toBe(first.stateVersion);
      expect(after?.markdownProjection).toContain("one");

      const target = await repo.createPage({ workspaceId: "w1", userId: "u1", title: "Target" });
      await database.exec(`
        CREATE FUNCTION public.notes_test_projection_failure() RETURNS trigger
        LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
        BEGIN RAISE EXCEPTION 'NOTES_TEST_PROJECTION_FAILURE'; END;
        $$;
        CREATE TRIGGER notes_test_projection_failure_trigger
        AFTER INSERT ON public.note_page_links FOR EACH ROW
        EXECUTE FUNCTION public.notes_test_projection_failure();
      `);
      try {
        let failure: unknown;
        try {
          await repo.updatePage({ workspaceId: "w1", userId: "u1", pageId: first.id, expectedStateVersion: first.stateVersion, title: "must rollback", lexicalJson: { root: { type: "root", version: 1, children: [{ type: "paragraph", version: 1, children: [{ type: "link", version: 1, url: `note://${target.id}`, children: [{ type: "text", version: 1, text: "target" }] }] }] } } });
        } catch (error) {
          failure = error;
        }
        expect(String((failure as { cause?: { message?: string } } | undefined)?.cause?.message ?? failure)).toContain("NOTES_TEST_PROJECTION_FAILURE");
      } finally {
        await database.exec(`DROP TRIGGER notes_test_projection_failure_trigger ON public.note_page_links; DROP FUNCTION public.notes_test_projection_failure();`);
      }
      const rolledBack = await repo.getPage({ workspaceId: "w1", userId: "u1" }, first.id);
      expect(rolledBack?.title).toBe("");
      expect(rolledBack?.stateVersion).toBe(first.stateVersion);
      expect((await database.query(`SELECT 1 FROM note_page_links WHERE source_page_id = '${first.id}'`)).rows).toHaveLength(0);
    } finally {
      await database.close();
    }
  });

  it("returns daily carryover with source identity and records completion provenance", async () => {
    const database = await setup();
    try {
      const repo = createNotesRepository(drizzle(database) as never);
      const itemId = "20000000-0000-4000-8000-000000000088";
      const source = await repo.createPage({ workspaceId: "w1", userId: "u1", kind: "daily", dailyDate: "2026-08-08", lexicalJson: { root: { type: "root", version: 1, children: [{ type: "check-listitem", version: 1, checked: false, itemId, children: [{ type: "text", version: 1, text: "carry me" }] }] } } });
      const carry = await repo.dailyCarryover({ workspaceId: "w1", userId: "u1", dailyDate: "2026-08-09" });
      expect(carry.items).toEqual([{ sourcePageId: source.id, sourceStateVersion: source.stateVersion, sourceDate: "2026-08-08", itemId, ordinal: 0, text: "carry me", checked: false }]);
      const item = await repo.updateCarryoverItem({ workspaceId: "w1", userId: "u1", sourcePageId: source.id, itemId, checked: true, expectedStateVersion: source.stateVersion });
      expect(item?.completedByUserId).toBe("u1");
      const after = await repo.getPage({ workspaceId: "w1", userId: "u1" }, source.id);
      expect((after?.lexicalJson as any).root.children[0].checked).toBe(true);
    } finally {
      await database.close();
    }
  });

  it("reads carryover sourcePageId once before updating the original page", async () => {
    const database = await setup();
    try {
      const repo = createNotesRepository(drizzle(database) as never);
      const owner = { workspaceId: "w1", userId: "u1" };
      const itemId = "20000000-0000-4000-8000-000000000091";
      const source = await repo.getOrCreateDaily(owner, "2026-08-08");
      const populated = await repo.updatePage({ ...owner, pageId: source.id, expectedStateVersion: source.stateVersion, lexicalJson: { root: { type: "root", children: [{ type: "check-listitem", itemId, checked: false, children: [{ type: "text", text: "source" }] }] } } });
      let reads = 0;
      const input: any = { ...owner, itemId, checked: true, expectedStateVersion: populated!.stateVersion };
      Object.defineProperty(input, "sourcePageId", { enumerable: true, get: () => (++reads === 1 ? source.id : "00000000-0000-4000-8000-000000000000") });
      const updated = await repo.updateCarryoverItem(input);
      expect(reads).toBe(1);
      expect(updated?.checked).toBe(true);
      expect((await repo.getPage(owner, source.id))?.id).toBe(source.id);
    } finally {
      await database.close();
    }
  });

  it("updates the original Lexical page when completing a checklist item", async () => {
    const database = await setup();
    try {
      const repo = createNotesRepository(drizzle(database) as never);
      const page = await repo.createPage({
        workspaceId: "w1",
        userId: "u1",
        lexicalJson: {
          root: {
            type: "root",
            version: 1,
            children: [{
              type: "check-listitem",
              version: 1,
              checked: false,
              itemId: "20000000-0000-4000-8000-000000000001",
              children: [{ type: "text", version: 1, text: "carry" }],
            }],
          },
        },
      });
      const item = await repo.updateChecklistItem({ workspaceId: "w1", userId: "u1", pageId: page.id, itemId: "20000000-0000-4000-8000-000000000001", checked: true, expectedStateVersion: page.stateVersion });
      expect(item?.checked).toBe(true);
      const updated = await repo.getPage({ workspaceId: "w1", userId: "u1" }, page.id);
      expect((updated?.lexicalJson as any).root.children[0].checked).toBe(true);
      expect(updated?.markdownProjection).toContain("[x]");
      const firstAudit = await database.query<{ completed_at: string; completed_by_user_id: string; updated_at: string }>(`SELECT completed_at, completed_by_user_id, updated_at FROM note_checklist_items WHERE item_id = '20000000-0000-4000-8000-000000000001'`);
      const second = await repo.updatePage({ workspaceId: "w1", userId: "u1", pageId: page.id, expectedStateVersion: updated!.stateVersion, lexicalJson: updated!.lexicalJson as any });
      const secondAudit = await database.query<{ completed_at: string; completed_by_user_id: string; updated_at: string }>(`SELECT completed_at, completed_by_user_id, updated_at FROM note_checklist_items WHERE item_id = '20000000-0000-4000-8000-000000000001'`);
      expect(new Date(secondAudit.rows[0]!.completed_at).toISOString()).toBe(new Date(firstAudit.rows[0]!.completed_at).toISOString());
      expect(secondAudit.rows[0]?.completed_by_user_id).toBe(firstAudit.rows[0]?.completed_by_user_id);
      expect(new Date(secondAudit.rows[0]!.updated_at).toISOString()).toBe(new Date(firstAudit.rows[0]!.updated_at).toISOString());
    } finally {
      await database.close();
    }
  });

  it("does not allow archived daily pages to create duplicate agenda identity", async () => {
    const database = await setup();
    try {
      const repo = createNotesRepository(drizzle(database) as never);
      const actor = { workspaceId: "w1", userId: "u1" };
      const daily = await repo.getOrCreateDaily(actor, "2026-08-09");
      await expect(repo.updatePage({ ...actor, pageId: daily.id, expectedStateVersion: daily.stateVersion, archivedAt: new Date() })).rejects.toThrow("DAILY_PAGE_CANNOT_ARCHIVE");
    } finally {
      await database.close();
    }
  });

  it("blocks owner offboarding while allowing non-owner membership removal", async () => {
    const database = await setup();
    try {
      const repo = createNotesRepository(drizzle(database) as never);
      const owner = { workspaceId: "w1", userId: "u1" };
      const page = await repo.createPage({ ...owner, title: "Retained" });
      await expect(database.exec(`DELETE FROM "member" WHERE "workspace_id" = 'w1' AND "user_id" = 'u1'`)).rejects.toThrow("NOTE_OWNER_OFFBOARDING_BLOCKED");
      await database.exec(`DELETE FROM "member" WHERE "workspace_id" = 'w1' AND "user_id" = 'u2'`);
      expect((await repo.getPage(owner, page.id))?.id).toBe(page.id);
    } finally {
      await database.close();
    }
  });

  it("maintains internal links and backlinks inside the actor workspace", async () => {
    const database = await setup();
    try {
      const repo = createNotesRepository(drizzle(database) as never);
      const target = await repo.createPage({ workspaceId: "w1", userId: "u1", title: "Target" });
      const source = await repo.createPage({
        workspaceId: "w1",
        userId: "u1",
        title: "Source",
        lexicalJson: {
          root: {
            type: "root",
            version: 1,
            children: [{ type: "paragraph", version: 1, children: [{ type: "link", version: 1, url: `note://${target.id}`, children: [{ type: "text", version: 1, text: "target" }] }] }],
          },
        },
      });
      expect((await repo.links({ workspaceId: "w1", userId: "u1", pageId: source.id })).items.map((link) => link.targetPageId)).toEqual([target.id]);
      expect((await repo.backlinks({ workspaceId: "w1", userId: "u1", pageId: target.id })).items.map((link) => link.sourcePageId)).toEqual([source.id]);
    } finally {
      await database.close();
    }
  });

  it("converts and discards legacy archive rows idempotently", async () => {
    const database = await setup();
    try {
      const repo = createNotesRepository(drizzle(database) as never);
      const page = await repo.createPage({ workspaceId: "w1", userId: "u1", title: "Converted" });
      const archiveId = uuid(900);
      await database.query(`INSERT INTO "note_legacy_archive_items" ("id", "workspace_id", "source_type", "source_id", "snapshot") VALUES ('${archiveId}', 'w1', 'todo', 'legacy-1', '{}')`);
      const converted = await repo.convertLegacy({ workspaceId: "w1", userId: "u1", archiveId, pageId: page.id, actionId: "convert-action-1" });
      const replay = await repo.convertLegacy({ workspaceId: "w1", userId: "u1", archiveId, pageId: page.id, actionId: "convert-action-1" });
      expect(converted?.disposition).toBe("converted");
      expect(replay?.id).toBe(converted?.id);
      await expect(repo.convertLegacy({ workspaceId: "w1", userId: "u1", archiveId, pageId: page.id, actionId: "different-action" })).rejects.toThrow("LEGACY_REPLAY_MISMATCH");
      const agentArchiveId = uuid(901);
      await database.query(`INSERT INTO "note_legacy_archive_items" ("id", "workspace_id", "source_type", "source_id", "snapshot") VALUES ('${agentArchiveId}', 'w1', 'todo', 'legacy-agent', '{}')`);
      const agent = { workspaceId: "w1", userId: "u1", actorKind: "agent" as const, agentJobId: "50000000-0000-4000-8000-000000000001" };
      await repo.convertLegacy({ ...agent, archiveId: agentArchiveId, pageId: page.id, actionId: "agent-action" });
      await repo.setShare({ workspaceId: "w1", userId: "u1", pageId: page.id, sharedWithUserId: "u2", role: "editor" });
      await expect(repo.convertLegacy({ ...agent, userId: "u2", archiveId: agentArchiveId, pageId: page.id, actionId: "agent-action" })).rejects.toThrow("LEGACY_REPLAY_MISMATCH");
      await database.exec(`DELETE FROM "member" WHERE "workspace_id" = 'w1' AND "user_id" = 'u2'`);
      await expect(repo.convertLegacy({ workspaceId: "w1", userId: "u2", archiveId, pageId: page.id, actionId: "convert-action-1" })).rejects.toThrow("USER_NOT_MEMBER");
      await database.exec(`INSERT INTO "member" ("id", "workspace_id", "user_id") VALUES ('m-rejoin', 'w1', 'u2')`);
      await expect(repo.discardLegacy({ workspaceId: "w1", userId: "u1", archiveId, actionId: "discard-action-1" })).rejects.toThrow("LEGACY_REPLAY_MISMATCH");
    } finally {
      await database.close();
    }
  });

  it("maps cross-archive legacy action reuse to a stable replay conflict", async () => {
    const database = await setup();
    try {
      const repo = createNotesRepository(drizzle(database) as never);
      const actor = { workspaceId: "w1", userId: "u1" };
      const page = await repo.createPage({ ...actor, title: "Action target" });
      const archiveIds = [uuid(902), uuid(903), uuid(904), uuid(905)];
      await database.query(`
        INSERT INTO "note_legacy_archive_items" ("id", "workspace_id", "source_type", "source_id", "snapshot") VALUES
          ('${archiveIds[0]}', 'w1', 'todo', 'action-source-1', '{}'),
          ('${archiveIds[1]}', 'w1', 'todo', 'action-source-2', '{}'),
          ('${archiveIds[2]}', 'w1', 'idea', 'action-source-3', '{}'),
          ('${archiveIds[3]}', 'w1', 'seed', 'action-source-4', '{}')
      `);

      await repo.convertLegacy({ ...actor, archiveId: archiveIds[0]!, pageId: page.id, actionId: "workspace-action-convert" });
      await expect(repo.convertLegacy({ ...actor, archiveId: archiveIds[1]!, pageId: page.id, actionId: "workspace-action-convert" })).rejects.toThrow("LEGACY_REPLAY_MISMATCH");
      await expect(repo.discardLegacy({ ...actor, archiveId: archiveIds[1]!, actionId: "workspace-action-convert" })).rejects.toThrow("LEGACY_REPLAY_MISMATCH");

      await repo.discardLegacy({ ...actor, archiveId: archiveIds[2]!, actionId: "workspace-action-discard" });
      await expect(repo.convertLegacy({ ...actor, archiveId: archiveIds[3]!, pageId: page.id, actionId: "workspace-action-discard" })).rejects.toThrow("LEGACY_REPLAY_MISMATCH");
      await expect(repo.discardLegacy({ ...actor, archiveId: archiveIds[3]!, actionId: "workspace-action-discard" })).rejects.toThrow("LEGACY_REPLAY_MISMATCH");

      expect((await database.query<{ id: string; disposition: string }>(`SELECT id, disposition FROM note_legacy_archive_items WHERE id IN ('${archiveIds[1]}', '${archiveIds[3]}') ORDER BY id`)).rows).toEqual([
        { id: archiveIds[1], disposition: "pending" },
        { id: archiveIds[3], disposition: "pending" },
      ]);
    } finally {
      await database.close();
    }
  });
});
