export type NoteVisibility = "private" | "workspace";
export type NotePageKind = "page" | "daily";
export type NoteShareRole = "viewer" | "editor";
export type NoteLegacyDisposition = "pending" | "converted" | "discarded";
export type NoteLegacyDispositionFilter = NoteLegacyDisposition | "terminal" | "all";

export type NotePagination = {
  limit: number;
  offset: number;
  hasMore: boolean;
  nextOffset: number | null;
};

export type NoteCollection<T> = {
  items: T[];
  pagination: NotePagination;
};

export type NotePageCapabilities = {
  canEdit: boolean;
  canCreateChild: boolean;
  canManageShares: boolean;
  canReparent: boolean;
  canArchive: boolean;
  canChangeVisibility: boolean;
  canRestore: boolean;
};

export type NotePageSummary = NotePageCapabilities & {
  id: string;
  ownerUserId: string;
  parentId: string | null;
  kind: NotePageKind;
  dailyDate: string | null;
  visibility: NoteVisibility;
  title: string;
  position: number;
  stateVersion: number;
  createdAt: string;
  updatedAt: string;
};

export type NotePage = NotePageSummary & {
  workspaceId: string;
  lexicalJson: Record<string, unknown>;
  lexicalSchemaVersion: number;
  markdownProjection: string;
  plaintextProjection: string;
  archivedAt: string | null;
  provenance?: "user" | "legacy";
  createdByKind?: "user" | "agent";
  updatedByKind?: "user" | "agent";
  createdByUserId?: string | null;
  updatedByUserId?: string | null;
};

export type NoteTreeNode = NotePageSummary & { children: NoteTreeNode[] };

export type NoteChecklistItemSummary = {
  itemId: string;
  ordinal: number;
  text: string;
  checked: boolean;
  completedAt: string | null;
  completedByUserId: string | null;
  updatedAt: string;
};

export type NoteChecklistMutationResult = {
  item: NoteChecklistItemSummary;
  page: NotePage;
};

export type NoteCarryoverSummary = {
  sourcePageId: string;
  sourceStateVersion: number;
  sourceDate: string | null;
  itemId: string;
  ordinal: number;
  text: string;
  checked: boolean;
};

export type NotePageShareSummary = {
  id: string;
  pageId: string;
  sharedWithUserId: string;
  role: NoteShareRole;
  createdAt: string;
  updatedAt: string;
};

export type NoteLinkSummary = {
  id: string;
  sourcePageId: string;
  sourceTitle: string;
  targetPageId: string;
  ordinal: number;
  anchorText: string;
  createdAt: string;
};

export type NoteLegacyArchiveSummary = {
  id: string;
  sourceType: "todo" | "idea" | "seed";
  sourceId: string;
  sourceTitle: string;
  sourcePreview: string;
  disposition: NoteLegacyDisposition;
  convertedPageId: string | null;
  convertedActionId: string | null;
  dispositionAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NotePageDraft = {
  title: string;
  lexicalJson: Record<string, unknown>;
};

export type NoteMember = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
};

export type PaginationInput = { limit?: number; offset?: number };

export type CreateNotePageInput = {
  title?: string;
  parentId?: string | null;
  visibility?: NoteVisibility;
  position?: number;
  lexicalJson?: Record<string, unknown>;
};

export type UpdateNotePageInput = CreateNotePageInput & { expectedVersion: number };
