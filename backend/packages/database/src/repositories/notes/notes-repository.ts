/**
 * Production Notes facade. The injectable repository core is intentionally not
 * exported from package barrels; production callers are bound to the canonical
 * database root imported here and cannot supply a transaction or builder.
 */
import { db } from "../../client";
import {
  createNotePage as createNotePageCore,
  getNotePage as getNotePageCore,
  getOwnedNotePageIncludingArchived as getOwnedNotePageIncludingArchivedCore,
  listOwnedArchivedNotePages as listOwnedArchivedNotePagesCore,
  updateNotePage as updateNotePageCore,
  getOrCreateDailyNotePage as getOrCreateDailyNotePageCore,
  listDailyNotePagesByMonth as listDailyNotePagesByMonthCore,
  getNotePageTree as getNotePageTreeCore,
  searchNotePages as searchNotePagesCore,
  listNotePageShares as listNotePageSharesCore,
  setNotePageShare as setNotePageShareCore,
  removeNotePageShare as removeNotePageShareCore,
  reparentNotePage as reparentNotePageCore,
  listPendingNoteCarryover as listPendingNoteCarryoverCore,
  listDailyNoteCarryover as listDailyNoteCarryoverCore,
  updateNoteChecklistItem as updateNoteChecklistItemCore,
  listNoteChecklistItems as listNoteChecklistItemsCore,
  updateDailyCarryoverItem as updateDailyCarryoverItemCore,
  listNotePageLinks as listNotePageLinksCore,
  listNotePageBacklinks as listNotePageBacklinksCore,
  listLegacyArchiveItems as listLegacyArchiveItemsCore,
  getLegacyArchiveItem as getLegacyArchiveItemCore,
  convertLegacyArchiveItem as convertLegacyArchiveItemCore,
  discardLegacyArchiveItem as discardLegacyArchiveItemCore,
  MAX_NOTE_POSITION,
  MAX_LEGACY_CONVERSION_SNAPSHOT_BYTES,
  MAX_NOTE_LINK_SUMMARY_TEXT_CODE_POINTS,
  MAX_NOTE_SUMMARY_TEXT_CODE_POINTS,
  NOTES_GLOBAL_ADVISORY_LOCK,
  type NoteActor,
  type CreateNotePageInput,
  type UpdateNotePageInput,
  type UpdateNoteChecklistItemInput,
  type UpdateCarryoverItemInput,
  type NotePaginationInput,
  type NoteCollection,
  type NotePagination,
  type NotePageSummary,
  type NotePageWithCapabilities,
  type NotePageCapabilities,
  type NoteChecklistMutationResult,
  type NoteChecklistItemSummary,
  type NotePageShareSummary,
  type NoteCarryoverSummary,
  type NoteLinkSummary,
  type NoteLegacyArchiveSummary,
  type NoteLegacyDispositionFilter,
} from "./notes-repository-core";

export {
  MAX_NOTE_POSITION,
  MAX_LEGACY_CONVERSION_SNAPSHOT_BYTES,
  MAX_NOTE_LINK_SUMMARY_TEXT_CODE_POINTS,
  MAX_NOTE_SUMMARY_TEXT_CODE_POINTS,
  NOTES_GLOBAL_ADVISORY_LOCK,
};
export type {
  NoteActor,
  CreateNotePageInput,
  UpdateNotePageInput,
  UpdateNoteChecklistItemInput,
  UpdateCarryoverItemInput,
  NotePaginationInput,
  NoteCollection,
  NotePagination,
  NotePageSummary,
  NotePageWithCapabilities,
  NotePageCapabilities,
  NoteChecklistMutationResult,
  NoteChecklistItemSummary,
  NotePageShareSummary,
  NoteCarryoverSummary,
  NoteLinkSummary,
  NoteLegacyArchiveSummary,
  NoteLegacyDispositionFilter,
};

