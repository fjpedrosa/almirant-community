import {
  createNotesRepository,
  MAX_NOTE_POSITION,
  type LexicalDocument,
  type NoteChecklistItemSummary,
  type NoteActor,
  type NoteLegacyArchiveSummary,
  type NotePageWithCapabilities,
  type NotePaginationInput,
  type NoteLegacyDispositionFilter,
} from "@almirant/database";

type PublicChecklistPage = Pick<NotePageWithCapabilities,
  "id" | "ownerUserId" | "parentId" | "kind" | "dailyDate" | "visibility" | "title" | "position" | "stateVersion" | "createdAt" | "updatedAt" | "lexicalJson" | "lexicalSchemaVersion" | "markdownProjection" | "plaintextProjection" | "archivedAt" | "canEdit" | "canCreateChild" | "canManageShares" | "canReparent" | "canArchive" | "canChangeVisibility" | "canRestore"
>;

export type PublicChecklistMutationResult = {
  item: NoteChecklistItemSummary;
  page: PublicChecklistPage;
};

const toPublicChecklistItem = (item: { itemId: string; ordinal: number; text: string; checked: boolean; completedAt: Date | null; completedByUserId: string | null; updatedAt: Date }): NoteChecklistItemSummary => ({
  itemId: item.itemId,
  ordinal: item.ordinal,
  text: item.text,
  checked: item.checked,
  completedAt: item.completedAt,
  completedByUserId: item.completedByUserId,
  updatedAt: item.updatedAt,
});

const toPublicChecklistPage = (page: NotePageWithCapabilities): PublicChecklistPage => ({
  id: page.id,
  ownerUserId: page.ownerUserId,
  parentId: page.parentId,
  kind: page.kind,
  dailyDate: page.dailyDate,
  visibility: page.visibility,
  title: page.title,
  position: page.position,
  stateVersion: page.stateVersion,
  createdAt: page.createdAt,
  updatedAt: page.updatedAt,
  lexicalJson: page.lexicalJson,
  lexicalSchemaVersion: page.lexicalSchemaVersion,
  markdownProjection: page.markdownProjection,
  plaintextProjection: page.plaintextProjection,
  archivedAt: page.archivedAt,
  canEdit: page.canEdit,
  canCreateChild: page.canCreateChild,
  canManageShares: page.canManageShares,
  canReparent: page.canReparent,
  canArchive: page.canArchive,
  canChangeVisibility: page.canChangeVisibility,
  canRestore: page.canRestore,
});

export type NotesActor = NoteActor;
export type NotesRepository = ReturnType<typeof createNotesRepository>;

export class NotesServiceError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "NotesServiceError";
  }
}

type CreatePageInput = {
  title?: string;
  parentId?: string | null;
  visibility?: "private" | "workspace";
  position?: number;
  lexicalJson?: LexicalDocument;
};

type UpdatePageInput = CreatePageInput & {
  expectedVersion: number;
};

type VersionInput = { expectedVersion: number };
export type NotesPaginationInput = NotePaginationInput;

const NOTE_NOT_FOUND = () =>
  new NotesServiceError("NOTE_NOT_FOUND", 404, "Note not found");
const VERSION_CONFLICT = () =>
  new NotesServiceError("NOTE_VERSION_CONFLICT", 409, "Note version conflict");

