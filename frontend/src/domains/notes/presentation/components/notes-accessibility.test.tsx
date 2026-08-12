import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { AgendaCalendar } from "./agenda-calendar";
import { CarryoverList } from "./carryover-list";
import { ConflictDialog } from "./conflict-dialog";
import { EditorToolbar } from "./editor-toolbar";
import { NotesSidebar } from "./notes-sidebar";
import { ShareDialog } from "./share-dialog";
import { MoveDialog } from "./move-dialog";

const page = {
  id: "10000000-0000-4000-8000-000000000001",
  ownerUserId: "owner",
  parentId: null,
  kind: "page" as const,
  dailyDate: null,
  visibility: "private" as const,
  title: "Release notes",
  position: 0,
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
  children: [],
};

describe("Notes accessible daily-work components", () => {
  it("renders semantic desktop and mobile navigation without a fake tree role", () => {
    render(<NotesSidebar
      pages={[page]}
      activePageId={page.id}
      labels={{ navigation: "Notes navigation", today: "Today", pages: "Pages", archive: "Archive", open: "Open Notes navigation", search: "Search notes", newPage: "New page" }}
      onCreatePage={() => {}}
    />);
    expect(screen.getByRole("navigation", { name: "Notes navigation" })).toBeInTheDocument();
    expect(screen.queryByRole("tree")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Notes navigation" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Today" })).toHaveAttribute("href", "/notes");
    expect(screen.getByRole("link", { name: "Archive" })).toHaveAttribute("href", "/notes/archive");
  });

  it("provides named editor commands and hides mutation controls for viewers", () => {
    const onCommand = mock(() => {});
    const { rerender } = render(<EditorToolbar
      editable
      onCommand={onCommand}
      labels={{ paragraph: "Paragraph", heading1: "Heading 1", heading2: "Heading 2", bold: "Bold", italic: "Italic", underline: "Underline", strike: "Strikethrough", inlineCode: "Inline code", bullet: "Bulleted list", number: "Numbered list", checklist: "Checklist", quote: "Quote", code: "Code block", link: "External link", internalLink: "Link to note", slash: "Insert block" }}
    />);
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    expect(onCommand).toHaveBeenCalledWith("bold");
    expect(screen.getByRole("toolbar", { name: "Editor formatting" })).toBeInTheDocument();
    for (const button of screen.getAllByRole("button")) {
      if (button.getAttribute("aria-label") !== "External link" && button.getAttribute("aria-label") !== "Link to note") expect(button).toHaveAttribute("aria-pressed", "false");
      expect(button.className).toContain("min-w-11");
    }

    rerender(<EditorToolbar
      editable={false}
      onCommand={onCommand}
      labels={{ paragraph: "Paragraph", heading1: "Heading 1", heading2: "Heading 2", bold: "Bold", italic: "Italic", underline: "Underline", strike: "Strikethrough", inlineCode: "Inline code", bullet: "Bulleted list", number: "Numbered list", checklist: "Checklist", quote: "Quote", code: "Code block", link: "External link", internalLink: "Link to note", slash: "Insert block" }}
    />);
    expect(screen.queryByRole("toolbar", { name: "Editor formatting" })).not.toBeInTheDocument();
  });

  it("exposes explicit conflict recovery and accessible share roles", () => {
    const reload = mock(() => {});
    const conflict = render(
      <ConflictDialog open localTitle="Unsaved local title" onReload={reload} onCreateCopy={() => {}} labels={{ title: "This note changed elsewhere", description: "Choose how to preserve your work.", reload: "Reload server version", createCopy: "Create a private copy", localDraft: "Local draft" }} />
    );
    expect(screen.getByRole("dialog", { name: "This note changed elsewhere" })).toBeInTheDocument();
    expect(screen.getByText("Unsaved local title")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload server version" })).toBeInTheDocument();
    conflict.unmount();
    render(<ShareDialog open members={[{ id: "u2", name: "Alex", email: "alex@example.com" }]} shares={[]} inheritedAccess labels={{ title: "Share note", description: "Choose people who can open this note.", inherited: "Access may also be inherited from a parent note.", member: "Person", role: "Role", viewer: "Viewer", editor: "Editor", save: "Save access", remove: "Remove", close: "Close" }} onSave={() => {}} onRemove={() => {}} onOpenChange={() => {}} />);
    expect(screen.getByRole("dialog", { name: "Share note" })).toBeInTheDocument();
    expect(screen.getByText("Access may also be inherited from a parent note.")).toBeInTheDocument();
  });

  it("keeps conflict recovery retryable and disables duplicate actions while pending", () => {
    render(<ConflictDialog
      open
      localTitle="Unsaved local title"
      pending="reload"
      error="The server could not be reached. Try again."
      onReload={() => {}}
      onCreateCopy={() => {}}
      labels={{ title: "This note changed elsewhere", description: "Choose how to preserve your work.", reload: "Reload server version", createCopy: "Create a private copy", localDraft: "Local draft", retryError: "Retry failed" }}
    />);
    expect(screen.getByRole("alert")).toHaveTextContent("The server could not be reached");
    expect(screen.getByRole("button", { name: "Reload server version" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Create a private copy" })).toBeDisabled();
  });

  it("disables mutation dialog submits while pending and exposes named share removal", () => {
    render(<>
      <MoveDialog open currentPageId={page.id} pages={[page]} pending error="Move failed" labels={{ title: "Move note", description: "Choose parent", root: "Top level", move: "Move", cancel: "Cancel" }} onMove={() => {}} onOpenChange={() => {}} />
      <ShareDialog open members={[{ id: "u2", name: "Alex", email: "alex@example.com" }]} shares={[{ id: "s1", pageId: page.id, sharedWithUserId: "u2", role: "viewer", createdAt: "2026-08-11T00:00:00.000Z", updatedAt: "2026-08-11T00:00:00.000Z" }]} inheritedAccess={false} pending labels={{ title: "Share note", description: "Choose people", inherited: "Inherited", member: "Person", role: "Role", viewer: "Viewer", editor: "Editor", save: "Save access", remove: "Remove", close: "Close" }} onSave={() => {}} onRemove={() => {}} onOpenChange={() => {}} />
    </>);
    expect(screen.getByText("Move failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move", hidden: true })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove Alex", hidden: true })).toBeDisabled();
  });

  it("surfaces team-member query failures with a retryable state", () => {
    let retries = 0;
    render(<ShareDialog
      open
      members={[]}
      shares={[]}
      inheritedAccess={false}
      labels={{ title: "Share note", description: "Choose people", inherited: "Inherited", member: "Person", role: "Role", viewer: "Viewer", editor: "Editor", save: "Save access", remove: "Remove", close: "Close", retryMembers: "Retry members" }}
      membersError="Could not load members"
      onRetryMembers={() => { retries += 1; }}
      onSave={() => {}}
      onRemove={() => {}}
      onOpenChange={() => {}}
    />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load members");
    fireEvent.click(screen.getByRole("button", { name: "Retry members" }));
    expect(retries).toBe(1);
    expect(screen.getByLabelText("Person")).toBeDisabled();
  });

  it("renders a keyboard-addressable month and completes carryover on its original page/version", () => {
    const selectDate = mock(() => {});
    const complete = mock(() => {});
    render(<>
      <AgendaCalendar month="2026-08" selectedDate="2026-08-11" daysWithNotes={["2026-08-03"]} onSelectDate={selectDate} onPreviousMonth={() => {}} onNextMonth={() => {}} labels={{ calendar: "August 2026", previous: "Previous month", next: "Next month" }} />
      <CarryoverList items={[{ sourcePageId: "source-page", sourceStateVersion: 9, sourceDate: "2026-08-10", itemId: "item", ordinal: 0, text: "Finish migration", checked: false }]} error="Could not update source page" onComplete={complete} labels={{ title: "Pending from previous days", empty: "Nothing pending", complete: "Complete", from: "From" }} />
    </>);
    fireEvent.click(screen.getByRole("gridcell", { name: /August 11/i }));
    expect(selectDate).toHaveBeenCalledWith("2026-08-11");
    fireEvent.click(screen.getByRole("checkbox", { name: "Finish migration" }));
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ sourcePageId: "source-page", sourceStateVersion: 9, itemId: "item" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Could not update source page");
  });
});