export const createNotePage = (input: CreateNotePageInput): Promise<NotePageWithCapabilities> => createNotePageCore(input, db);
export const getNotePage = (actor: NoteActor, pageId: string): Promise<NotePageWithCapabilities | null> => getNotePageCore(actor, pageId, db);
export const getOwnedNotePageIncludingArchived = (actor: NoteActor, pageId: string): Promise<NotePageWithCapabilities | null> => getOwnedNotePageIncludingArchivedCore(actor, pageId, db);
export const listOwnedArchivedNotePages = (actor: NoteActor, pagination?: NotePaginationInput) => listOwnedArchivedNotePagesCore(actor, db, pagination);
export const updateNotePage = (input: UpdateNotePageInput): Promise<NotePageWithCapabilities | null> => updateNotePageCore(input, db);
export const getOrCreateDailyNotePage = (actor: NoteActor, dailyDate: string): Promise<NotePageWithCapabilities> => getOrCreateDailyNotePageCore(actor, dailyDate, db);
export const listDailyNotePagesByMonth = (actor: NoteActor, month: string, pagination?: NotePaginationInput) => listDailyNotePagesByMonthCore(actor, month, db, pagination);
export const getNotePageTree = (actor: NoteActor, pagination?: NotePaginationInput) => getNotePageTreeCore(actor, db, pagination);
export const searchNotePages = (actor: NoteActor, query: string, pagination?: NotePaginationInput) => searchNotePagesCore(actor, query, db, pagination);
export const listNotePageShares = (actor: NoteActor, pageId: string, pagination?: NotePaginationInput) => listNotePageSharesCore(actor, pageId, db, pagination);
export const setNotePageShare = (input: Parameters<typeof setNotePageShareCore>[0]) => setNotePageShareCore(input, db);
export const removeNotePageShare = (input: Parameters<typeof removeNotePageShareCore>[0]): Promise<boolean> => removeNotePageShareCore(input, db);
export const reparentNotePage = (input: Parameters<typeof reparentNotePageCore>[0]) => reparentNotePageCore(input, db);
export const listPendingNoteCarryover = (actor: NoteActor, pagination?: NotePaginationInput) => listPendingNoteCarryoverCore(actor, db, pagination);
export const listDailyNoteCarryover = (actor: Parameters<typeof listDailyNoteCarryoverCore>[0], pagination?: NotePaginationInput) => listDailyNoteCarryoverCore(actor, db, pagination);
export const updateNoteChecklistItem = (input: Parameters<typeof updateNoteChecklistItemCore>[0]) => updateNoteChecklistItemCore(input, db);
export const listNoteChecklistItems = (actor: NoteActor, pageId: string, pagination?: NotePaginationInput) => listNoteChecklistItemsCore(actor, pageId, db, pagination);
export const listNotePageLinks = (input: Parameters<typeof listNotePageLinksCore>[0], pagination?: NotePaginationInput) => listNotePageLinksCore(input, db, pagination);
export const listNotePageBacklinks = (input: Parameters<typeof listNotePageBacklinksCore>[0], pagination?: NotePaginationInput) => listNotePageBacklinksCore(input, db, pagination);
export const listLegacyArchiveItems = (actor: NoteActor, options?: NotePaginationInput & { disposition?: NoteLegacyDispositionFilter }) => listLegacyArchiveItemsCore(actor, db, options);
export const getLegacyArchiveItem = (actor: NoteActor, archiveId: string) => getLegacyArchiveItemCore(actor, archiveId, db);
export const convertLegacyArchiveItem = (input: Parameters<typeof convertLegacyArchiveItemCore>[0]) => convertLegacyArchiveItemCore(input, db);
export const discardLegacyArchiveItem = (input: Parameters<typeof discardLegacyArchiveItemCore>[0]) => discardLegacyArchiveItemCore(input, db);

export const createNotesRepository = () => ({
  createPage: (input: CreateNotePageInput) => createNotePage(input),
  getPage: (actor: NoteActor, pageId: string) => getNotePage(actor, pageId),
  getOwnedPageIncludingArchived: (actor: NoteActor, pageId: string) => getOwnedNotePageIncludingArchived(actor, pageId),
  archivedPages: (actor: NoteActor, pagination?: NotePaginationInput) => listOwnedArchivedNotePages(actor, pagination),
  updatePage: (input: UpdateNotePageInput) => updateNotePage(input),
  getOrCreateDaily: (actor: NoteActor, dailyDate: string) => getOrCreateDailyNotePage(actor, dailyDate),
  listDailyByMonth: (actor: NoteActor, month: string, pagination?: NotePaginationInput) => listDailyNotePagesByMonth(actor, month, pagination),
  pageTree: (actor: NoteActor, pagination?: NotePaginationInput) => getNotePageTree(actor, pagination),
  search: (actor: NoteActor, query: string, pagination?: NotePaginationInput) => searchNotePages(actor, query, pagination),
  listShares: (actor: NoteActor, pageId: string, pagination?: NotePaginationInput) => listNotePageShares(actor, pageId, pagination),
  setShare: (input: Parameters<typeof setNotePageShare>[0]) => setNotePageShare(input),
  removeShare: (input: Parameters<typeof removeNotePageShare>[0]) => removeNotePageShare(input),
  reparent: (input: Parameters<typeof reparentNotePage>[0]) => reparentNotePage(input),
  pendingCarryover: (actor: NoteActor, pagination?: NotePaginationInput) => listPendingNoteCarryover(actor, pagination),
  dailyCarryover: (actor: Parameters<typeof listDailyNoteCarryover>[0], pagination?: NotePaginationInput) => listDailyNoteCarryover(actor, pagination),
  listDailyCarryover: (actor: Parameters<typeof listDailyNoteCarryover>[0], pagination?: NotePaginationInput) => listDailyNoteCarryover(actor, pagination),
  updateCarryoverItem: (input: UpdateCarryoverItemInput) => updateDailyCarryoverItemCore(input, db),
  updateChecklistItem: (input: Parameters<typeof updateNoteChecklistItem>[0]) => updateNoteChecklistItem(input),
  listChecklistItems: (actor: NoteActor, pageId: string, pagination?: NotePaginationInput) => listNoteChecklistItems(actor, pageId, pagination),
  links: (input: Parameters<typeof listNotePageLinks>[0], pagination?: NotePaginationInput) => listNotePageLinks(input, pagination),
  backlinks: (input: Parameters<typeof listNotePageBacklinks>[0], pagination?: NotePaginationInput) => listNotePageBacklinks(input, pagination),
  legacy: (actor: NoteActor, options?: NotePaginationInput & { disposition?: NoteLegacyDispositionFilter }) => listLegacyArchiveItems(actor, options),
  getLegacy: (actor: NoteActor, archiveId: string) => getLegacyArchiveItem(actor, archiveId),
  convertLegacy: (input: Parameters<typeof convertLegacyArchiveItem>[0]) => convertLegacyArchiveItem(input),
  discardLegacy: (input: Parameters<typeof discardLegacyArchiveItem>[0]) => discardLegacyArchiveItem(input),
});

export const getNotePageById = getNotePage;
export const getNotePages = getNotePageTree;
export const listNotes = getNotePageTree;
export const getDailyNotePage = getOrCreateDailyNotePage;
export const searchNotes = searchNotePages;
export const addNotePageShare = setNotePageShare;
export const updateChecklistItem = updateNoteChecklistItem;
export const listDailyCarryover = listDailyNoteCarryover;
export const updateCarryoverItem = (input: UpdateCarryoverItemInput) => updateDailyCarryoverItemCore(input, db);
