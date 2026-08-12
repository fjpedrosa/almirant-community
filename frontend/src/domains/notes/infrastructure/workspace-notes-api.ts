import { request } from "@/lib/api/client";
import { isAgendaDate, isAgendaMonth } from "../domain/date";
import { assertPersistableLexicalDocument } from "../domain/lexical-contract";
import type {
  CreateNotePageInput,
  NoteChecklistItemSummary,
  NoteChecklistMutationResult,
  NoteCollection,
  NoteCarryoverSummary,
  NoteLegacyArchiveSummary,
  NoteLegacyDispositionFilter,
  NoteLinkSummary,
  NotePage,
  NotePageShareSummary,
  NotePageSummary,
  NoteShareRole,
  PaginationInput,
  UpdateNotePageInput,
} from "../domain/types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_POSITION = 2_147_483_647;

const assertId = (value: string): void => {
  if (!UUID_PATTERN.test(value)) throw new Error("INVALID_NOTE_ID");
};

const assertVersion = (value: number): void => {
  if (!Number.isInteger(value) || value < 1) throw new Error("INVALID_NOTE_VERSION");
};

const assertPosition = (value: number | undefined): void => {
  if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > MAX_POSITION)) {
    throw new Error("INVALID_NOTE_POSITION");
  }
};

const assertPagination = ({ limit, offset }: PaginationInput): void => {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100)) throw new Error("INVALID_NOTE_PAGINATION");
  if (offset !== undefined && (!Number.isInteger(offset) || offset < 0 || offset > 100_000)) throw new Error("INVALID_NOTE_PAGINATION");
};

const query = (input: Record<string, string | number | undefined>): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const value = params.toString();
  return value ? `?${value}` : "";
};

const pageInput = <T extends CreateNotePageInput>(input: T): T => {
  if (input.parentId) assertId(input.parentId);
  assertPosition(input.position);
  if (input.lexicalJson !== undefined) assertPersistableLexicalDocument(input.lexicalJson);
  return input;
};

const collection = <T>(path: string, pagination: PaginationInput) => {
  assertPagination(pagination);
  return request<NoteCollection<T>>(`${path}${query(pagination)}`);
};

