import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { workspaceNotesApi } from "./workspace-notes-api";

const pageId = "10000000-0000-4000-8000-000000000001";
const itemId = "20000000-0000-4000-8000-000000000001";

describe("workspaceNotesApi", () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof mock>;

  beforeEach(() => {
    fetchMock = mock(async () => new Response(JSON.stringify({
      success: true,
      data: { items: [], pagination: { limit: 100, offset: 0, hasMore: false, nextOffset: null } },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("uses the workspace Notes REST surface rather than legacy project notes", async () => {
    await workspaceNotesApi.listPages({ limit: 100, offset: 0 });
    await workspaceNotesApi.listChecklistItems(pageId, { limit: 50, offset: 0 });
    await workspaceNotesApi.updateChecklistItem(pageId, itemId, { checked: true, expectedVersion: 7 });
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0]![0]).toEndWith("/api/notes/pages?limit=100&offset=0");
    expect(calls[1]![0]).toEndWith(`/api/notes/pages/${pageId}/checklist-items?limit=50&offset=0`);
    expect(calls[2]![0]).toEndWith(`/api/notes/pages/${pageId}/checklist/${itemId}`);
    expect(calls[2]![1]).toEqual(expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ checked: true, expectedVersion: 7 }),
    }));
    expect(calls.every(([url]) => !url.includes("/projects/"))).toBe(true);
  });

  it("validates every UUID and PostgreSQL int4 position before network access", async () => {
    expect(() => workspaceNotesApi.getPage("not-a-uuid")).toThrow("INVALID_NOTE_ID");
    expect(() => workspaceNotesApi.updateChecklistItem(pageId, "bad", { checked: true, expectedVersion: 1 })).toThrow("INVALID_NOTE_ID");
    expect(() => workspaceNotesApi.createPage({ position: 2_147_483_648 })).toThrow("INVALID_NOTE_POSITION");
    expect(() => workspaceNotesApi.updatePage(pageId, { expectedVersion: 1, position: -1 })).toThrow("INVALID_NOTE_POSITION");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps agenda dates explicit and conversion atomic/idempotent", async () => {
    expect(() => workspaceNotesApi.getOrCreateAgendaDay("11-08-2026")).toThrow("INVALID_AGENDA_DATE");
    await workspaceNotesApi.getOrCreateAgendaDay("2026-08-11");
    await workspaceNotesApi.convertLegacy("30000000-0000-4000-8000-000000000001", { actionId: "action-1" });
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0]![0]).toEndWith("/api/notes/agenda/2026-08-11");
    expect(calls[0]![1].method).toBe("PUT");
    expect(calls[1]![0]).toEndWith("/api/notes/legacy/30000000-0000-4000-8000-000000000001/convert");
    expect(calls[1]![1].body).toBe(JSON.stringify({ actionId: "action-1" }));
  });
});
