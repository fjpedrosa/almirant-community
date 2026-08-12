import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import type { NoteLegacyArchiveSummary, NotePageSummary } from "../../domain/types";
import { MoveDialog } from "./move-dialog";
import { NotesArchivePanel } from "./notes-archive-panel";
import { NotePageActions } from "./note-page-actions";

const capabilities = {
  canEdit: false,
  canCreateChild: false,
  canManageShares: false,
  canReparent: false,
  canArchive: false,
  canChangeVisibility: false,
  canRestore: true,
};

const page = (id: string, title: string, parentId: string | null = null): NotePageSummary => ({
  id,
  title,
  parentId,
  ownerUserId: "owner",
  kind: "page",
  dailyDate: null,
  visibility: "private",
  position: 0,
  stateVersion: 7,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-11T00:00:00.000Z",
  ...capabilities,
});

const legacy = (disposition: "pending" | "converted" | "discarded"): NoteLegacyArchiveSummary => ({
  id: "40000000-0000-4000-8000-000000000001",
  sourceType: "idea",
  sourceId: "50000000-0000-4000-8000-000000000001",
  sourceTitle: "A long-lived idea",
  sourcePreview: "Review the original snapshot without changing the Idea.",
  disposition,
  convertedPageId: disposition === "converted" ? "60000000-0000-4000-8000-000000000001" : null,
  convertedActionId: null,
  dispositionAt: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-11T00:00:00.000Z",
});

describe("Notes page and archive workflows", () => {
  it("renders only executable page operations for viewers, daily pages, and owners", () => {
    const owner = { ...page("10000000-0000-4000-8000-000000000001", "Owner page"), canEdit: true, canManageShares: true, canReparent: true, canArchive: true, canChangeVisibility: true };
    const labels = { actions: "Note actions", share: "Share", move: "Move", archive: "Archive", visibility: "Visibility", private: "Private", workspace: "Workspace" };
    const handlers = { onShare: () => undefined, onMove: () => undefined, onArchive: () => undefined, onVisibility: () => undefined };
    const view = render(<NotePageActions page={owner} labels={labels} {...handlers} />);
    expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Move" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Archive" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Visibility" })).toBeTruthy();

    view.rerender(<NotePageActions page={{ ...owner, kind: "daily", canArchive: false, canReparent: false }} labels={labels} {...handlers} />);
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Move" })).toBeNull();

    view.rerender(<NotePageActions page={{ ...owner, ...capabilities, canRestore: false }} labels={labels} {...handlers} />);
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Visibility" })).toBeNull();
  });

  it("offers only safe move destinations and submits the explicit parent", () => {
    const onMove = mock(() => undefined);
    render(
      <MoveDialog
        open
        currentPageId="10000000-0000-4000-8000-000000000001"
        pages={[
          { ...page("10000000-0000-4000-8000-000000000001", "Current"), canEdit: true, canCreateChild: true },
          { ...page("20000000-0000-4000-8000-000000000001", "Child", "10000000-0000-4000-8000-000000000001"), canEdit: true, canCreateChild: true },
          { ...page("30000000-0000-4000-8000-000000000001", "Destination"), canEdit: true, canCreateChild: true },
        ]}
        labels={{ title: "Move note", description: "Choose parent", root: "Top level", move: "Move", cancel: "Cancel" }}
        onMove={onMove}
        onOpenChange={() => undefined}
      />,
    );

    expect(screen.queryByRole("option", { name: "Current" })).toBeNull();
    expect(screen.queryByRole("option", { name: "Child" })).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "Move note" }), { target: { value: "30000000-0000-4000-8000-000000000001" } });
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    expect(onMove).toHaveBeenCalledWith("30000000-0000-4000-8000-000000000001");
  });

  it("omits viewer-only pages as move destinations", () => {
    const onMove = mock(() => {});
    render(<MoveDialog open currentPageId={page("10000000-0000-4000-8000-000000000001", "Current").id} pages={[
      { ...page("10000000-0000-4000-8000-000000000001", "Current"), canEdit: true, canCreateChild: true },
      { ...page("20000000-0000-4000-8000-000000000002", "Viewer destination"), canEdit: false, canCreateChild: false },
      { ...page("30000000-0000-4000-8000-000000000003", "Editable destination"), canEdit: true, canCreateChild: true },
    ]} labels={{ title: "Move note", description: "Choose parent", root: "Top level", move: "Move", cancel: "Cancel" }} onMove={onMove} onOpenChange={() => {}} />);
    expect(screen.getByRole("option", { name: "Editable destination" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Viewer destination" })).not.toBeInTheDocument();
  });

  it("restores with the archived CAS version and keeps legacy conversion atomic", () => {
    const onRestore = mock(() => undefined);
    const onConvert = mock(() => undefined);
    const onDiscard = mock(() => undefined);
    render(
      <NotesArchivePanel
        archivedPages={[page("10000000-0000-4000-8000-000000000001", "Archived plan")]}
        legacyItems={[legacy("pending"), { ...legacy("converted"), id: "40000000-0000-4000-8000-000000000002" }]}
        labels={{
          pages: "Archived notes", legacy: "Legacy review", emptyPages: "No pages", emptyLegacy: "No legacy",
          restore: "Restore", convert: "Convert to note", converted: "Open converted note", discard: "Discard from review",
          discardTitle: "Discard this review item?", discardDescription: "Original stays", confirmDiscard: "Discard",
          cancel: "Cancel", pending: "Pending", convertedStatus: "Converted", discardedStatus: "Discarded",
          sourceTodo: "Todo", sourceIdea: "Idea", sourceSeed: "Seed", loadMore: "Load more",
        }}
        onRestore={onRestore}
        onConvert={onConvert}
        onDiscard={onDiscard}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Restore Archived plan" }));
    expect(onRestore).toHaveBeenCalledWith("10000000-0000-4000-8000-000000000001", 7);

    fireEvent.click(screen.getByRole("button", { name: "Convert to note A long-lived idea" }));
    expect(onConvert).toHaveBeenCalledWith("40000000-0000-4000-8000-000000000001");

    fireEvent.click(screen.getByRole("button", { name: "Discard from review A long-lived idea" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onDiscard).toHaveBeenCalledWith("40000000-0000-4000-8000-000000000001");
    expect(screen.getByRole("link", { name: "Open converted note" }).getAttribute("href"))
      .toBe("/notes/60000000-0000-4000-8000-000000000001");
  });
});
