import { describe, expect, it } from "bun:test";
import { noteActions } from "./capabilities";

const capabilities = {
  canEdit: true,
  canCreateChild: true,
  canManageShares: true,
  canReparent: true,
  canArchive: true,
  canChangeVisibility: true,
  canRestore: false,
};

describe("Notes executable capability presentation", () => {
  it("shows editor commands without fabricating owner operations", () => {
    expect(noteActions({ ...capabilities, canManageShares: false, canReparent: false, canArchive: false, canChangeVisibility: false }, "page", false)).toEqual({
      edit: true,
      share: false,
      reparent: false,
      archive: false,
      visibility: false,
      restore: false,
    });
  });

  it("never advertises archive for daily or active commands for archived pages", () => {
    expect(noteActions(capabilities, "daily", false).archive).toBe(false);
    expect(noteActions({ ...capabilities, canEdit: false, canRestore: true }, "page", true)).toEqual({
      edit: false,
      share: false,
      reparent: false,
      archive: false,
      visibility: false,
      restore: true,
    });
  });
});