const knownRepositoryError = (error: unknown): NotesServiceError => {
  if (error instanceof NotesServiceError) return error;
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("Invalid Lexical document:")) {
    return new NotesServiceError("INVALID_CONTENT", 422, "Note content is invalid");
  }
  switch (message) {
    case "NOTE_PAGE_CYCLE":
      return new NotesServiceError("NOTE_PAGE_CYCLE", 409, "Note hierarchy would contain a cycle");
    case "LEGACY_REPLAY_MISMATCH":
      return new NotesServiceError("LEGACY_REPLAY_CONFLICT", 409, "Legacy archive action conflicts with an existing action");
    case "LEGACY_SNAPSHOT_TOO_LARGE":
      return new NotesServiceError("LEGACY_SNAPSHOT_TOO_LARGE", 422, "Legacy archive snapshot exceeds the conversion limit");
    case "LEGACY_SNAPSHOT_INVALID":
      return new NotesServiceError("LEGACY_SNAPSHOT_INVALID", 422, "Legacy archive snapshot is invalid");
    case "PARENT_NOT_FOUND":
    case "PAGE_NOT_FOUND":
    case "NOTE_LINK_TARGET_NOT_FOUND":
    case "ACL_OWNER_REQUIRED":
    case "USER_NOT_MEMBER":
      return NOTE_NOT_FOUND();
    case "DAILY_PAGE_CANNOT_ARCHIVE":
      return new NotesServiceError("DAILY_PAGE_CANNOT_ARCHIVE", 422, "Daily notes cannot be archived");
    case "ACTION_ID_REQUIRED":
      return new NotesServiceError("ACTION_ID_REQUIRED", 422, "actionId is required");
    case "CHECKLIST_ITEM_ID_REUSED":
    case "CHECKLIST_PROJECTION_UPDATE_FAILED":
      return new NotesServiceError("INVALID_CONTENT", 422, "Note checklist content is invalid");
    case "INVALID_PAGINATION":
      return new NotesServiceError("INVALID_PAGINATION", 422, "Pagination is invalid");
    case "INVALID_POSITION":
      return new NotesServiceError("INVALID_POSITION", 422, "position must be a PostgreSQL int4");
    case "INVALID_LEGACY_DISPOSITION":
      return new NotesServiceError("INVALID_LEGACY_DISPOSITION", 422, "Legacy disposition is invalid");
    case "ACTOR_CONTRACT_INVALID":
    case "AGENT_JOB_REQUIRED":
    case "AGENT_JOB_NOT_FOUND":
      return new NotesServiceError("NOTE_NOT_FOUND", 404, "Note not found");
    default:
      return new NotesServiceError(
        "NOTES_INTERNAL_ERROR",
        500,
        "Notes operation failed",
        { cause: error },
      );
  }
};

const callRepository = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    throw knownRepositoryError(error);
  }
};

const assertExpectedVersion = (version: number): void => {
  if (!Number.isInteger(version) || version < 1) {
    throw new NotesServiceError(
      "INVALID_VERSION",
      422,
      "expectedVersion must be a positive integer",
    );
  }
};

const assertPosition = (position: number | undefined): void => {
  if (
    position !== undefined
    && (!Number.isInteger(position) || position < 0 || position > MAX_NOTE_POSITION)
  ) {
    throw new NotesServiceError(
      "INVALID_POSITION",
      422,
      `position must be an integer between 0 and ${MAX_NOTE_POSITION}`,
    );
  }
};

const normalizePagination = (
  input: NotesPaginationInput = {},
  defaultLimit = 50,
): Required<NotesPaginationInput> => {
  const limit = input.limit ?? defaultLimit;
  const offset = input.offset ?? 0;
  if (
    !Number.isInteger(limit)
    || limit < 1
    || limit > 100
    || !Number.isInteger(offset)
    || offset < 0
    || offset > 100_000
  ) {
    throw new NotesServiceError("INVALID_PAGINATION", 422, "Pagination is invalid");
  }
  return { limit, offset };
};

const LEGACY_ARCHIVE_SUMMARY_KEYS = new Set([
  "id",
  "sourceType",
  "sourceId",
  "sourceTitle",
  "sourcePreview",
  "disposition",
  "convertedPageId",
  "convertedActionId",
  "dispositionAt",
  "createdAt",
  "updatedAt",
]);

