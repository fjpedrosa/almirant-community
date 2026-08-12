import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { createNotesRoutes } from "./notes.routes";
import { createNotesService, NotesServiceError } from "../services/notes.service";

const pageId = "10000000-0000-4000-8000-000000000001";
const itemId = "20000000-0000-4000-8000-000000000001";
const archiveId = "30000000-0000-4000-8000-000000000001";
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

const makeService = () => ({
  listPages: async () => [],
  listArchivedPages: async (..._args: any[]): Promise<any> => ({ items: [], pagination: { limit: 50, offset: 0, hasMore: false, nextOffset: null } }),
  getPage: async () => ({ id: pageId, stateVersion: 1 }),
  createPage: async () => ({ id: pageId, stateVersion: 1 }),
  updatePage: async () => ({ id: pageId, stateVersion: 2 }),
  reparentPage: async () => ({ id: pageId, stateVersion: 2 }),
  archivePage: async () => ({ id: pageId, stateVersion: 2 }),
  restorePage: async () => ({ id: pageId, stateVersion: 2 }),
  searchPages: async () => [],
  updateChecklistItem: async () => ({ itemId, checked: true }),
  listChecklistItems: async () => ({
    items: [{
      itemId,
      ordinal: 0,
      text: "Ship the release",
      checked: true,
      completedAt: "2026-08-11T09:00:00.000Z",
      completedByUserId: "human-session",
      updatedAt: "2026-08-11T09:00:00.000Z",
    }],
    pagination: { limit: 50, offset: 0, hasMore: false, nextOffset: null },
  }),
  listLinks: async () => [],
  listBacklinks: async () => [],
  listShares: async () => [],
  upsertShare: async () => ({ id: "share-1" }),
  removeShare: async () => ({ removed: true }),
  listAgendaMonth: async () => [],
  getOrCreateAgendaDay: async () => ({ id: pageId, dailyDate: "2026-08-11" }),
  listAgendaCarryover: async () => [],
  listLegacyArchive: async () => [],
  convertLegacyArchive: async () => ({ id: "legacy-1", disposition: "converted" }),
  discardLegacyArchive: async () => ({ id: "legacy-1", disposition: "discarded" }),
});

const appFor = (service: ReturnType<typeof makeService>, workspaceId = "workspace-session") =>
  new Elysia()
    .derive(() => ({
      user: { id: "human-session" },
      activeWorkspace: { id: workspaceId },
      memberRole: "member",
    }))
    .use(createNotesRoutes(service as never));