export const workspaceNotesApi = {
  listPages: (pagination: PaginationInput = {}) => collection<NotePageSummary>("/notes/pages", pagination),
  listArchivedPages: (pagination: PaginationInput = {}) => collection<NotePageSummary>("/notes/pages/archived", pagination),
  getPage: (pageId: string) => {
    assertId(pageId);
    return request<NotePage>(`/notes/pages/${pageId}`);
  },
  createPage: (input: CreateNotePageInput) => request<NotePage>("/notes/pages", {
    method: "POST",
    body: JSON.stringify(pageInput(input)),
  }),
  updatePage: (pageId: string, input: UpdateNotePageInput) => {
    assertId(pageId);
    assertVersion(input.expectedVersion);
    return request<NotePage>(`/notes/pages/${pageId}`, {
      method: "PATCH",
      body: JSON.stringify(pageInput(input)),
    });
  },
  reparentPage: (pageId: string, input: { parentId: string | null; expectedVersion: number }) => {
    assertId(pageId);
    if (input.parentId) assertId(input.parentId);
    assertVersion(input.expectedVersion);
    return request<NotePage>(`/notes/pages/${pageId}/parent`, { method: "PATCH", body: JSON.stringify(input) });
  },
  archivePage: (pageId: string, expectedVersion: number) => {
    assertId(pageId);
    assertVersion(expectedVersion);
    return request<NotePage>(`/notes/pages/${pageId}/archive`, { method: "POST", body: JSON.stringify({ expectedVersion }) });
  },
  restorePage: (pageId: string, expectedVersion: number) => {
    assertId(pageId);
    assertVersion(expectedVersion);
    return request<NotePage>(`/notes/pages/${pageId}/restore`, { method: "POST", body: JSON.stringify({ expectedVersion }) });
  },
  search: (searchQuery: string, pagination: PaginationInput = {}) => {
    assertPagination(pagination);
    const normalized = searchQuery.trim();
    if (!normalized || normalized.length > 200) throw new Error("INVALID_NOTE_QUERY");
    return request<NoteCollection<NotePageSummary>>(`/notes/search${query({ q: normalized, ...pagination })}`);
  },
  updateChecklistItem: (pageId: string, itemId: string, input: { checked: boolean; expectedVersion: number }) => {
    assertId(pageId);
    assertId(itemId);
    assertVersion(input.expectedVersion);
    return request<NoteChecklistMutationResult>(`/notes/pages/${pageId}/checklist/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },
  listChecklistItems: (pageId: string, pagination: PaginationInput = {}) => {
    assertId(pageId);
    return collection<NoteChecklistItemSummary>(`/notes/pages/${pageId}/checklist-items`, pagination);
  },
  listLinks: (pageId: string, pagination: PaginationInput = {}) => {
    assertId(pageId);
    return collection<NoteLinkSummary>(`/notes/pages/${pageId}/links`, pagination);
  },
  listBacklinks: (pageId: string, pagination: PaginationInput = {}) => {
    assertId(pageId);
    return collection<NoteLinkSummary>(`/notes/pages/${pageId}/backlinks`, pagination);
  },
  listShares: (pageId: string, pagination: PaginationInput = {}) => {
    assertId(pageId);
    return collection<NotePageShareSummary>(`/notes/pages/${pageId}/shares`, pagination);
  },
  upsertShare: (pageId: string, userId: string, role: NoteShareRole) => {
    assertId(pageId);
    if (!userId || userId.length > 255) throw new Error("INVALID_NOTE_MEMBER_ID");
    return request<NotePageShareSummary>(`/notes/pages/${pageId}/shares/${encodeURIComponent(userId)}`, { method: "PUT", body: JSON.stringify({ role }) });
  },
  removeShare: (pageId: string, userId: string) => {
    assertId(pageId);
    if (!userId || userId.length > 255) throw new Error("INVALID_NOTE_MEMBER_ID");
    return request<{ removed: boolean }>(`/notes/pages/${pageId}/shares/${encodeURIComponent(userId)}`, { method: "DELETE" });
  },
  listAgendaMonth: (month: string, pagination: PaginationInput = {}) => {
    if (!isAgendaMonth(month)) throw new Error("INVALID_AGENDA_MONTH");
    assertPagination(pagination);
    return request<NoteCollection<NotePageSummary>>(`/notes/agenda${query({ month, ...pagination })}`);
  },
  getOrCreateAgendaDay: (date: string) => {
    if (!isAgendaDate(date)) throw new Error("INVALID_AGENDA_DATE");
    return request<NotePage>(`/notes/agenda/${date}`, { method: "PUT" });
  },
  listCarryover: (date: string, pagination: PaginationInput = {}) => {
    if (!isAgendaDate(date)) throw new Error("INVALID_AGENDA_DATE");
    return collection<NoteCarryoverSummary>(`/notes/agenda/${date}/carryover`, pagination);
  },
  listLegacy: (disposition: NoteLegacyDispositionFilter = "all", pagination: PaginationInput = {}) => {
    assertPagination(pagination);
    return request<NoteCollection<NoteLegacyArchiveSummary>>(`/notes/legacy${query({ disposition, ...pagination })}`);
  },
  convertLegacy: (archiveId: string, input: { actionId: string; pageId?: string }) => {
    assertId(archiveId);
    if (input.pageId) assertId(input.pageId);
    if (!input.actionId || input.actionId.length > 255) throw new Error("INVALID_NOTE_ACTION_ID");
    return request<NoteLegacyArchiveSummary>(`/notes/legacy/${archiveId}/convert`, { method: "POST", body: JSON.stringify(input) });
  },
  discardLegacy: (archiveId: string, input: { actionId: string }) => {
    assertId(archiveId);
    if (!input.actionId || input.actionId.length > 255) throw new Error("INVALID_NOTE_ACTION_ID");
    return request<NoteLegacyArchiveSummary>(`/notes/legacy/${archiveId}/discard`, { method: "POST", body: JSON.stringify(input) });
  },
};