const toLegacyArchiveSummary = (
  value: NoteLegacyArchiveSummary,
): NoteLegacyArchiveSummary => {
  // Production repositories already return the transaction-local safe DTO.
  // Preserve that exact object; only re-project malformed/injected adapters
  // that attempt to attach internal fields.
  const keys = Object.keys(value);
  if (
    keys.length === LEGACY_ARCHIVE_SUMMARY_KEYS.size
    && keys.every((key) => LEGACY_ARCHIVE_SUMMARY_KEYS.has(key))
  ) {
    return value;
  }
  return {
    id: value.id,
    sourceType: value.sourceType,
    sourceId: value.sourceId,
    sourceTitle: value.sourceTitle,
    sourcePreview: value.sourcePreview,
    disposition: value.disposition,
    convertedPageId: value.convertedPageId,
    convertedActionId: value.convertedActionId,
    dispositionAt: value.dispositionAt,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
};

const assertMonth = (month: string): void => {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  const year = match ? Number(match[1]) : 0;
  const monthNumber = match ? Number(match[2]) : 0;
  if (!match || year < 1 || monthNumber < 1 || monthNumber > 12) {
    throw new NotesServiceError("INVALID_MONTH", 400, "Month must use YYYY-MM");
  }
};

const isLeapYear = (year: number) =>
  year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

const assertDate = (date: string): void => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    throw new NotesServiceError("INVALID_DATE", 400, "Date must use YYYY-MM-DD");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysByMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysByMonth[month - 1]!) {
    throw new NotesServiceError("INVALID_DATE", 400, "Date must be a valid YYYY-MM-DD date");
  }
};

export class NotesService {
  constructor(private readonly repository: NotesRepository) {}

  listPages(actor: NotesActor, pagination: NotesPaginationInput = {}) {
    return callRepository(() => this.repository.pageTree(actor, normalizePagination(pagination)));
  }

  async getPage(actor: NotesActor, pageId: string): Promise<NotePageWithCapabilities> {
    const page = await callRepository(() => this.repository.getPage(actor, pageId));
    if (!page) throw NOTE_NOT_FOUND();
    return page;
  }

  async createPage(actor: NotesActor, input: CreatePageInput) {
    assertPosition(input.position);
    const created = await callRepository(() => this.repository.createPage({
      ...actor,
      title: input.title?.trim() ?? "",
      parentId: input.parentId ?? null,
      visibility: input.visibility ?? "private",
      position: input.position ?? 0,
      lexicalJson: input.lexicalJson,
    }));
    return created;
  }

  async updatePage(actor: NotesActor, pageId: string, input: UpdatePageInput) {
    assertExpectedVersion(input.expectedVersion);
    assertPosition(input.position);
    const current = await this.getPage(actor, pageId);
    if (current.stateVersion !== input.expectedVersion) throw VERSION_CONFLICT();
    const updated = await callRepository(() => this.repository.updatePage({
      ...actor,
      pageId,
      expectedStateVersion: input.expectedVersion,
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
      ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
      ...(input.position !== undefined ? { position: input.position } : {}),
      ...(input.lexicalJson !== undefined ? { lexicalJson: input.lexicalJson } : {}),
    }));
    if (updated) return updated;
    return this.resolveMutationMiss(
      actor,
      pageId,
      input.expectedVersion,
      current.ownerUserId === actor.userId,
    );
  }

  async reparentPage(
    actor: NotesActor,
    pageId: string,
    input: VersionInput & { parentId: string | null },
  ) {
    assertExpectedVersion(input.expectedVersion);
    const current = await this.getOwnerPage(actor, pageId);
    if (current.stateVersion !== input.expectedVersion) throw VERSION_CONFLICT();
    const updated = await callRepository(() => this.repository.reparent({
      ...actor,
      pageId,
      parentId: input.parentId,
      expectedStateVersion: input.expectedVersion,
    }));
    if (updated) return updated;
    return this.resolveMutationMiss(actor, pageId, input.expectedVersion, true);
  }