describe("notes REST routes", () => {
  it("exposes bounded archived recovery and atomic legacy conversion without a target page", async () => {
    const service = makeService();
    let archivedActor: unknown;
    let archivedPagination: unknown;
    let conversionInput: unknown;
    service.listArchivedPages = async (...args: any[]) => {
      [archivedActor, archivedPagination] = args;
      return {
        items: [{
          id: pageId,
          stateVersion: 7,
          canEdit: false,
          canManageShares: false,
          canReparent: false,
          canArchive: false,
          canChangeVisibility: false,
          canRestore: true,
        }],
        pagination: { limit: 10, offset: 2, hasMore: false, nextOffset: null },
      };
    };
    service.convertLegacyArchive = async (...args: any[]) => {
      conversionInput = args[2];
      return { id: archiveId, convertedPageId: pageId, disposition: "converted" };
    };
    const app = appFor(service, "workspace-safe");
    const archived = await app.handle(new Request("http://localhost/notes/pages/archived?limit=10&offset=2"));
    const converted = await app.handle(new Request(`http://localhost/notes/legacy/${archiveId}/convert`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actionId: "atomic-action" }),
    }));

    expect(archived.status).toBe(200);
    expect((await archived.json() as any).data.items[0]).toEqual(expect.objectContaining({
      stateVersion: 7,
      canEdit: false,
      canManageShares: false,
      canReparent: false,
      canArchive: false,
      canChangeVisibility: false,
      canRestore: true,
    }));
    expect(archivedActor).toEqual({ workspaceId: "workspace-safe", userId: "human-session" });
    expect(archivedPagination).toEqual({ limit: 10, offset: 2 });
    expect(converted.status).toBe(200);
    expect(conversionInput).toEqual({ actionId: "atomic-action" });
  });

  it("returns exact bounded legacy command DTOs and a stable conversion-limit error", async () => {
    const rawArchive = {
      id: archiveId,
      workspaceId: "workspace-safe",
      sourceType: "idea",
      sourceId: "legacy-source",
      sourceTitle: "T".repeat(500),
      sourcePreview: "P".repeat(500),
      snapshot: { description: "x".repeat(1_000_000) },
      disposition: "converted",
      convertedPageId: pageId,
      convertedActionId: "safe-action",
      dispositionByUserId: "human-session",
      dispositionByKind: "agent",
      dispositionByAgentJobId: "40000000-0000-4000-8000-000000000001",
      dispositionByChannel: "internal-channel",
      dispositionByTool: "internal-tool",
      dispositionAt: new Date("2026-08-12T12:00:00.000Z"),
      createdAt: new Date("2026-08-12T10:00:00.000Z"),
      updatedAt: new Date("2026-08-12T12:00:00.000Z"),
    };
    const repository = {
      getLegacy: async () => rawArchive,
      convertLegacy: async () => rawArchive,
      discardLegacy: async () => ({
        ...rawArchive,
        disposition: "discarded",
        convertedPageId: null,
        convertedActionId: "discard-action",
      }),
    };
    const app = appFor(createNotesService(repository as never) as never, "workspace-safe");
    const convert = await app.handle(new Request(`http://localhost/notes/legacy/${archiveId}/convert`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actionId: "safe-action" }),
    }));
    const discard = await app.handle(new Request(`http://localhost/notes/legacy/${archiveId}/discard`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actionId: "discard-action" }),
    }));

    for (const response of [convert, discard]) {
      expect(response.status).toBe(200);
      const data = (await response.json() as any).data;
      expect(Object.keys(data).sort()).toEqual(legacySummaryKeys);
      expect(data).not.toHaveProperty("snapshot");
      expect(data).not.toHaveProperty("workspaceId");
      expect(data).not.toHaveProperty("dispositionByUserId");
      expect(data).not.toHaveProperty("dispositionByAgentJobId");
      expect(data).not.toHaveProperty("dispositionByChannel");
      expect(data).not.toHaveProperty("dispositionByTool");
      expect(new TextEncoder().encode(JSON.stringify(data)).byteLength).toBeLessThan(5_000);
    }

    repository.convertLegacy = async () => {
      throw new Error("LEGACY_SNAPSHOT_TOO_LARGE");
    };
    const oversized = await app.handle(new Request(`http://localhost/notes/legacy/${archiveId}/convert`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actionId: "oversized-action" }),
    }));
    expect(oversized.status).toBe(422);
    expect(await oversized.json()).toEqual(expect.objectContaining({
      success: false,
      code: "LEGACY_SNAPSHOT_TOO_LARGE",
      error: "Legacy archive snapshot exceeds the conversion limit",
    }));
  });

  it("rejects every malformed UUID-backed identifier before calling the service", async () => {
    const service = makeService();
    let serviceCalls = 0;
    for (const method of [
      "getPage",
      "createPage",
      "updatePage",
      "reparentPage",
      "archivePage",
      "restorePage",
      "updateChecklistItem",
      "listLinks",
      "listBacklinks",
      "listShares",
      "upsertShare",
      "removeShare",
      "convertLegacyArchive",
      "discardLegacyArchive",
    ] as const) {
      (service as any)[method] = async () => {
        serviceCalls += 1;
        return {};
      };
    }
    const json = { "content-type": "application/json" };
    const requests = [
      new Request("http://localhost/notes/pages/not-a-uuid"),
      new Request("http://localhost/notes/pages", { method: "POST", headers: json, body: JSON.stringify({ parentId: "not-a-uuid" }) }),
      new Request(`http://localhost/notes/pages/${pageId}`, { method: "PATCH", headers: json, body: JSON.stringify({ expectedVersion: 1, parentId: "not-a-uuid" }) }),
      new Request("http://localhost/notes/pages/not-a-uuid/parent", { method: "PATCH", headers: json, body: JSON.stringify({ expectedVersion: 1, parentId: null }) }),
      new Request(`http://localhost/notes/pages/${pageId}/parent`, { method: "PATCH", headers: json, body: JSON.stringify({ expectedVersion: 1, parentId: "not-a-uuid" }) }),
      new Request("http://localhost/notes/pages/not-a-uuid/archive", { method: "POST", headers: json, body: JSON.stringify({ expectedVersion: 1 }) }),
      new Request("http://localhost/notes/pages/not-a-uuid/restore", { method: "POST", headers: json, body: JSON.stringify({ expectedVersion: 1 }) }),
      new Request(`http://localhost/notes/pages/${pageId}/checklist/not-a-uuid`, { method: "PATCH", headers: json, body: JSON.stringify({ checked: true, expectedVersion: 1 }) }),
      new Request("http://localhost/notes/pages/not-a-uuid/links"),
      new Request("http://localhost/notes/pages/not-a-uuid/backlinks"),
      new Request("http://localhost/notes/pages/not-a-uuid/shares"),
      new Request("http://localhost/notes/pages/not-a-uuid/shares/member-2", { method: "PUT", headers: json, body: JSON.stringify({ role: "viewer" }) }),
      new Request("http://localhost/notes/pages/not-a-uuid/shares/member-2", { method: "DELETE" }),
      new Request("http://localhost/notes/legacy/not-a-uuid/convert", { method: "POST", headers: json, body: JSON.stringify({ pageId, actionId: "action" }) }),
      new Request(`http://localhost/notes/legacy/${archiveId}/convert`, { method: "POST", headers: json, body: JSON.stringify({ pageId: "not-a-uuid", actionId: "action" }) }),
      new Request("http://localhost/notes/legacy/not-a-uuid/discard", { method: "POST", headers: json, body: JSON.stringify({ actionId: "action" }) }),
    ];

    const responses = await Promise.all(requests.map((request) => appFor(service).handle(request)));
    expect(responses.every((response) => response.status === 422)).toBe(true);
    expect(serviceCalls).toBe(0);
  });

  it("rejects oversized collection bounds before calling the service", async () => {
    const service = makeService();
    let serviceCalls = 0;
    for (const method of [
      "listPages",
      "searchPages",
      "listLinks",
      "listBacklinks",
      "listShares",
      "listAgendaMonth",
      "listAgendaCarryover",
      "listLegacyArchive",
    ] as const) {
      (service as any)[method] = async () => {
        serviceCalls += 1;
        return {};
      };
    }
    const requests = [
      new Request("http://localhost/notes/pages?limit=101"),
      new Request("http://localhost/notes/search?q=bounded&limit=101"),
      new Request(`http://localhost/notes/pages/${pageId}/links?limit=101`),
      new Request(`http://localhost/notes/pages/${pageId}/backlinks?limit=101`),
      new Request(`http://localhost/notes/pages/${pageId}/shares?limit=101`),
      new Request("http://localhost/notes/agenda?month=2026-08&limit=101"),
      new Request("http://localhost/notes/agenda/2026-08-11/carryover?limit=101"),
      new Request("http://localhost/notes/legacy?limit=101"),
    ];
    const responses = await Promise.all(requests.map((request) => appFor(service).handle(request)));
    expect(responses.every((response) => response.status === 422)).toBe(true);
    expect(serviceCalls).toBe(0);
  });

  it("rejects positions above PostgreSQL int4 before calling the service", async () => {
    const service = makeService();
    let serviceCalls = 0;
    service.createPage = async () => {
      serviceCalls += 1;
      return { id: pageId, stateVersion: 1 };
    };
    service.updatePage = async () => {
      serviceCalls += 1;
      return { id: pageId, stateVersion: 2 };
    };
    const headers = { "content-type": "application/json" };
    const responses = await Promise.all([
      appFor(service).handle(new Request("http://localhost/notes/pages", {
        method: "POST",
        headers,
        body: JSON.stringify({ position: 2_147_483_648 }),
      })),
      appFor(service).handle(new Request(`http://localhost/notes/pages/${pageId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ expectedVersion: 1, position: 2_147_483_648 }),
      })),
    ]);

    expect(responses.map((response) => response.status)).toEqual([422, 422]);
    expect(serviceCalls).toBe(0);
  });

  it("derives the actor exclusively from authenticated session/workspace context", async () => {
    const service = makeService();
    let receivedActor: unknown;
    service.createPage = async (...args: any[]) => {
      receivedActor = args[0];
      return { id: pageId, stateVersion: 1 };
    };
    const response = await appFor(service, "workspace-safe").handle(
      new Request("http://localhost/notes/pages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Created",
          visibility: "private",
          lexicalJson: { root: { type: "root", version: 1, children: [] } },
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(receivedActor).toEqual({ workspaceId: "workspace-safe", userId: "human-session" });
  });

  it("strips caller-supplied actor identities and keeps session authority", async () => {
    const service = makeService();
    let receivedActor: unknown;
    let receivedInput: unknown;
    service.createPage = async (...args: any[]) => {
      [receivedActor, receivedInput] = args;
      return { id: pageId, stateVersion: 1 };
    };
    const response = await appFor(service).handle(
      new Request("http://localhost/notes/pages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Spoof",
          userId: "attacker",
          workspaceId: "foreign-workspace",
          ownerUserId: "attacker",
        }),
      }),
    );
    expect(response.status).toBe(201);
    expect(receivedActor).toEqual({ workspaceId: "workspace-session", userId: "human-session" });
    expect(receivedInput).toEqual(expect.objectContaining({ title: "Spoof" }));
    expect(receivedInput).not.toHaveProperty("userId");
    expect(receivedInput).not.toHaveProperty("workspaceId");
    expect(receivedInput).not.toHaveProperty("ownerUserId");
  });

  it("maps CAS conflicts to 409 and inaccessible resources to sanitized 404", async () => {
    const service = makeService();
    service.updatePage = async () => {
      throw new NotesServiceError("NOTE_VERSION_CONFLICT", 409, "Note version conflict");
    };
    service.getPage = async () => {
      throw new NotesServiceError("NOTE_NOT_FOUND", 404, "Note not found");
    };
    const app = appFor(service);

    const conflict = await app.handle(
      new Request(`http://localhost/notes/pages/${pageId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: 1, title: "edit" }),
      }),
    );
    const hidden = await app.handle(new Request(`http://localhost/notes/pages/${pageId}`));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual(
      expect.objectContaining({ success: false, error: "Note version conflict", code: "NOTE_VERSION_CONFLICT" }),
    );
    expect(hidden.status).toBe(404);
    expect(JSON.stringify(await hidden.json())).not.toContain(pageId);
  });

  it("rejects malformed explicit agenda dates without server inference", async () => {
    const service = makeService();
    service.getOrCreateAgendaDay = async () => {
      throw new NotesServiceError("INVALID_DATE", 400, "Date must use YYYY-MM-DD");
    };
    const response = await appFor(service).handle(
      new Request("http://localhost/notes/agenda/08-11-2026", { method: "PUT" }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(
      expect.objectContaining({ success: false, code: "INVALID_DATE" }),
    );
  });

  it("registers checklist, links, shares, agenda, and legacy archive surfaces", async () => {
    const service = makeService();
    const app = appFor(service);
    const requests = [
      new Request(`http://localhost/notes/search?q=roadmap&limit=100`),
      new Request(`http://localhost/notes/pages/${pageId}/parent`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parentId: null, expectedVersion: 1 }),
      }),
      new Request(`http://localhost/notes/pages/${pageId}/archive`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: 1 }),
      }),
      new Request(`http://localhost/notes/pages/${pageId}/restore`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: 1 }),
      }),
      new Request(`http://localhost/notes/pages/${pageId}/checklist/${itemId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ checked: true, expectedVersion: 1 }),
      }),
      new Request(`http://localhost/notes/pages/${pageId}/checklist-items?limit=50&offset=0`),
      new Request(`http://localhost/notes/pages/${pageId}/links`),
      new Request(`http://localhost/notes/pages/${pageId}/backlinks`),
      new Request(`http://localhost/notes/pages/${pageId}/shares`),
      new Request(`http://localhost/notes/pages/${pageId}/shares/member-2`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: "editor" }),
      }),
      new Request(`http://localhost/notes/pages/${pageId}/shares/member-2`, {
        method: "DELETE",
      }),
      new Request("http://localhost/notes/agenda?month=2026-08"),
      new Request("http://localhost/notes/agenda/2026-08-11", { method: "PUT" }),
      new Request("http://localhost/notes/agenda/2026-08-11/carryover"),
      new Request("http://localhost/notes/legacy?disposition=pending"),
      new Request(`http://localhost/notes/legacy/${archiveId}/convert`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pageId, actionId: "convert-action" }),
      }),
      new Request(`http://localhost/notes/legacy/${archiveId}/discard`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actionId: "discard-action" }),
      }),
    ];
    const responses = await Promise.all(requests.map((request) => app.handle(request)));
    expect(responses.map((response) => response.status)).toEqual(new Array(requests.length).fill(200));
  });

  it("returns the bounded checklist audit summary and validates its pagination before service access", async () => {
    const service = makeService();
    let received: unknown;
    let calls = 0;
    service.listChecklistItems = async (...args: any[]) => {
      calls += 1;
      received = args;
      return {
        items: [{
          itemId,
          ordinal: 0,
          text: "Ship the release",
          checked: true,
          completedAt: "2026-08-11T09:00:00.000Z",
          completedByUserId: "human-session",
          updatedAt: "2026-08-11T09:00:00.000Z",
        }],
        pagination: { limit: 10, offset: 2, hasMore: false, nextOffset: null },
      };
    };
    const app = appFor(service, "workspace-safe");
    const response = await app.handle(new Request(
      `http://localhost/notes/pages/${pageId}/checklist-items?limit=10&offset=2`,
    ));
    const body = await response.json() as any;
    expect(response.status).toBe(200);
    expect(received).toEqual([
      { workspaceId: "workspace-safe", userId: "human-session" },
      pageId,
      { limit: 10, offset: 2 },
    ]);
    expect(Object.keys(body.data.items[0]).sort()).toEqual([
      "checked",
      "completedAt",
      "completedByUserId",
      "itemId",
      "ordinal",
      "text",
      "updatedAt",
    ]);

    const invalid = await app.handle(new Request(
      `http://localhost/notes/pages/${pageId}/checklist-items?limit=101`,
    ));
    expect(invalid.status).toBe(422);
    expect(calls).toBe(1);
  });

  it("never forwards raw repository or SQL failures", async () => {
    const service = makeService();
    service.listPages = async () => {
      throw new Error("SELECT private_token FROM note_pages");
    };
    const response = await appFor(service).handle(new Request("http://localhost/notes/pages"));
    const body = JSON.stringify(await response.json());
    expect(response.status).toBe(500);
    expect(body).toContain("Notes operation failed");
    expect(body).not.toContain("SELECT");
    expect(body).not.toContain("private_token");
  });
});
