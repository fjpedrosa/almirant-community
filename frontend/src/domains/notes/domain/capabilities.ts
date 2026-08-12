import type { NotePageCapabilities, NotePageKind } from "./types";

export const noteActions = (
  capabilities: NotePageCapabilities,
  kind: NotePageKind,
  archived: boolean,
) => archived
  ? {
      edit: false,
      share: false,
      reparent: false,
      archive: false,
      visibility: false,
      restore: capabilities.canRestore,
    }
  : {
      edit: capabilities.canEdit,
      share: capabilities.canManageShares,
      reparent: capabilities.canReparent,
      archive: kind === "page" && capabilities.canArchive,
      visibility: capabilities.canChangeVisibility,
      restore: false,
    };