  async archivePage(actor: NotesActor, pageId: string, input: VersionInput) {
    assertExpectedVersion(input.expectedVersion);
    const current = await this.getOwnerPage(actor, pageId);
    if (current.stateVersion !== input.expectedVersion) throw VERSION_CONFLICT();
    const updated = await callRepository(() => this.repository.updatePage({
      ...actor,
      pageId,
      expectedStateVersion: input.expectedVersion,
      archivedAt: new Date(),
    }));
    if (updated) return updated;
    return this.resolveMutationMiss(actor, pageId, input.expectedVersion, true);
  }

  async restorePage(actor: NotesActor, pageId: string, input: VersionInput) {
    assertExpectedVersion(input.expectedVersion);
    const current = await callRepository(() =>
      this.repository.getOwnedPageIncludingArchived(actor, pageId));
    if (!current) throw NOTE_NOT_FOUND();
    if (current.stateVersion !== input.expectedVersion) throw VERSION_CONFLICT();
    if (current.archivedAt === null) return current;
    const updated = await callRepository(() => this.repository.updatePage({
      ...actor,
      pageId,
      expectedStateVersion: input.expectedVersion,
      archivedAt: null,
    }));
    if (updated) return updated;
    const latest = await callRepository(() =>
      this.repository.getOwnedPageIncludingArchived(actor, pageId));
    if (latest && latest.stateVersion !== input.expectedVersion) throw VERSION_CONFLICT();
    throw NOTE_NOT_FOUND();
  }

  async searchPages(actor: NotesActor, input: { query: string; limit?: number; offset?: number }) {
    const query = input.query.trim();
    if (!query || query.length > 200) {
      throw new NotesServiceError(
        "INVALID_QUERY",
        422,
        "Search query must contain between 1 and 200 characters",
      );
    }
    const pagination = normalizePagination(input, 20);
    return callRepository(() => this.repository.search(actor, query, pagination));
  }

  listArchivedPages(actor: NotesActor, pagination: NotesPaginationInput = {}) {
    return callRepository(() => this.repository.archivedPages(
      actor,
      normalizePagination(pagination),
    ));
  }

  async updateChecklistItem(
    actor: NotesActor,
    pageId: string,
    itemId: string,
    input: VersionInput & { checked: boolean },
  ): Promise<PublicChecklistMutationResult> {
    assertExpectedVersion(input.expectedVersion);
    const current = await this.getPage(actor, pageId);
    if (current.stateVersion !== input.expectedVersion) throw VERSION_CONFLICT();
    const item = await callRepository(() => this.repository.updateChecklistItem({
      ...actor,
      pageId,
      itemId,
      checked: input.checked,
      expectedStateVersion: input.expectedVersion,
    }));
    if (item) {
      return {
        item: toPublicChecklistItem(item.item ?? item),
        page: toPublicChecklistPage(item.page),
      };
    }
    await this.resolveMutationMiss(
      actor,
      pageId,
      input.expectedVersion,
      current.ownerUserId === actor.userId,
    );
    throw NOTE_NOT_FOUND();
  }

  async listChecklistItems(
    actor: NotesActor,
    pageId: string,
    pagination: NotesPaginationInput = {},
  ) {
    await this.getPage(actor, pageId);
    return callRepository(() => this.repository.listChecklistItems(
      actor,
      pageId,
      normalizePagination(pagination),
    ));
  }

  async listLinks(actor: NotesActor, pageId: string, pagination: NotesPaginationInput = {}) {
    await this.getPage(actor, pageId);
    return callRepository(() => this.repository.links({ ...actor, pageId }, normalizePagination(pagination)));
  }

  async listBacklinks(actor: NotesActor, pageId: string, pagination: NotesPaginationInput = {}) {
    await this.getPage(actor, pageId);
    return callRepository(() => this.repository.backlinks({ ...actor, pageId }, normalizePagination(pagination)));
  }

