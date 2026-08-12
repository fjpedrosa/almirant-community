import { describe, expect, it } from "bun:test";
import { notesKeys } from "./query-keys";
import { breadcrumbSegments, buildNoteTree, mergeNoteCollections } from "./tree";
import type { NoteCollection, NotePageSummary } from "./types";

const summary = (id: string, parentId: string | null, position: number): NotePageSummary => ({
  id,
  ownerUserId: "owner",
  parentId,
  kind: "page",
  dailyDate: null,
  visibility: "private",
  title: id,
  position,
  stateVersion: 1,
  createdAt: "2026-08-11T00:00:00.000Z",
  updatedAt: "2026-08-11T00:00:00.000Z",
  canEdit: true,
  canCreateChild: true,
  canManageShares: true,
  canReparent: true,
  canArchive: true,
  canChangeVisibility: true,
  canRestore: false,
});

describe("Notes tree and organization cache boundaries", () => {
  it("merges every bounded page, de-duplicates stable IDs, and builds hierarchy across pages", () => {
    const page1: NoteCollection<NotePageSummary> = {
      items: [summary("root", null, 1), summary("child-b", "root", 2)],
      pagination: { limit: 2, offset: 0, hasMore: true, nextOffset: 2 },
    };
    const page2: NoteCollection<NotePageSummary> = {
      items: [summary("child-a", "root", 1), summary("child-b", "root", 2)],
      pagination: { limit: 2, offset: 2, hasMore: false, nextOffset: null },
    };

    const merged = mergeNoteCollections([page1, page2]);
    expect(merged.map((item) => item.id)).toEqual(["root", "child-b", "child-a"]);
    expect(buildNoteTree(merged)).toEqual([
      expect.objectContaining({
        id: "root",
        children: [
          expect.objectContaining({ id: "child-a" }),
          expect.objectContaining({ id: "child-b" }),
        ],
      }),
    ]);
  });

  it("puts the organization scope on every concrete Notes query key", () => {
    const org = "workspace-123";
    const keys = [
      notesKeys.tree(org),
      notesKeys.page(org, "page-1"),
      notesKeys.search(org, "ship"),
      notesKeys.agendaMonth(org, "2026-08"),
      notesKeys.agendaDay(org, "2026-08-11"),
      notesKeys.carryover(org, "2026-08-11"),
      notesKeys.checklistItems(org, "page-1"),
      notesKeys.backlinks(org, "page-1"),
      notesKeys.shares(org, "page-1"),
      notesKeys.archived(org),
      notesKeys.legacy(org, "pending"),
    ];
    expect(keys.every((key) => key.includes(`org:${org}`))).toBe(true);
    expect(notesKeys.tree("other")).not.toEqual(notesKeys.tree(org));
  });

  it("marks only the current breadcrumb as non-navigable", () => {
    const segments = breadcrumbSegments([
      summary("root", null, 0),
      summary("child", "root", 0),
    ], "child");
    expect(segments.map(({ id, isCurrent }) => ({ id, isCurrent }))).toEqual([
      { id: "root", isCurrent: false },
      { id: "child", isCurrent: true },
    ]);
  });
});