  async listShares(actor: NotesActor, pageId: string, pagination: NotesPaginationInput = {}) {
    const shares = await callRepository(() => this.repository.listShares(actor, pageId, normalizePagination(pagination)));
    if (shares === null) throw NOTE_NOT_FOUND();
    return shares;
  }

  upsertShare(
    actor: NotesActor,
    pageId: string,
    sharedWithUserId: string,
    role: "viewer" | "editor",
  ) {
    return callRepository(() => this.repository.setShare({
      ...actor,
      pageId,
      sharedWithUserId,
      role,
    }));
  }

  async removeShare(actor: NotesActor, pageId: string, sharedWithUserId: string) {
    const removed = await callRepository(() => this.repository.removeShare({
      ...actor,
      pageId,
      sharedWithUserId,
    }));
    return { removed };
  }

  async listAgendaMonth(actor: NotesActor, month: string, pagination: NotesPaginationInput = {}) {
    assertMonth(month);
    return callRepository(() => this.repository.listDailyByMonth(actor, month, normalizePagination(pagination)));
  }

  async getOrCreateAgendaDay(actor: NotesActor, date: string) {
    assertDate(date);
    const page = await callRepository(() => this.repository.getOrCreateDaily(actor, date));
    return page;
  }

  async listAgendaCarryover(actor: NotesActor, date: string, pagination: NotesPaginationInput = {}) {
    assertDate(date);
    return callRepository(() => this.repository.listDailyCarryover({ ...actor, dailyDate: date }, normalizePagination(pagination)));
  }

  async listLegacyArchive(
    actor: NotesActor,
    input: NotesPaginationInput & { disposition?: NoteLegacyDispositionFilter } = {},
  ) {
    const result = await callRepository(() => this.repository.legacy(actor, {
      ...normalizePagination(input),
      disposition: input.disposition ?? "all",
    }));
    return {
      ...result,
      items: result.items.map(toLegacyArchiveSummary),
    };
  }

  async convertLegacyArchive(
    actor: NotesActor,
    archiveId: string,
    input: { pageId?: string; actionId: string },
  ) {
    await this.assertLegacyArchiveVisible(actor, archiveId);
    const result = await callRepository(() => this.repository.convertLegacy({
      ...actor,
      archiveId,
      ...(input.pageId !== undefined ? { pageId: input.pageId } : {}),
      actionId: input.actionId,
    }));
    return toLegacyArchiveSummary(result);
  }

  async discardLegacyArchive(
    actor: NotesActor,
    archiveId: string,
    input: { actionId: string },
  ) {
    await this.assertLegacyArchiveVisible(actor, archiveId);
    const result = await callRepository(() => this.repository.discardLegacy({
      ...actor,
      archiveId,
      actionId: input.actionId,
    }));
    return toLegacyArchiveSummary(result);
  }

  private async getOwnerPage(actor: NotesActor, pageId: string) {
    const page = await this.getPage(actor, pageId);
    if (page.ownerUserId !== actor.userId) throw NOTE_NOT_FOUND();
    return page;
  }

  private async assertLegacyArchiveVisible(actor: NotesActor, archiveId: string) {
    const item = await callRepository(() => this.repository.getLegacy(actor, archiveId));
    if (!item) throw NOTE_NOT_FOUND();
  }

  private async resolveMutationMiss(
    actor: NotesActor,
    pageId: string,
    expectedVersion: number,
    ownerOnly = false,
  ): Promise<never> {
    const latest = await callRepository(() => ownerOnly
      ? this.repository.getOwnedPageIncludingArchived(actor, pageId)
      : this.repository.getPage(actor, pageId));
    if (!latest || (ownerOnly && latest.ownerUserId !== actor.userId)) throw NOTE_NOT_FOUND();
    if (latest.stateVersion !== expectedVersion) throw VERSION_CONFLICT();
    throw NOTE_NOT_FOUND();
  }
}

export const createNotesService = (
  repository: NotesRepository = createNotesRepository(),
) => new NotesService(repository);

export const notesService = createNotesService();
