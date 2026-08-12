import { db } from "../../client";
import {
  member,
  agentJobs,
  noteChecklistItems,
  noteLegacyArchiveItems,
  notePageLinks,
  notePageShares,
  notePages,
  type NoteChecklistItem,
  type NotePage,
} from "../../schema";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
  getTableColumns,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  projectLexicalDocument,
  projectLexicalDocumentFromSnapshot,
  snapshotLexicalDocument,
  setChecklistItemChecked,
  type LexicalDocument,
  type ChecklistProjection,
} from "../../notes/lexical-projector";
import {
  MAX_LEGACY_CONVERSION_SNAPSHOT_BYTES,
  serializeLegacySnapshotForConversion,
} from "../../notes/legacy-snapshot-serializer";

export { MAX_LEGACY_CONVERSION_SNAPSHOT_BYTES };

type DatabaseLike = any;

export type NoteActor = {
  workspaceId: string;
  userId: string;
  actorKind?: "user" | "agent";
  agentJobId?: string | null;
  channel?: string | null;
  tool?: string | null;
};

export type CreateNotePageInput = NoteActor & {
  ownerUserId?: string;
  parentId?: string | null;
  kind?: "page" | "daily";
  dailyDate?: string | null;
  visibility?: "private" | "workspace";
  title?: string;
  position?: number;
  lexicalJson?: LexicalDocument;
};

export type UpdateNotePageInput = NoteActor & {
  pageId: string;
  expectedStateVersion: number;
  title?: string;
  parentId?: string | null;
  position?: number;
  visibility?: "private" | "workspace";
  lexicalJson?: LexicalDocument;
  archivedAt?: Date | null;
};

export type UpdateNoteChecklistItemInput = NoteActor & {
  pageId: string;
  itemId: string;
  checked: boolean;
  expectedStateVersion: number;
};

export type UpdateCarryoverItemInput = Omit<UpdateNoteChecklistItemInput, "pageId"> & {
  sourcePageId: string;
};

export type NoteChecklistMutationResult = NoteChecklistItem & {
  item: NoteChecklistItem;
  page: NotePageWithCapabilities;
};

export type NoteChecklistItemSummary = {
  itemId: string;
  ordinal: number;
  text: string;
  checked: boolean;
  completedAt: Date | null;
  completedByUserId: string | null;
  updatedAt: Date;
};

export type NotePaginationInput = {
  limit?: number;
  offset?: number;
};

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
  canCreateChild?: boolean;
  canManageShares: boolean;
  canReparent: boolean;
  canArchive: boolean;
  canChangeVisibility: boolean;
  canRestore: boolean;
};

export type NotePageWithCapabilities = NotePage & NotePageCapabilities;

export type NotePageSummary = NotePageCapabilities & {
  id: string;
  ownerUserId: string;
  parentId: string | null;
  kind: "page" | "daily";
  dailyDate: string | null;
  visibility: "private" | "workspace";
  title: string;
  position: number;
  stateVersion: number;
  createdAt: Date;
  updatedAt: Date;
};

export type NoteLegacyDispositionFilter = "pending" | "converted" | "discarded" | "terminal" | "all";

export type NoteLegacyArchiveSummary = {
  id: string;
  sourceType: "todo" | "idea" | "seed";
  sourceId: string;
  sourceTitle: string;
  sourcePreview: string;
  disposition: "pending" | "converted" | "discarded";
  convertedPageId: string | null;
  convertedActionId: string | null;
  dispositionAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type NotePageShareSummary = {
  id: string;
  pageId: string;
  sharedWithUserId: string;
  role: "viewer" | "editor";
  createdAt: Date;
  updatedAt: Date;
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

export type NoteLinkSummary = {
  id: string;
  sourcePageId: string;
  sourceTitle: string;
  targetPageId: string;
  ordinal: number;
  anchorText: string;
  createdAt: Date;
};

export const MAX_NOTE_POSITION = 2_147_483_647;
const DEFAULT_COLLECTION_LIMIT = 50;
export const MAX_NOTE_COLLECTION_LIMIT = 100;
export const MAX_NOTE_COLLECTION_OFFSET = 100_000;
export const MAX_NOTE_SUMMARY_TEXT_CODE_POINTS = 512;
export const MAX_NOTE_LINK_SUMMARY_TEXT_CODE_POINTS = 256;

const assertNotePosition = (position: number | undefined): void => {
  if (
    position !== undefined
    && (!Number.isInteger(position) || position < 0 || position > MAX_NOTE_POSITION)
  ) {
    throw new Error("INVALID_POSITION");
  }
};

const normalizePagination = (
  input: NotePaginationInput = {},
): Required<NotePaginationInput> => {
  const limit = input.limit ?? DEFAULT_COLLECTION_LIMIT;
  const offset = input.offset ?? 0;
  if (
    !Number.isInteger(limit)
    || limit < 1
    || limit > MAX_NOTE_COLLECTION_LIMIT
    || !Number.isInteger(offset)
    || offset < 0
    || offset > MAX_NOTE_COLLECTION_OFFSET
  ) {
    throw new Error("INVALID_PAGINATION");
  }
  return { limit, offset };
};

const collectionFromRows = <T>(
  rows: T[],
  pagination: Required<NotePaginationInput>,
): NoteCollection<T> => {
  const hasMore = rows.length > pagination.limit;
  const items = hasMore ? rows.slice(0, pagination.limit) : rows;
  return {
    items,
    pagination: {
      ...pagination,
      hasMore,
      nextOffset: hasMore ? pagination.offset + items.length : null,
    },
  };
};

const emptyCollection = <T>(pagination: Required<NotePaginationInput>): NoteCollection<T> =>
  collectionFromRows<T>([], pagination);

const membership = (workspaceId: string, userId: string) =>
  sql`EXISTS (SELECT 1 FROM "member" acl_member WHERE acl_member."workspace_id" = ${workspaceId} AND acl_member."user_id" = ${userId})`;

const recursiveAncestorAcl = (
  workspaceId: string,
  userId: string,
  role: "viewer" | "editor",
  pages: any = notePages,
) => {
  const ancestorShareCondition = role === "editor"
    ? sql`ancestor_share."role" = 'editor'`
    : sql`ancestor_share."role" IN ('viewer', 'editor')`;
  const ancestorVisibilityCondition = role === "viewer"
    ? sql`OR ancestors."visibility" = 'workspace'`
    : sql``;
  return sql`EXISTS (
  WITH RECURSIVE ancestors AS (
    SELECT parent."id", parent."parent_id", parent."owner_user_id", parent."visibility"
    FROM "note_pages" child
    JOIN "note_pages" parent ON parent."id" = child."parent_id"
    WHERE child."id" = ${pages.id}
      AND parent."workspace_id" = ${workspaceId}
      AND parent."archived_at" IS NULL
    UNION
    SELECT next_parent."id", next_parent."parent_id", next_parent."owner_user_id", next_parent."visibility"
    FROM ancestors previous
    JOIN "note_pages" next_parent ON next_parent."id" = previous."parent_id"
    WHERE next_parent."workspace_id" = ${workspaceId}
      AND next_parent."archived_at" IS NULL
  )
  SELECT 1
  FROM ancestors
  LEFT JOIN "note_page_shares" ancestor_share
    ON ancestor_share."page_id" = ancestors."id"
   AND ancestor_share."workspace_id" = ${workspaceId}
   AND ancestor_share."shared_with_user_id" = ${userId}
  WHERE ancestors."owner_user_id" = ${userId}
     OR ${ancestorShareCondition}
     ${ancestorVisibilityCondition}
)`;
};

const aclCondition = (
  workspaceId: string,
  userId: string,
  role: "viewer" | "editor" = "viewer",
  pages: any = notePages,
) => {
  const shareCondition = role === "editor"
    ? sql`share."role" = 'editor'`
    : sql`share."role" IN ('viewer', 'editor')`;
  const workspaceBranch = role === "viewer"
    ? sql`OR ${pages.visibility} = 'workspace'`
    : sql``;
  return sql`(${membership(workspaceId, userId)} AND (
    ${pages.ownerUserId} = ${userId}
    ${workspaceBranch}
    OR EXISTS (
      SELECT 1 FROM "note_page_shares" share
      WHERE share."page_id" = ${pages.id}
        AND share."workspace_id" = ${workspaceId}
        AND share."shared_with_user_id" = ${userId}
        AND ${shareCondition}
    )
    OR ${recursiveAncestorAcl(workspaceId, userId, role, pages)}
  ))`;
};

const noteCapabilitySelection = (
  actor: NoteActor,
  pages: any = notePages,
) => {
  const active = sql<boolean>`${pages.archivedAt} IS NULL`;
  const regularPage = sql<boolean>`${pages.kind} = 'page'`;
  const owner = sql<boolean>`(${membership(actor.workspaceId, actor.userId)} AND ${pages.ownerUserId} = ${actor.userId})`;
  return {
    canEdit: sql<boolean>`(${active} AND ${aclCondition(actor.workspaceId, actor.userId, "editor", pages)})`,
    canCreateChild: sql<boolean>`(${active} AND ${regularPage} AND ${aclCondition(actor.workspaceId, actor.userId, "editor", pages)})`,
    canManageShares: sql<boolean>`(${active} AND ${owner})`,
    canReparent: sql<boolean>`(${active} AND ${owner})`,
    canArchive: sql<boolean>`(${active} AND ${regularPage} AND ${owner})`,
    canChangeVisibility: sql<boolean>`(${active} AND ${owner})`,
    canRestore: sql<boolean>`(${pages.archivedAt} IS NOT NULL AND ${regularPage} AND ${owner})`,
  };
};

type NotePageSnapshotScope = "active-visible" | "owner-including-archived";

/**
 * Projects the command actor's exact safe page view on the same database
 * handle that owns the mutation. Write paths call this before their
 * transaction/global-lock scope ends, so the returned state and capabilities
 * cannot be replaced by a later transaction's state.
 */
const projectNotePageSnapshot = async (
  database: DatabaseLike,
  actor: NoteActor,
  pageId: string,
  scope: NotePageSnapshotScope = "active-visible",
): Promise<NotePageWithCapabilities | null> => {
  const authorization = scope === "owner-including-archived"
    ? and(
        eq(notePages.ownerUserId, actor.userId),
        membership(actor.workspaceId, actor.userId),
      )
    : and(
        isNull(notePages.archivedAt),
        aclCondition(actor.workspaceId, actor.userId),
      );
  const [page] = await database
    .select({
      ...getTableColumns(notePages),
      ...noteCapabilitySelection(actor),
    })
    .from(notePages)
    .where(and(
      eq(notePages.id, pageId),
      eq(notePages.workspaceId, actor.workspaceId),
      authorization,
    ))
    .limit(1);
  return (page as NotePageWithCapabilities | undefined) ?? null;
};

const notePageSummarySelection = (actor: NoteActor, pages: any = notePages) => ({
  id: pages.id,
  ownerUserId: pages.ownerUserId,
  parentId: pages.parentId,
  kind: pages.kind,
  dailyDate: pages.dailyDate,
  visibility: pages.visibility,
  title: sql<string>`left(${pages.title}, ${MAX_NOTE_SUMMARY_TEXT_CODE_POINTS})`,
  position: pages.position,
  stateVersion: pages.stateVersion,
  createdAt: pages.createdAt,
  updatedAt: pages.updatedAt,
  ...noteCapabilitySelection(actor, pages),
});

const editorDestinationAcl = (workspaceId: string, userId: string, pageId: string) => sql`EXISTS (
  SELECT 1 FROM "note_pages" destination
  WHERE destination."id" = ${pageId}
    AND destination."workspace_id" = ${workspaceId}
    AND destination."archived_at" IS NULL
    AND ${membership(workspaceId, userId)}
    AND (
      destination."owner_user_id" = ${userId}
      OR EXISTS (SELECT 1 FROM "note_page_shares" destination_share WHERE destination_share."page_id" = destination."id" AND destination_share."workspace_id" = ${workspaceId} AND destination_share."shared_with_user_id" = ${userId} AND destination_share."role" = 'editor')
      OR EXISTS (
        WITH RECURSIVE ancestors AS (
          SELECT parent."id", parent."parent_id", parent."owner_user_id"
          FROM "note_pages" child JOIN "note_pages" parent ON parent."id" = child."parent_id"
          WHERE child."id" = destination."id"
            AND parent."workspace_id" = ${workspaceId}
            AND parent."archived_at" IS NULL
          UNION
          SELECT next_parent."id", next_parent."parent_id", next_parent."owner_user_id"
          FROM ancestors previous JOIN "note_pages" next_parent ON next_parent."id" = previous."parent_id"
          WHERE next_parent."workspace_id" = ${workspaceId}
            AND next_parent."archived_at" IS NULL
        )
        SELECT 1 FROM ancestors ancestor
        LEFT JOIN "note_page_shares" ancestor_share ON ancestor_share."page_id" = ancestor."id" AND ancestor_share."workspace_id" = ${workspaceId} AND ancestor_share."shared_with_user_id" = ${userId}
        WHERE ancestor."owner_user_id" = ${userId} OR ancestor_share."role" = 'editor'
      )
    )
)`;

const ensureMember = async (database: DatabaseLike, workspaceId: string, userId: string) => {
  const [row] = await database
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.workspaceId, workspaceId), eq(member.userId, userId)))
    .limit(1);
  if (!row) throw new Error("USER_NOT_MEMBER");
};

const hasMembership = async (database: DatabaseLike, workspaceId: string, userId: string) => {
  const [row] = await database.select({ id: member.id }).from(member).where(and(eq(member.workspaceId, workspaceId), eq(member.userId, userId))).limit(1);
  return Boolean(row);
};

const actorKind = (actor: NoteActor): "user" | "agent" => {
  if (actor.actorKind !== undefined && actor.actorKind !== "user" && actor.actorKind !== "agent") throw new Error("ACTOR_CONTRACT_INVALID");
  return actor.actorKind ?? "user";
};

// The migration installs BEFORE STATEMENT triggers with this same global key.
// Acquiring it before any row/reference lock gives repository and raw DML one
// total order (correctness-first for v1, intentionally cross-workspace).
export const NOTES_GLOBAL_ADVISORY_LOCK = 679001122334455;
const lockNotesGlobal = async (database: DatabaseLike) => {
  await database.execute(sql`SELECT pg_advisory_xact_lock(${NOTES_GLOBAL_ADVISORY_LOCK}::bigint)`);
};

const lockNotePages = async (database: DatabaseLike, workspaceId: string, pageIds: Array<string | null | undefined>) => {
  const ids = [...new Set(pageIds.filter((id): id is string => Boolean(id)))].sort();
  if (!ids.length) return;
  await database.execute(sql`
    SELECT "id" FROM "note_pages"
    WHERE "workspace_id" = ${workspaceId}
      AND "id" IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
    ORDER BY "id"
    FOR UPDATE
  `);
};

const verifyLockedLinkTargets = async (database: DatabaseLike, workspaceId: string, userId: string, targetPageIds: string[]) => {
  const ids = [...new Set(targetPageIds)].sort();
  if (!ids.length) return;
  const rows = await database
    .select({ id: notePages.id })
    .from(notePages)
    .where(and(
      eq(notePages.workspaceId, workspaceId),
      inArray(notePages.id, ids),
      isNull(notePages.archivedAt),
      aclCondition(workspaceId, userId, "viewer"),
    ));
  if (rows.length !== ids.length) throw new Error("NOTE_LINK_TARGET_NOT_FOUND");
};

const lockChecklistRows = async (database: DatabaseLike, workspaceId: string, pageId: string, itemIds?: string[]) => {
  await database.execute(sql`
    SELECT "id" FROM "note_pages"
    WHERE "workspace_id" = ${workspaceId} AND "id" = ${pageId}
    FOR UPDATE
  `);
  if (itemIds?.length) {
    const ids = [...new Set(itemIds)].sort();
    await database.execute(sql`
      SELECT "id" FROM "note_checklist_items"
      WHERE "workspace_id" = ${workspaceId} AND "page_id" = ${pageId}
        AND "item_id" IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
      ORDER BY "item_id"
      FOR UPDATE
    `);
    return;
  }
  await database.execute(sql`
    SELECT "id" FROM "note_checklist_items"
    WHERE "workspace_id" = ${workspaceId} AND "page_id" = ${pageId}
    ORDER BY "item_id"
    FOR UPDATE
  `);
};

const lockPageLinks = async (database: DatabaseLike, workspaceId: string, pageId: string) => {
  await database.execute(sql`
    SELECT "id" FROM "note_page_links"
    WHERE "workspace_id" = ${workspaceId} AND "source_page_id" = ${pageId}
    ORDER BY "id"
    FOR UPDATE
  `);
};

const ensureActor = async (database: DatabaseLike, actor: NoteActor) => {
  const kind = actorKind(actor);
  await ensureMember(database, actor.workspaceId, actor.userId);
  if (kind === "agent") {
    if (!actor.agentJobId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(actor.agentJobId)) throw new Error("AGENT_JOB_REQUIRED");
    const [job] = await database.select({ id: agentJobs.id }).from(agentJobs).where(and(eq(agentJobs.id, actor.agentJobId), eq(agentJobs.workspaceId, actor.workspaceId))).limit(1);
    if (!job) throw new Error("AGENT_JOB_NOT_FOUND");
  } else if (actor.agentJobId) {
    throw new Error("ACTOR_CONTRACT_INVALID");
  }
};

const project = (lexicalJson?: LexicalDocument) => {
  // Snapshot synchronously before the first await; callers may mutate their
  // Lexical object while a concurrent writer holds the global lock.
  try {
    const source = lexicalJson === undefined ? { root: { type: "root", version: 1, children: [] } } : lexicalJson;
    const value = snapshotLexicalDocument(source) as LexicalDocument;
    return { value, projection: projectLexicalDocumentFromSnapshot(value) };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Invalid Lexical document:")) throw error;
    throw new Error(`Invalid Lexical document: ${error instanceof Error ? error.message : "document could not be cloned"}`);
  }
};

const inTransaction = async <T>(database: DatabaseLike, callback: (transaction: DatabaseLike) => Promise<T>): Promise<T> => {
  if (!database || typeof database !== "object" || typeof database.transaction !== "function") throw new Error("TRANSACTION_REQUIRED");
  return database.transaction(async (transaction: DatabaseLike) => {
    if (!transaction || typeof transaction !== "object") throw new Error("TRANSACTION_REQUIRED");
    await lockNotesGlobal(transaction);
    return callback(transaction);
  });
};

const syncProjections = async (
  database: any,
  page: NotePage,
  lexicalJson: LexicalDocument,
  actor?: NoteActor,
) => {
  const previousRows = await database
    .select()
    .from(noteChecklistItems)
    .where(eq(noteChecklistItems.pageId, page.id));
  const projection = projectLexicalDocumentFromSnapshot(lexicalJson, {
    previousChecklist: previousRows.map((row: any) => ({ itemId: row.itemId, checked: row.checked })),
  });
  const previousById = new Map<string, any>(
    previousRows.map((row: any) => [row.itemId, row]),
  );
  const seenIds = projection.checklist.map((item) => item.itemId);
  if (seenIds.length) {
    const reused = await database.select({ itemId: noteChecklistItems.itemId, pageId: noteChecklistItems.pageId })
      .from(noteChecklistItems)
      .where(inArray(noteChecklistItems.itemId, seenIds));
    if (reused.some((row: any) => row.pageId !== page.id)) throw new Error("CHECKLIST_ITEM_ID_REUSED");
  }
  if (previousRows.length) {
    await database.update(noteChecklistItems)
      .set({ ordinal: sql`${noteChecklistItems.ordinal} + 1000000` })
      .where(and(eq(noteChecklistItems.pageId, page.id), eq(noteChecklistItems.workspaceId, page.workspaceId)));
  }
  if (seenIds.length) {
    await database
      .delete(noteChecklistItems)
      .where(and(eq(noteChecklistItems.pageId, page.id), sql`${noteChecklistItems.itemId} NOT IN (${sql.join(seenIds.map((id) => sql`${id}::uuid`), sql`, `)})`));
  } else {
    await database.delete(noteChecklistItems).where(eq(noteChecklistItems.pageId, page.id));
  }
  for (const item of projection.checklist) {
    const previous = previousById.get(item.itemId);
    const completedAt = item.checked ? (previous?.completedAt ?? new Date()) : null;
    const completionChanged = previous?.checked !== item.checked;
    const kind = actorKind(actor ?? { workspaceId: page.workspaceId, userId: page.ownerUserId });
    const completedByUserId = item.checked ? (completionChanged ? actor?.userId ?? null : previous?.completedByUserId ?? null) : null;
    const completedByAgentJobId = item.checked ? (completionChanged ? (kind === "agent" ? actor?.agentJobId ?? null : null) : previous?.completedByAgentJobId ?? null) : null;
    const completedByChannel = item.checked ? (completionChanged ? (actor?.channel ?? previous?.completedByChannel ?? null) : previous?.completedByChannel ?? null) : null;
    const completedByTool = item.checked ? (completionChanged ? (actor?.tool ?? previous?.completedByTool ?? null) : previous?.completedByTool ?? null) : null;
    const completedByKind = item.checked ? (completionChanged ? kind : previous?.completedByKind ?? kind) : null;
    const unchanged = previous && previous.ordinal === item.ordinal && previous.text === item.text && previous.checked === item.checked && Boolean(previous.completedAt) === Boolean(completedAt) && previous.completedByUserId === completedByUserId && previous.completedByAgentJobId === completedByAgentJobId && previous.completedByChannel === completedByChannel && previous.completedByTool === completedByTool && previous.completedByKind === completedByKind;
    if (unchanged) {
      // Existing rows were staged above to avoid unique-index collisions. Restore
      // their projected ordinal even when the semantic checklist item is a no-op;
      // this ordinal-only repair intentionally leaves audit timestamps untouched.
      const rows = await database.update(noteChecklistItems)
        .set({ ordinal: item.ordinal })
        .where(and(eq(noteChecklistItems.itemId, item.itemId), eq(noteChecklistItems.pageId, page.id), eq(noteChecklistItems.workspaceId, page.workspaceId)))
        .returning({ id: noteChecklistItems.id });
      if (!rows[0]) throw new Error("CHECKLIST_PROJECTION_UPDATE_FAILED");
      continue;
    }
    const values = {
        itemId: item.itemId,
        pageId: page.id,
        workspaceId: page.workspaceId,
        ordinal: item.ordinal,
        text: item.text,
        checked: item.checked,
        completedAt,
        completedByKind: item.checked ? completedByKind : null,
        completedByUserId,
        completedByAgentJobId,
        completedByChannel,
        completedByTool,
        updatedByUserId: actor?.userId ?? null,
        updatedByKind: kind,
        updatedByAgentJobId: actor?.agentJobId ?? null,
        updatedByChannel: actor?.channel ?? null,
        updatedByTool: actor?.tool ?? null,
        updatedAt: sql`now()`,
      };
    if (previous) {
      const rows = await database.update(noteChecklistItems).set(values).where(and(eq(noteChecklistItems.itemId, item.itemId), eq(noteChecklistItems.pageId, page.id), eq(noteChecklistItems.workspaceId, page.workspaceId))).returning({ id: noteChecklistItems.id });
      if (!rows[0]) throw new Error("CHECKLIST_PROJECTION_UPDATE_FAILED");
    } else {
      const rows = await database.insert(noteChecklistItems).values(values).returning({ id: noteChecklistItems.id });
      if (!rows[0]) throw new Error("CHECKLIST_PROJECTION_UPDATE_FAILED");
    }
  }
  await database.delete(notePageLinks).where(eq(notePageLinks.sourcePageId, page.id));
  if (projection.links.length) {
    await database.insert(notePageLinks).values(
      projection.links.map((link) => ({
        workspaceId: page.workspaceId,
        sourcePageId: page.id,
        targetPageId: link.targetPageId,
        ordinal: link.ordinal,
        anchorText: link.text,
      })),
    );
  }
  return projection;
};

const createNotePageInTransaction = async (input: CreateNotePageInput, projected: ReturnType<typeof project>, transaction: DatabaseLike): Promise<NotePageWithCapabilities> => {
    await ensureActor(transaction, input);
    const ownerUserId = input.ownerUserId ?? input.userId;
    if (ownerUserId !== input.userId) throw new Error("OWNER_MUST_MATCH_ACTOR");
    await ensureMember(transaction, input.workspaceId, ownerUserId);
    const linkTargetIds = projected.projection.links.map((link) => link.targetPageId);
    await lockNotePages(transaction, input.workspaceId, [input.parentId, ...linkTargetIds]);
    await verifyLockedLinkTargets(transaction, input.workspaceId, input.userId, linkTargetIds);
    if (input.parentId) {
      const [parent] = await transaction
        .select({ id: notePages.id })
        .from(notePages)
        .where(and(eq(notePages.id, input.parentId), eq(notePages.workspaceId, input.workspaceId), isNull(notePages.archivedAt), aclCondition(input.workspaceId, input.userId, "editor")))
        .limit(1);
      if (!parent) throw new Error("PARENT_NOT_FOUND");
    }
    const { value, projection } = projected;
    const kind = actorKind(input);
    const insertResult = await transaction.execute(sql`
      INSERT INTO "note_pages" (
        "workspace_id", "owner_user_id", "parent_id", "kind", "daily_date", "visibility",
        "title", "position", "lexical_json", "markdown_projection", "plaintext_projection",
        "provenance", "created_by_kind", "updated_by_kind", "created_by_user_id", "updated_by_user_id",
        "created_by_agent_job_id", "updated_by_agent_job_id", "created_by_channel", "updated_by_channel",
        "created_by_tool", "updated_by_tool"
      )
      SELECT
        ${input.workspaceId}, ${ownerUserId}, ${input.parentId ?? null}, ${input.kind ?? "page"}::note_page_kind,
        ${input.dailyDate ?? null}, ${input.visibility ?? "private"}::note_page_visibility, ${input.title ?? ""},
        ${input.position ?? 0}, ${JSON.stringify(value)}::jsonb, ${projection.markdown}, ${projection.plaintext},
        ${kind}::note_page_provenance, ${kind}::note_actor_kind, ${kind}::note_actor_kind, ${input.userId}, ${input.userId},
        ${input.agentJobId ?? null}, ${input.agentJobId ?? null}, ${input.channel ?? null}, ${input.channel ?? null},
        ${input.tool ?? null}, ${input.tool ?? null}
      WHERE ${input.parentId ? editorDestinationAcl(input.workspaceId, input.userId, input.parentId) : sql`TRUE`}
      RETURNING "id"
    `);
    const insertRows = Array.isArray(insertResult) ? insertResult : insertResult?.rows ?? [];
    const insertedId = (insertRows[0] as { id?: string } | undefined)?.id;
    if (!insertedId) throw new Error(input.parentId ? "PARENT_NOT_FOUND" : "NOTE_PAGE_CREATE_FAILED");
    const [page] = await transaction.select().from(notePages).where(and(eq(notePages.id, insertedId), eq(notePages.workspaceId, input.workspaceId))).limit(1);
    if (!page) throw new Error("NOTE_PAGE_CREATE_FAILED");
    await syncProjections(transaction, page, value, input);
    const snapshot = await projectNotePageSnapshot(transaction, input, page.id);
    if (!snapshot) throw new Error("NOTE_PAGE_CREATE_FAILED");
    return snapshot;
};

export const createNotePage = (input: CreateNotePageInput, database: DatabaseLike = db): Promise<NotePageWithCapabilities> => {
  try {
    // Read and bound the structured payload before touching any other request
    // getter. The projector owns the single accessor-safe snapshot; callers
    // cannot mutate content while the transaction waits for the global lock.
    const rawLexicalJson = input.lexicalJson;
    const projected = project(rawLexicalJson);
    const rawPosition = input.position;
    assertNotePosition(rawPosition);
    const snapshot: CreateNotePageInput = {
      workspaceId: input.workspaceId,
      userId: input.userId,
      actorKind: input.actorKind,
      agentJobId: input.agentJobId,
      channel: input.channel,
      tool: input.tool,
      ownerUserId: input.ownerUserId,
      parentId: input.parentId,
      kind: input.kind,
      dailyDate: input.dailyDate,
      visibility: input.visibility,
      title: input.title,
      position: rawPosition,
      lexicalJson: projected.value,
    };
    return inTransaction(database, (transaction) => createNotePageInTransaction(snapshot, projected, transaction));
  } catch (error) {
    return Promise.reject(error);
  }
};

export const getNotePage = (input: NoteActor, pageId: string, database: DatabaseLike = db): Promise<NotePageWithCapabilities | null> => {
  const actor = structuredClone(input) as NoteActor;
  actorKind(actor);
  return projectNotePageSnapshot(database, actor, pageId);
};

/**
 * Owner-only read used by the restore adapter. Archived pages are deliberately
 * excluded from the normal ACL read, so exposing them requires a narrower
 * query rather than weakening `getNotePage` for every caller.
 */
export const getOwnedNotePageIncludingArchived = (
  input: NoteActor,
  pageId: string,
  database: DatabaseLike = db,
): Promise<NotePageWithCapabilities | null> => {
  const actor = structuredClone(input) as NoteActor;
  actorKind(actor);
  return projectNotePageSnapshot(database, actor, pageId, "owner-including-archived");
};

/**
 * Archived pages are a private owner recovery surface. They never participate
 * in viewer/editor inheritance, and the SQL projection stays summary-only.
 */
export const listOwnedArchivedNotePages = async (
  input: NoteActor,
  database: DatabaseLike = db,
  paginationInput: NotePaginationInput = {},
): Promise<NoteCollection<NotePageSummary>> => {
  const actor = structuredClone(input) as NoteActor;
  actorKind(actor);
  const pagination = normalizePagination(paginationInput);
  if (!(await hasMembership(database, actor.workspaceId, actor.userId))) {
    return emptyCollection(pagination);
  }
  const rows = await database
    .select(notePageSummarySelection(actor))
    .from(notePages)
    .where(and(
      eq(notePages.workspaceId, actor.workspaceId),
      eq(notePages.ownerUserId, actor.userId),
      isNotNull(notePages.archivedAt),
      membership(actor.workspaceId, actor.userId),
    ))
    .orderBy(desc(notePages.archivedAt), desc(notePages.id))
    .limit(pagination.limit + 1)
    .offset(pagination.offset);
  return collectionFromRows(rows, pagination);
};

const updateNotePageInTransaction = async (input: UpdateNotePageInput, projectedInput: ReturnType<typeof project> | undefined, hasLexicalJson: boolean, transaction: DatabaseLike): Promise<NotePageWithCapabilities | null> => {
    const linkTargetIds = hasLexicalJson ? projectedInput?.projection.links.map((link) => link.targetPageId) ?? [] : [];
    await ensureActor(transaction, input);
    // Lock source and destination rows in sorted order after the global lock.
    await lockNotePages(transaction, input.workspaceId, [input.pageId, input.parentId, ...linkTargetIds]);
    await verifyLockedLinkTargets(transaction, input.workspaceId, input.userId, linkTargetIds);
    if (hasLexicalJson) {
      await lockChecklistRows(transaction, input.workspaceId, input.pageId);
      await lockPageLinks(transaction, input.workspaceId, input.pageId);
    }
    const current = input.archivedAt === null
      ? (await transaction.select().from(notePages).where(and(eq(notePages.id, input.pageId), eq(notePages.workspaceId, input.workspaceId), eq(notePages.ownerUserId, input.userId), membership(input.workspaceId, input.userId))).limit(1))[0] ?? null
      : await projectNotePageSnapshot(transaction, input, input.pageId);
    if (!current) return null;
    if (input.archivedAt !== undefined && current.kind === "daily") throw new Error("DAILY_PAGE_CANNOT_ARCHIVE");
    const ownerOnlyMutation = input.parentId !== undefined || input.visibility !== undefined || input.archivedAt !== undefined;
    if (ownerOnlyMutation && current.ownerUserId !== input.userId) return null;
    const hasRequestedChange = hasLexicalJson || input.title !== undefined || input.parentId !== undefined || input.position !== undefined || input.visibility !== undefined || input.archivedAt !== undefined;
    if (!hasRequestedChange) {
      // Explicit `lexicalJson: undefined` (and an otherwise empty update) is a
      // successful, editor-authorized no-op: preserve stateVersion, content,
      // projections, and audit timestamps.
      const [editable] = await transaction.select().from(notePages).where(and(
        eq(notePages.id, input.pageId),
        eq(notePages.workspaceId, input.workspaceId),
        eq(notePages.stateVersion, input.expectedStateVersion),
        isNull(notePages.archivedAt),
        aclCondition(input.workspaceId, input.userId, "editor"),
      )).limit(1);
      if (!editable) return null;
      const snapshot = await projectNotePageSnapshot(transaction, input, input.pageId);
      if (!snapshot) throw new Error("NOTE_PAGE_UPDATE_PROJECTION_FAILED");
      return snapshot;
    }
    if (input.parentId !== undefined && input.parentId !== null) {
      if (input.parentId === input.pageId) throw new Error("NOTE_PAGE_CYCLE");
      const [parent] = await transaction.select({ id: notePages.id }).from(notePages).where(and(eq(notePages.id, input.parentId), eq(notePages.workspaceId, input.workspaceId), aclCondition(input.workspaceId, input.userId, "editor"))).limit(1);
      if (!parent) throw new Error("PARENT_NOT_FOUND");
      const descendant = await transaction.execute(sql`WITH RECURSIVE descendants("id") AS (
        SELECT "id" FROM "note_pages" WHERE "id" = ${input.pageId}
        UNION SELECT child."id" FROM "note_pages" child JOIN descendants d ON child."parent_id" = d."id"
      ) SELECT 1 FROM descendants WHERE "id" = ${input.parentId} LIMIT 1`);
      const descendantRows = Array.isArray(descendant) ? descendant : descendant?.rows ?? [];
      if (descendantRows.length) throw new Error("NOTE_PAGE_CYCLE");
    }
    const lexicalJson = projectedInput?.value ?? current.lexicalJson as unknown as LexicalDocument;
    const projection = projectedInput?.projection ?? projectLexicalDocument(lexicalJson);
    const [updated] = await transaction
      .update(notePages)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
        ...(input.position !== undefined ? { position: input.position } : {}),
        ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
        ...(hasLexicalJson ? { lexicalJson: lexicalJson as Record<string, unknown>, markdownProjection: projection.markdown, plaintextProjection: projection.plaintext } : {}),
        ...(input.archivedAt !== undefined ? { archivedAt: input.archivedAt } : {}),
        updatedByUserId: input.userId,
        updatedByKind: actorKind(input),
        updatedByAgentJobId: input.agentJobId ?? null,
        updatedByChannel: input.channel ?? null,
        updatedByTool: input.tool ?? null,
        stateVersion: sql`${notePages.stateVersion} + 1`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(notePages.id, input.pageId), eq(notePages.workspaceId, input.workspaceId), eq(notePages.stateVersion, input.expectedStateVersion), aclCondition(input.workspaceId, input.userId, "editor"), input.parentId !== undefined && input.parentId !== null ? editorDestinationAcl(input.workspaceId, input.userId, input.parentId) : sql`TRUE`))
      .returning();
    if (!updated) return null;
    if (hasLexicalJson) await syncProjections(transaction, updated, lexicalJson, input);
    const snapshot = await projectNotePageSnapshot(
      transaction,
      input,
      updated.id,
      updated.archivedAt === null ? "active-visible" : "owner-including-archived",
    );
    if (!snapshot) throw new Error("NOTE_PAGE_UPDATE_PROJECTION_FAILED");
    return snapshot;
};

export const updateNotePage = (input: UpdateNotePageInput, database: DatabaseLike = db): Promise<NotePageWithCapabilities | null> => {
  try {
    // `undefined` is an explicit no-content-change value. Snapshot the presence
    // semantics synchronously so callers cannot mutate the request while waiting
    // for the global Notes lock.
    const rawLexicalJson = input.lexicalJson;
    const hasLexicalJson = rawLexicalJson !== undefined;
    const projectedInput = hasLexicalJson ? project(rawLexicalJson) : undefined;
    const lexicalSnapshot = projectedInput?.value;
    const rawPosition = input.position;
    assertNotePosition(rawPosition);
    const rawArchivedAt = input.archivedAt;
    const archivedAtSnapshot = rawArchivedAt instanceof Date ? new Date(rawArchivedAt.getTime()) : rawArchivedAt;
    const snapshot: UpdateNotePageInput = {
      workspaceId: input.workspaceId,
      userId: input.userId,
      actorKind: input.actorKind,
      agentJobId: input.agentJobId,
      channel: input.channel,
      tool: input.tool,
      pageId: input.pageId,
      expectedStateVersion: input.expectedStateVersion,
      title: input.title,
      parentId: input.parentId,
      position: rawPosition,
      visibility: input.visibility,
      lexicalJson: lexicalSnapshot,
      archivedAt: archivedAtSnapshot,
    };
    if (hasLexicalJson && projectedInput) snapshot.lexicalJson = projectedInput.value;
    return inTransaction(database, (transaction) => updateNotePageInTransaction(snapshot, projectedInput, hasLexicalJson, transaction));
  } catch (error) {
    return Promise.reject(error);
  }
};

export const getOrCreateDailyNotePage = (input: NoteActor, dailyDate: string, database: DatabaseLike = db): Promise<NotePageWithCapabilities> => {
  const actor = structuredClone(input) as NoteActor;
  return inTransaction(database, async (transaction) => {
    await ensureActor(transaction, actor);
    const existing = await transaction.select().from(notePages).where(and(eq(notePages.workspaceId, actor.workspaceId), eq(notePages.ownerUserId, actor.userId), eq(notePages.kind, "daily"), eq(notePages.dailyDate, dailyDate), isNull(notePages.archivedAt), aclCondition(actor.workspaceId, actor.userId))).limit(1).for("update");
    if (existing[0]) {
      const snapshot = await projectNotePageSnapshot(transaction, actor, existing[0].id);
      if (!snapshot) throw new Error("DAILY_NOTE_CREATE_FAILED");
      return snapshot;
    }
    // There is no tuple to lock on the first create; the global statement lock
    // serializes the empty lookup and insert.
    const lockedExisting = await transaction.select().from(notePages).where(and(eq(notePages.workspaceId, actor.workspaceId), eq(notePages.ownerUserId, actor.userId), eq(notePages.kind, "daily"), eq(notePages.dailyDate, dailyDate), isNull(notePages.archivedAt), aclCondition(actor.workspaceId, actor.userId))).limit(1).for("update");
    if (lockedExisting[0]) {
      const snapshot = await projectNotePageSnapshot(transaction, actor, lockedExisting[0].id);
      if (!snapshot) throw new Error("DAILY_NOTE_CREATE_FAILED");
      return snapshot;
    }
    await transaction.insert(notePages).values({ workspaceId: actor.workspaceId, ownerUserId: actor.userId, kind: "daily", dailyDate, title: dailyDate, visibility: "private", provenance: actorKind(actor), createdByKind: actorKind(actor), updatedByKind: actorKind(actor), createdByUserId: actor.userId, updatedByUserId: actor.userId, createdByAgentJobId: actor.actorKind === "agent" ? actor.agentJobId ?? null : null, updatedByAgentJobId: actor.actorKind === "agent" ? actor.agentJobId ?? null : null, createdByChannel: actor.channel ?? null, updatedByChannel: actor.channel ?? null, createdByTool: actor.tool ?? null, updatedByTool: actor.tool ?? null, lexicalJson: { root: { type: "root", version: 1, children: [] } } }).onConflictDoNothing();
    const created = await transaction.select().from(notePages).where(and(eq(notePages.workspaceId, actor.workspaceId), eq(notePages.ownerUserId, actor.userId), eq(notePages.kind, "daily"), eq(notePages.dailyDate, dailyDate), isNull(notePages.archivedAt), aclCondition(actor.workspaceId, actor.userId))).limit(1);
    if (!created[0]) throw new Error("DAILY_NOTE_CREATE_FAILED");
    const snapshot = await projectNotePageSnapshot(transaction, actor, created[0].id);
    if (!snapshot) throw new Error("DAILY_NOTE_CREATE_FAILED");
    return snapshot;
  });
};

export const listDailyNotePagesByMonth = async (
  input: NoteActor,
  month: string,
  database: DatabaseLike = db,
  paginationInput: NotePaginationInput = {},
): Promise<NoteCollection<NotePageSummary>> => {
  const actor = structuredClone(input) as NoteActor;
  actorKind(actor);
  const pagination = normalizePagination(paginationInput);
  const start = `${month}-01`;
  const [year, monthNumber] = month.split("-").map(Number);
  // Compose the exclusive boundary from the caller's calendar fields. Date.UTC
  // coerces years 0–99 into 1900–1999 and would silently widen those queries.
  const nextMonth = monthNumber === 12 ? 1 : monthNumber! + 1;
  const nextYear = monthNumber === 12 ? year! + 1 : year!;
  const end = `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-01`;
  if (!(await hasMembership(database, actor.workspaceId, actor.userId))) {
    return emptyCollection(pagination);
  }
  const rows = await database
    .select(notePageSummarySelection(actor))
    .from(notePages)
    .where(and(
      eq(notePages.workspaceId, actor.workspaceId),
      eq(notePages.ownerUserId, actor.userId),
      eq(notePages.kind, "daily"),
      gte(notePages.dailyDate, start),
      lt(notePages.dailyDate, end),
      isNull(notePages.archivedAt),
      aclCondition(actor.workspaceId, actor.userId),
    ))
    .orderBy(asc(notePages.dailyDate), asc(notePages.id))
    .limit(pagination.limit + 1)
    .offset(pagination.offset);
  return collectionFromRows(rows, pagination);
};

export const getNotePageTree = async (
  input: NoteActor,
  database: DatabaseLike = db,
  paginationInput: NotePaginationInput = {},
): Promise<NoteCollection<NotePageSummary>> => {
  const actor = structuredClone(input) as NoteActor;
  actorKind(actor);
  const pagination = normalizePagination(paginationInput);
  if (!(await hasMembership(database, actor.workspaceId, actor.userId))) {
    return emptyCollection(pagination);
  }
  const rows = await database
    .select(notePageSummarySelection(actor))
    .from(notePages)
    .where(and(
      eq(notePages.workspaceId, actor.workspaceId),
      isNull(notePages.archivedAt),
      aclCondition(actor.workspaceId, actor.userId),
    ))
    .orderBy(asc(notePages.position), asc(notePages.title), asc(notePages.id))
    .limit(pagination.limit + 1)
    .offset(pagination.offset);
  return collectionFromRows(rows, pagination);
};

export const searchNotePages = async (
  input: NoteActor,
  query: string,
  database: DatabaseLike = db,
  paginationInput: NotePaginationInput = {},
): Promise<NoteCollection<NotePageSummary>> => {
  const actor = structuredClone(input) as NoteActor;
  actorKind(actor);
  const pagination = normalizePagination(paginationInput);
  const value = query.trim();
  if (!value || !(await hasMembership(database, actor.workspaceId, actor.userId))) {
    return emptyCollection(pagination);
  }
  const rows = await database
    .select(notePageSummarySelection(actor))
    .from(notePages)
    .where(and(
      eq(notePages.workspaceId, actor.workspaceId),
      isNull(notePages.archivedAt),
      aclCondition(actor.workspaceId, actor.userId),
      or(
        sql`${notePages.searchVector} @@ plainto_tsquery('simple', ${value})`,
        ilike(notePages.title, `%${value}%`),
        ilike(notePages.plaintextProjection, `%${value}%`),
      ),
    ))
    .orderBy(desc(notePages.updatedAt), desc(notePages.id))
    .limit(pagination.limit + 1)
    .offset(pagination.offset);
  return collectionFromRows(rows, pagination);
};

type NotePageShareInput = NoteActor & { pageId: string; sharedWithUserId: string; role: "viewer" | "editor" };
type RemoveNotePageShareInput = NoteActor & { pageId: string; sharedWithUserId: string };

const setNotePageShareInTransaction = async (actor: NotePageShareInput, transaction: DatabaseLike) => {
  await ensureActor(transaction, actor);
  const [page] = await transaction.select({ id: notePages.id, ownerUserId: notePages.ownerUserId }).from(notePages).where(and(eq(notePages.id, actor.pageId), eq(notePages.workspaceId, actor.workspaceId), isNull(notePages.archivedAt), membership(actor.workspaceId, actor.userId))).limit(1).for("update");
  await transaction.select({ id: notePageShares.id }).from(notePageShares).where(and(eq(notePageShares.pageId, actor.pageId), eq(notePageShares.workspaceId, actor.workspaceId), eq(notePageShares.sharedWithUserId, actor.sharedWithUserId))).limit(1).for("update");
  if (!page || page.ownerUserId !== actor.userId) throw new Error("ACL_OWNER_REQUIRED");
  await ensureMember(transaction, actor.workspaceId, actor.sharedWithUserId);
  const [share] = await transaction.insert(notePageShares).values({ pageId: actor.pageId, workspaceId: actor.workspaceId, actorUserId: actor.userId, sharedWithUserId: actor.sharedWithUserId, role: actor.role, actorKind: actorKind(actor), actorAgentJobId: actor.agentJobId ?? null, actorChannel: actor.channel ?? null, actorTool: actor.tool ?? null }).onConflictDoUpdate({ target: [notePageShares.pageId, notePageShares.sharedWithUserId], set: { role: actor.role, actorUserId: actor.userId, actorKind: actorKind(actor), actorAgentJobId: actor.agentJobId ?? null, actorChannel: actor.channel ?? null, actorTool: actor.tool ?? null, updatedAt: sql`now()` } }).returning();
  return share;
};

export const setNotePageShare = (actor: NotePageShareInput, database: DatabaseLike = db) => {
  const snapshot = structuredClone(actor) as NotePageShareInput;
  return inTransaction(database, (transaction) => setNotePageShareInTransaction(snapshot, transaction));
};

export const listNotePageShares = async (
  input: NoteActor,
  pageId: string,
  database: DatabaseLike = db,
  paginationInput: NotePaginationInput = {},
): Promise<NoteCollection<NotePageShareSummary> | null> => {
  const actor = structuredClone(input) as NoteActor;
  actorKind(actor);
  const pagination = normalizePagination(paginationInput);
  if (!(await hasMembership(database, actor.workspaceId, actor.userId))) return null;
  const [ownedPage] = await database
    .select({ id: notePages.id })
    .from(notePages)
    .where(and(
      eq(notePages.id, pageId),
      eq(notePages.workspaceId, actor.workspaceId),
      eq(notePages.ownerUserId, actor.userId),
      isNull(notePages.archivedAt),
      membership(actor.workspaceId, actor.userId),
    ))
    .limit(1);
  if (!ownedPage) return null;
  const rows = await database
    .select({
      id: notePageShares.id,
      pageId: notePageShares.pageId,
      sharedWithUserId: notePageShares.sharedWithUserId,
      role: notePageShares.role,
      createdAt: notePageShares.createdAt,
      updatedAt: notePageShares.updatedAt,
    })
    .from(notePageShares)
    .where(and(
      eq(notePageShares.pageId, pageId),
      eq(notePageShares.workspaceId, actor.workspaceId),
    ))
    .orderBy(asc(notePageShares.createdAt), asc(notePageShares.id))
    .limit(pagination.limit + 1)
    .offset(pagination.offset);
  return collectionFromRows(rows, pagination);
};

const removeNotePageShareInTransaction = async (actor: RemoveNotePageShareInput, transaction: DatabaseLike): Promise<boolean> => {
  await ensureActor(transaction, actor);
  const [page] = await transaction.select({ ownerUserId: notePages.ownerUserId }).from(notePages).where(and(eq(notePages.id, actor.pageId), eq(notePages.workspaceId, actor.workspaceId), isNull(notePages.archivedAt), membership(actor.workspaceId, actor.userId))).limit(1).for("update");
  await transaction.select({ id: notePageShares.id }).from(notePageShares).where(and(eq(notePageShares.pageId, actor.pageId), eq(notePageShares.workspaceId, actor.workspaceId), eq(notePageShares.sharedWithUserId, actor.sharedWithUserId))).limit(1).for("update");
  if (!page || page.ownerUserId !== actor.userId) throw new Error("ACL_OWNER_REQUIRED");
  const rows = await transaction.delete(notePageShares).where(and(eq(notePageShares.pageId, actor.pageId), eq(notePageShares.workspaceId, actor.workspaceId), eq(notePageShares.sharedWithUserId, actor.sharedWithUserId), membership(actor.workspaceId, actor.userId))).returning({ id: notePageShares.id });
  return rows.length > 0;
};

export const removeNotePageShare = (actor: RemoveNotePageShareInput, database: DatabaseLike = db): Promise<boolean> => {
  const snapshot = structuredClone(actor) as RemoveNotePageShareInput;
  return inTransaction(database, (transaction) => removeNotePageShareInTransaction(snapshot, transaction));
};

export const reparentNotePage = (input: NoteActor & { pageId: string; parentId: string | null; expectedStateVersion: number }, database: DatabaseLike = db) => {
  const snapshot = structuredClone(input) as NoteActor & { pageId: string; parentId: string | null; expectedStateVersion: number };
  return updateNotePage({ ...snapshot, parentId: snapshot.parentId }, database);
};

export const listPendingNoteCarryover = async (
  input: NoteActor,
  database: DatabaseLike = db,
  paginationInput: NotePaginationInput = {},
): Promise<NoteCollection<NoteCarryoverSummary>> => {
  const actor = structuredClone(input) as NoteActor;
  actorKind(actor);
  const pagination = normalizePagination(paginationInput);
  if (!(await hasMembership(database, actor.workspaceId, actor.userId))) {
    return emptyCollection(pagination);
  }
  const rows = await database.select({
    sourcePageId: notePages.id,
    sourceStateVersion: notePages.stateVersion,
    sourceDate: notePages.dailyDate,
    itemId: noteChecklistItems.itemId,
    ordinal: noteChecklistItems.ordinal,
    text: sql<string>`left(${noteChecklistItems.text}, ${MAX_NOTE_SUMMARY_TEXT_CODE_POINTS})`,
    checked: noteChecklistItems.checked,
  }).from(noteChecklistItems)
    .innerJoin(notePages, eq(notePages.id, noteChecklistItems.pageId))
    .where(and(eq(notePages.workspaceId, actor.workspaceId), eq(notePages.ownerUserId, actor.userId), eq(notePages.kind, "daily"), lt(notePages.dailyDate, sql`CURRENT_DATE`), isNull(notePages.archivedAt), eq(noteChecklistItems.checked, false), aclCondition(actor.workspaceId, actor.userId, "viewer")))
    .orderBy(asc(notePages.dailyDate), asc(notePages.id), asc(noteChecklistItems.ordinal), asc(noteChecklistItems.itemId))
    .limit(pagination.limit + 1)
    .offset(pagination.offset);
  return collectionFromRows(rows, pagination);
};

export const listDailyNoteCarryover = async (
  input: NoteActor & { dailyDate: string },
  database: DatabaseLike = db,
  paginationInput: NotePaginationInput = {},
): Promise<NoteCollection<NoteCarryoverSummary>> => {
  const actor = structuredClone(input) as NoteActor & { dailyDate: string };
  actorKind(actor);
  const pagination = normalizePagination(paginationInput);
  if (!(await hasMembership(database, actor.workspaceId, actor.userId))) {
    return emptyCollection(pagination);
  }
  const rows = await database.select({
    sourcePageId: notePages.id,
    sourceStateVersion: notePages.stateVersion,
    sourceDate: notePages.dailyDate,
    itemId: noteChecklistItems.itemId,
    ordinal: noteChecklistItems.ordinal,
    text: sql<string>`left(${noteChecklistItems.text}, ${MAX_NOTE_SUMMARY_TEXT_CODE_POINTS})`,
    checked: noteChecklistItems.checked,
  }).from(noteChecklistItems)
    .innerJoin(notePages, eq(notePages.id, noteChecklistItems.pageId))
    .where(and(eq(notePages.workspaceId, actor.workspaceId), eq(notePages.ownerUserId, actor.userId), eq(notePages.kind, "daily"), lt(notePages.dailyDate, actor.dailyDate), isNull(notePages.archivedAt), eq(noteChecklistItems.checked, false), aclCondition(actor.workspaceId, actor.userId, "viewer")))
    .orderBy(asc(notePages.dailyDate), asc(notePages.id), asc(noteChecklistItems.ordinal), asc(noteChecklistItems.itemId))
    .limit(pagination.limit + 1)
    .offset(pagination.offset);
  return collectionFromRows(rows, pagination);
};

const updateNoteChecklistItemInTransaction = async (actor: UpdateNoteChecklistItemInput, transaction: DatabaseLike) => {
    await ensureActor(transaction, actor);
    await lockChecklistRows(transaction, actor.workspaceId, actor.pageId, [actor.itemId]);
    const [locked] = await transaction.select({
      pageLexicalJson: notePages.lexicalJson,
      pageStateVersion: notePages.stateVersion,
      itemDbId: noteChecklistItems.id,
      itemId: noteChecklistItems.itemId,
      itemPageId: noteChecklistItems.pageId,
      itemWorkspaceId: noteChecklistItems.workspaceId,
      itemOrdinal: noteChecklistItems.ordinal,
      itemText: noteChecklistItems.text,
      itemChecked: noteChecklistItems.checked,
      itemCompletedAt: noteChecklistItems.completedAt,
      itemCompletedByKind: noteChecklistItems.completedByKind,
      itemCompletedByUserId: noteChecklistItems.completedByUserId,
      itemCompletedByAgentJobId: noteChecklistItems.completedByAgentJobId,
      itemCompletedByChannel: noteChecklistItems.completedByChannel,
      itemCompletedByTool: noteChecklistItems.completedByTool,
      itemUpdatedByUserId: noteChecklistItems.updatedByUserId,
      itemUpdatedByKind: noteChecklistItems.updatedByKind,
      itemUpdatedByAgentJobId: noteChecklistItems.updatedByAgentJobId,
      itemUpdatedByChannel: noteChecklistItems.updatedByChannel,
      itemUpdatedByTool: noteChecklistItems.updatedByTool,
      itemUpdatedAt: noteChecklistItems.updatedAt,
    }).from(notePages).innerJoin(noteChecklistItems, and(eq(noteChecklistItems.pageId, notePages.id), eq(noteChecklistItems.workspaceId, notePages.workspaceId))).where(and(eq(notePages.id, actor.pageId), eq(notePages.workspaceId, actor.workspaceId), isNull(notePages.archivedAt), eq(notePages.stateVersion, actor.expectedStateVersion), eq(noteChecklistItems.itemId, actor.itemId), aclCondition(actor.workspaceId, actor.userId, "editor"), membership(actor.workspaceId, actor.userId))).limit(1).for("update");
    if (!locked) return null;
    const existingItem = {
      id: locked.itemDbId,
      itemId: locked.itemId,
      pageId: locked.itemPageId,
      workspaceId: locked.itemWorkspaceId,
      ordinal: locked.itemOrdinal,
      text: locked.itemText,
      checked: locked.itemChecked,
      completedAt: locked.itemCompletedAt,
      completedByKind: locked.itemCompletedByKind,
      completedByUserId: locked.itemCompletedByUserId,
      completedByAgentJobId: locked.itemCompletedByAgentJobId,
      completedByChannel: locked.itemCompletedByChannel,
      completedByTool: locked.itemCompletedByTool,
      updatedByUserId: locked.itemUpdatedByUserId,
      updatedByKind: locked.itemUpdatedByKind,
      updatedByAgentJobId: locked.itemUpdatedByAgentJobId,
      updatedByChannel: locked.itemUpdatedByChannel,
      updatedByTool: locked.itemUpdatedByTool,
      updatedAt: locked.itemUpdatedAt,
    };
    if (locked.itemChecked === actor.checked) {
      const page = await projectNotePageSnapshot(transaction, actor, actor.pageId);
      if (!page) return null;
      return { ...existingItem, item: existingItem, page } as NoteChecklistMutationResult;
    }
    const lexicalJson = setChecklistItemChecked(locked.pageLexicalJson as unknown as LexicalDocument, actor.itemId, actor.checked);
    const projected = projectLexicalDocumentFromSnapshot(lexicalJson);
    const [updatedPage] = await transaction.update(notePages).set({ lexicalJson: lexicalJson as Record<string, unknown>, markdownProjection: projected.markdown, plaintextProjection: projected.plaintext, updatedByUserId: actor.userId, updatedByKind: actorKind(actor), updatedByAgentJobId: actor.actorKind === "agent" ? actor.agentJobId ?? null : null, updatedByChannel: actor.channel ?? null, updatedByTool: actor.tool ?? null, stateVersion: sql`${notePages.stateVersion} + 1`, updatedAt: sql`now()` }).where(and(eq(notePages.id, actor.pageId), eq(notePages.workspaceId, actor.workspaceId), eq(notePages.stateVersion, actor.expectedStateVersion), aclCondition(actor.workspaceId, actor.userId, "editor"), membership(actor.workspaceId, actor.userId))).returning();
    if (!updatedPage) return null;
    const [item] = await transaction.update(noteChecklistItems).set({ checked: actor.checked, completedAt: actor.checked ? new Date() : null, completedByKind: actor.checked ? actorKind(actor) : null, completedByUserId: actor.checked ? actor.userId : null, completedByAgentJobId: actor.checked && actorKind(actor) === "agent" ? actor.agentJobId ?? null : null, completedByChannel: actor.checked ? actor.channel ?? null : null, completedByTool: actor.checked ? actor.tool ?? null : null, updatedByUserId: actor.userId, updatedByKind: actorKind(actor), updatedByAgentJobId: actor.actorKind === "agent" ? actor.agentJobId ?? null : null, updatedByChannel: actor.channel ?? null, updatedByTool: actor.tool ?? null, updatedAt: sql`now()` }).where(and(eq(noteChecklistItems.pageId, actor.pageId), eq(noteChecklistItems.workspaceId, actor.workspaceId), eq(noteChecklistItems.itemId, actor.itemId), membership(actor.workspaceId, actor.userId))).returning();
    if (!item) throw new Error("CHECKLIST_PROJECTION_UPDATE_FAILED");
    const page = await projectNotePageSnapshot(transaction, actor, updatedPage.id);
    if (!page) throw new Error("CHECKLIST_PROJECTION_UPDATE_FAILED");
    return { ...item, item, page } as NoteChecklistMutationResult;
};

export const updateNoteChecklistItem = (actor: UpdateNoteChecklistItemInput, database: DatabaseLike = db) => {
  const snapshot = structuredClone(actor) as UpdateNoteChecklistItemInput;
  return inTransaction(database, (transaction) => updateNoteChecklistItemInTransaction(snapshot, transaction));
};

export const updateDailyCarryoverItem = (actor: UpdateCarryoverItemInput, database: DatabaseLike = db) => {
  const snapshot = structuredClone(actor) as UpdateCarryoverItemInput;
  const checklistInput: UpdateNoteChecklistItemInput = { ...snapshot, pageId: snapshot.sourcePageId };
  return updateNoteChecklistItem(checklistInput, database);
};

export const listDailyCarryover = listDailyNoteCarryover;
export const updateCarryoverItem = updateDailyCarryoverItem;

export const listNoteChecklistItems = async (
  input: NoteActor,
  pageId: string,
  database: DatabaseLike = db,
  paginationInput: NotePaginationInput = {},
): Promise<NoteCollection<NoteChecklistItemSummary>> => {
  const actor = structuredClone(input) as NoteActor;
  actorKind(actor);
  const pagination = normalizePagination(paginationInput);
  if (!(await hasMembership(database, actor.workspaceId, actor.userId))) {
    return emptyCollection(pagination);
  }
  const rows = await database.select({
    itemId: noteChecklistItems.itemId,
    ordinal: noteChecklistItems.ordinal,
    text: sql<string>`left(${noteChecklistItems.text}, ${MAX_NOTE_SUMMARY_TEXT_CODE_POINTS})`,
    checked: noteChecklistItems.checked,
    completedAt: noteChecklistItems.completedAt,
    completedByUserId: noteChecklistItems.completedByUserId,
    updatedAt: noteChecklistItems.updatedAt,
  }).from(noteChecklistItems)
    .innerJoin(notePages, and(
      eq(notePages.id, noteChecklistItems.pageId),
      eq(notePages.workspaceId, noteChecklistItems.workspaceId),
    ))
    .where(and(
      eq(notePages.id, pageId),
      eq(notePages.workspaceId, actor.workspaceId),
      isNull(notePages.archivedAt),
      aclCondition(actor.workspaceId, actor.userId, "viewer"),
    ))
    .orderBy(asc(noteChecklistItems.ordinal), asc(noteChecklistItems.itemId))
    .limit(pagination.limit + 1)
    .offset(pagination.offset);
  return collectionFromRows(rows, pagination);
};

export const listNotePageLinks = async (
  input: NoteActor & { pageId: string },
  database: DatabaseLike = db,
  paginationInput: NotePaginationInput = {},
): Promise<NoteCollection<NoteLinkSummary>> => {
  const actor = structuredClone(input) as NoteActor & { pageId: string };
  actorKind(actor);
  const pagination = normalizePagination(paginationInput);
  const sourcePage = alias(notePages, "note_link_source");
  const target = alias(notePages, "note_link_target");
  if (!(await hasMembership(database, actor.workspaceId, actor.userId))) {
    return emptyCollection(pagination);
  }
  const rows = await database.select({
    id: notePageLinks.id,
    sourcePageId: notePageLinks.sourcePageId,
    sourceTitle: sql<string>`left(${sourcePage.title}, ${MAX_NOTE_LINK_SUMMARY_TEXT_CODE_POINTS})`,
    targetPageId: notePageLinks.targetPageId,
    ordinal: notePageLinks.ordinal,
    anchorText: sql<string>`left(${notePageLinks.anchorText}, ${MAX_NOTE_LINK_SUMMARY_TEXT_CODE_POINTS})`,
    createdAt: notePageLinks.createdAt,
  }).from(notePageLinks).innerJoin(sourcePage, eq(sourcePage.id, notePageLinks.sourcePageId)).innerJoin(target, eq(target.id, notePageLinks.targetPageId)).where(and(eq(notePageLinks.workspaceId, actor.workspaceId), eq(notePageLinks.sourcePageId, actor.pageId), isNull(sourcePage.archivedAt), isNull(target.archivedAt), aclCondition(actor.workspaceId, actor.userId, "viewer", sourcePage), aclCondition(actor.workspaceId, actor.userId, "viewer", target), membership(actor.workspaceId, actor.userId))).orderBy(asc(notePageLinks.ordinal), asc(notePageLinks.id)).limit(pagination.limit + 1).offset(pagination.offset);
  return collectionFromRows(rows, pagination);
};

export const listNotePageBacklinks = async (
  input: NoteActor & { pageId: string },
  database: DatabaseLike = db,
  paginationInput: NotePaginationInput = {},
): Promise<NoteCollection<NoteLinkSummary>> => {
  const actor = structuredClone(input) as NoteActor & { pageId: string };
  actorKind(actor);
  const pagination = normalizePagination(paginationInput);
  const target = alias(notePages, "note_backlink_target");
  const source = alias(notePages, "note_backlink_source");
  if (!(await hasMembership(database, actor.workspaceId, actor.userId))) {
    return emptyCollection(pagination);
  }
  const rows = await database.select({
    id: notePageLinks.id,
    sourcePageId: notePageLinks.sourcePageId,
    sourceTitle: sql<string>`left(${source.title}, ${MAX_NOTE_LINK_SUMMARY_TEXT_CODE_POINTS})`,
    targetPageId: notePageLinks.targetPageId,
    ordinal: notePageLinks.ordinal,
    anchorText: sql<string>`left(${notePageLinks.anchorText}, ${MAX_NOTE_LINK_SUMMARY_TEXT_CODE_POINTS})`,
    createdAt: notePageLinks.createdAt,
  }).from(notePageLinks).innerJoin(source, eq(source.id, notePageLinks.sourcePageId)).innerJoin(target, eq(target.id, notePageLinks.targetPageId)).where(and(eq(notePageLinks.workspaceId, actor.workspaceId), eq(notePageLinks.targetPageId, actor.pageId), isNull(source.archivedAt), isNull(target.archivedAt), aclCondition(actor.workspaceId, actor.userId, "viewer", source), aclCondition(actor.workspaceId, actor.userId, "viewer", target), membership(actor.workspaceId, actor.userId))).orderBy(asc(notePageLinks.createdAt), asc(notePageLinks.id)).limit(pagination.limit + 1).offset(pagination.offset);
  return collectionFromRows(rows, pagination);
};

export const listLegacyArchiveItems = (
  input: NoteActor,
  database: DatabaseLike = db,
  options: NotePaginationInput & { disposition?: NoteLegacyDispositionFilter } = {},
): Promise<NoteCollection<NoteLegacyArchiveSummary>> => {
  const actor = structuredClone(input) as NoteActor;
  actorKind(actor);
  const pagination = normalizePagination(options);
  const disposition = options.disposition ?? "all";
  if (!["pending", "converted", "discarded", "terminal", "all"].includes(disposition)) {
    return Promise.reject(new Error("INVALID_LEGACY_DISPOSITION"));
  }
  return hasMembership(database, actor.workspaceId, actor.userId).then(async (active) => {
    if (!active) return emptyCollection(pagination);
    const convertedTarget = alias(notePages, "note_legacy_converted_target");
    const dispositionCondition = disposition === "all"
      ? undefined
      : disposition === "terminal"
        ? inArray(noteLegacyArchiveItems.disposition, ["converted", "discarded"])
        : eq(noteLegacyArchiveItems.disposition, disposition);
    const rows = await database.select(
      legacyArchiveSummarySelection(actor, convertedTarget),
    ).from(noteLegacyArchiveItems)
      .leftJoin(convertedTarget, and(
        eq(convertedTarget.id, noteLegacyArchiveItems.convertedPageId),
        eq(convertedTarget.workspaceId, noteLegacyArchiveItems.workspaceId),
        isNull(convertedTarget.archivedAt),
      ))
      .where(and(
        eq(noteLegacyArchiveItems.workspaceId, actor.workspaceId),
        membership(actor.workspaceId, actor.userId),
        dispositionCondition,
      ))
      .orderBy(asc(noteLegacyArchiveItems.createdAt), asc(noteLegacyArchiveItems.id))
      .limit(pagination.limit + 1)
      .offset(pagination.offset);
    return collectionFromRows(rows, pagination);
  });
};

export const getLegacyArchiveItem = async (
  input: NoteActor,
  archiveId: string,
  database: DatabaseLike = db,
): Promise<NoteLegacyArchiveSummary | null> => {
  const actor = structuredClone(input) as NoteActor;
  actorKind(actor);
  if (!(await hasMembership(database, actor.workspaceId, actor.userId))) return null;
  const convertedTarget = alias(notePages, "note_legacy_converted_target_single");
  const [row] = await database.select(
    legacyArchiveSummarySelection(actor, convertedTarget),
  ).from(noteLegacyArchiveItems)
    .leftJoin(convertedTarget, and(
      eq(convertedTarget.id, noteLegacyArchiveItems.convertedPageId),
      eq(convertedTarget.workspaceId, noteLegacyArchiveItems.workspaceId),
      isNull(convertedTarget.archivedAt),
    ))
    .where(and(
      eq(noteLegacyArchiveItems.id, archiveId),
      eq(noteLegacyArchiveItems.workspaceId, actor.workspaceId),
      membership(actor.workspaceId, actor.userId),
    ))
    .limit(1);
  return row ?? null;
};

const legacyArchiveSummarySelection = (
  actor: NoteActor,
  convertedTarget: any,
) => ({
    id: noteLegacyArchiveItems.id,
    sourceType: noteLegacyArchiveItems.sourceType,
    sourceId: noteLegacyArchiveItems.sourceId,
    sourceTitle: sql<string>`left(coalesce(${noteLegacyArchiveItems.snapshot}->>'title', ''), 500)`,
    sourcePreview: sql<string>`left(coalesce(${noteLegacyArchiveItems.snapshot}->>'description', ${noteLegacyArchiveItems.snapshot}->>'title', ''), 500)`,
    disposition: noteLegacyArchiveItems.disposition,
    convertedPageId: sql<string | null>`CASE
      WHEN ${convertedTarget.id} IS NOT NULL
        AND ${aclCondition(actor.workspaceId, actor.userId, "viewer", convertedTarget)}
      THEN ${noteLegacyArchiveItems.convertedPageId}
      ELSE NULL
    END`,
    convertedActionId: noteLegacyArchiveItems.convertedActionId,
    dispositionAt: noteLegacyArchiveItems.dispositionAt,
    createdAt: noteLegacyArchiveItems.createdAt,
    updatedAt: noteLegacyArchiveItems.updatedAt,
});

const projectLegacyArchiveSummary = async (
  database: DatabaseLike,
  actor: NoteActor,
  archiveId: string,
): Promise<NoteLegacyArchiveSummary | null> => {
  const convertedTarget = alias(notePages, "note_legacy_converted_target_command");
  const [row] = await database.select(
    legacyArchiveSummarySelection(actor, convertedTarget),
  ).from(noteLegacyArchiveItems)
    .leftJoin(convertedTarget, and(
      eq(convertedTarget.id, noteLegacyArchiveItems.convertedPageId),
      eq(convertedTarget.workspaceId, noteLegacyArchiveItems.workspaceId),
      isNull(convertedTarget.archivedAt),
    ))
    .where(and(
      eq(noteLegacyArchiveItems.id, archiveId),
      eq(noteLegacyArchiveItems.workspaceId, actor.workspaceId),
      membership(actor.workspaceId, actor.userId),
    ))
    .limit(1);
  return row ?? null;
};

const legacySnapshotLexicalDocument = (
  snapshotText: string,
  snapshotTitle: string,
  fallbackTitle: string,
): { title: string; lexicalJson: LexicalDocument } => {
  const rawTitle = snapshotTitle.length > 0 ? snapshotTitle : fallbackTitle;
  const title = Array.from(rawTitle).slice(0, 500).join("");
  const serializedSnapshot = serializeLegacySnapshotForConversion(snapshotText);
  return {
    title,
    lexicalJson: {
      root: {
        type: "root",
        version: 1,
        children: [
          {
            type: "heading",
            version: 1,
            tag: "h1",
            children: [{ type: "text", version: 1, text: title }],
          },
          {
            type: "code",
            version: 1,
            language: "json",
            children: [{ type: "text", version: 1, text: serializedSnapshot }],
          },
        ],
      },
    },
  };
};

export const convertLegacyArchiveItem = (input: NoteActor & { archiveId: string; pageId?: string; actionId: string }, database: DatabaseLike = db) => {
  const actor = structuredClone(input) as NoteActor & { archiveId: string; pageId?: string; actionId: string };
  if (!actor.actionId) throw new Error("ACTION_ID_REQUIRED");
  return inTransaction(database, async (transaction) => {
    await ensureActor(transaction, actor);
    const [archive] = await transaction.select({
      id: noteLegacyArchiveItems.id,
      sourceType: noteLegacyArchiveItems.sourceType,
      sourceId: noteLegacyArchiveItems.sourceId,
      disposition: noteLegacyArchiveItems.disposition,
      convertedPageId: noteLegacyArchiveItems.convertedPageId,
      convertedActionId: noteLegacyArchiveItems.convertedActionId,
      dispositionByKind: noteLegacyArchiveItems.dispositionByKind,
      dispositionByUserId: noteLegacyArchiveItems.dispositionByUserId,
      dispositionByAgentJobId: noteLegacyArchiveItems.dispositionByAgentJobId,
      snapshotBytes: sql<number>`octet_length(${noteLegacyArchiveItems.snapshot}::text)`,
    }).from(noteLegacyArchiveItems).where(and(eq(noteLegacyArchiveItems.id, actor.archiveId), eq(noteLegacyArchiveItems.workspaceId, actor.workspaceId), membership(actor.workspaceId, actor.userId))).limit(1).for("update");
    if (!archive) throw new Error("LEGACY_REPLAY_MISMATCH");
    const [actionCollision] = await transaction.select({ id: noteLegacyArchiveItems.id }).from(noteLegacyArchiveItems).where(and(eq(noteLegacyArchiveItems.workspaceId, actor.workspaceId), eq(noteLegacyArchiveItems.convertedActionId, actor.actionId), ne(noteLegacyArchiveItems.id, actor.archiveId))).limit(1);
    if (actionCollision) throw new Error("LEGACY_REPLAY_MISMATCH");
    const kind = actorKind(actor);
    if (archive.disposition !== "pending") {
      const sameReplay = archive.disposition === "converted"
        && archive.convertedActionId === actor.actionId
        && archive.dispositionByKind === kind
        && archive.dispositionByUserId === actor.userId
        && (kind === "user" ? archive.dispositionByAgentJobId === null : archive.dispositionByAgentJobId === actor.agentJobId)
        && (actor.pageId === undefined || archive.convertedPageId === actor.pageId);
      if (!sameReplay) throw new Error("LEGACY_REPLAY_MISMATCH");
      if (!archive.convertedPageId) throw new Error("LEGACY_REPLAY_MISMATCH");
      const replayPage = await getNotePage(actor, archive.convertedPageId, transaction);
      if (!replayPage || !replayPage.canEdit) throw new Error("LEGACY_REPLAY_MISMATCH");
      const summary = await projectLegacyArchiveSummary(transaction, actor, archive.id);
      if (!summary) throw new Error("LEGACY_REPLAY_MISMATCH");
      return summary;
    }

    let pageId = actor.pageId;
    if (pageId !== undefined) {
      const [page] = await transaction.select({ id: notePages.id }).from(notePages).where(and(eq(notePages.id, pageId), eq(notePages.workspaceId, actor.workspaceId), isNull(notePages.archivedAt), aclCondition(actor.workspaceId, actor.userId, "editor"))).limit(1).for("update");
      if (!page) throw new Error("PAGE_NOT_FOUND");
    } else {
      if (archive.snapshotBytes > MAX_LEGACY_CONVERSION_SNAPSHOT_BYTES) {
        throw new Error("LEGACY_SNAPSHOT_TOO_LARGE");
      }
      const [snapshotRow] = await transaction.select({
        snapshotText: sql<string>`${noteLegacyArchiveItems.snapshot}::text`,
        snapshotTitle: sql<string>`CASE
          WHEN jsonb_typeof(${noteLegacyArchiveItems.snapshot}->'title') = 'string'
          THEN left(${noteLegacyArchiveItems.snapshot}->>'title', 500)
          ELSE ''
        END`,
      }).from(noteLegacyArchiveItems).where(and(
        eq(noteLegacyArchiveItems.id, archive.id),
        eq(noteLegacyArchiveItems.workspaceId, actor.workspaceId),
      )).limit(1);
      if (!snapshotRow) throw new Error("LEGACY_REPLAY_MISMATCH");
      const convertedContent = legacySnapshotLexicalDocument(
        snapshotRow.snapshotText,
        snapshotRow.snapshotTitle,
        `${archive.sourceType}: ${archive.sourceId}`,
      );
      const projected = project(convertedContent.lexicalJson);
      const page = await createNotePageInTransaction({
        ...actor,
        kind: "page",
        parentId: null,
        visibility: "private",
        title: convertedContent.title,
        lexicalJson: projected.value,
      }, projected, transaction);
      pageId = page.id;
    }

    const [row] = await transaction.update(noteLegacyArchiveItems).set({ disposition: "converted", convertedPageId: pageId, convertedActionId: actor.actionId, dispositionByKind: kind, dispositionByUserId: actor.userId, dispositionByAgentJobId: kind === "agent" ? actor.agentJobId ?? null : null, dispositionByChannel: actor.channel ?? null, dispositionByTool: actor.tool ?? null, dispositionAt: sql`now()`, updatedAt: sql`now()` }).where(and(eq(noteLegacyArchiveItems.id, actor.archiveId), eq(noteLegacyArchiveItems.workspaceId, actor.workspaceId), eq(noteLegacyArchiveItems.disposition, "pending"), membership(actor.workspaceId, actor.userId), editorDestinationAcl(actor.workspaceId, actor.userId, pageId))).returning({ id: noteLegacyArchiveItems.id });
    if (!row) throw new Error("LEGACY_REPLAY_MISMATCH");
    const summary = await projectLegacyArchiveSummary(transaction, actor, row.id);
    if (!summary) throw new Error("LEGACY_REPLAY_MISMATCH");
    return summary;
  });
};

export const discardLegacyArchiveItem = (input: NoteActor & { archiveId: string; actionId: string }, database: DatabaseLike = db) => {
  const actor = structuredClone(input) as NoteActor & { archiveId: string; actionId: string };
  if (!actor.actionId) throw new Error("ACTION_ID_REQUIRED");
  return inTransaction(database, async (transaction) => {
    await ensureActor(transaction, actor);
    const [archive] = await transaction.select({
      id: noteLegacyArchiveItems.id,
      disposition: noteLegacyArchiveItems.disposition,
      convertedActionId: noteLegacyArchiveItems.convertedActionId,
      dispositionByKind: noteLegacyArchiveItems.dispositionByKind,
      dispositionByUserId: noteLegacyArchiveItems.dispositionByUserId,
      dispositionByAgentJobId: noteLegacyArchiveItems.dispositionByAgentJobId,
    }).from(noteLegacyArchiveItems).where(and(eq(noteLegacyArchiveItems.id, actor.archiveId), eq(noteLegacyArchiveItems.workspaceId, actor.workspaceId), membership(actor.workspaceId, actor.userId))).limit(1).for("update");
    if (!archive) throw new Error("LEGACY_REPLAY_MISMATCH");
    const [actionCollision] = await transaction.select({ id: noteLegacyArchiveItems.id }).from(noteLegacyArchiveItems).where(and(eq(noteLegacyArchiveItems.workspaceId, actor.workspaceId), eq(noteLegacyArchiveItems.convertedActionId, actor.actionId), ne(noteLegacyArchiveItems.id, actor.archiveId))).limit(1);
    if (actionCollision) throw new Error("LEGACY_REPLAY_MISMATCH");
    const kind = actorKind(actor);
    const [row] = await transaction.update(noteLegacyArchiveItems).set({ disposition: "discarded", convertedActionId: actor.actionId, dispositionByKind: kind, dispositionByUserId: actor.userId, dispositionByAgentJobId: kind === "agent" ? actor.agentJobId ?? null : null, dispositionByChannel: actor.channel ?? null, dispositionByTool: actor.tool ?? null, dispositionAt: sql`now()`, updatedAt: sql`now()` }).where(and(eq(noteLegacyArchiveItems.id, actor.archiveId), eq(noteLegacyArchiveItems.workspaceId, actor.workspaceId), eq(noteLegacyArchiveItems.disposition, "pending"), membership(actor.workspaceId, actor.userId))).returning({ id: noteLegacyArchiveItems.id });
    if (!row) {
      const sameReplay = archive.disposition === "discarded"
        && archive.convertedActionId === actor.actionId
        && archive.dispositionByKind === kind
        && archive.dispositionByUserId === actor.userId
        && (kind === "user" ? archive.dispositionByAgentJobId === null : archive.dispositionByAgentJobId === actor.agentJobId);
      if (!sameReplay) throw new Error("LEGACY_REPLAY_MISMATCH");
    }
    const summary = await projectLegacyArchiveSummary(transaction, actor, archive.id);
    if (summary) return summary;
    throw new Error("LEGACY_REPLAY_MISMATCH");
  });
};

export const createNotesRepository = (database: DatabaseLike = db) => ({
  createPage: (input: CreateNotePageInput) => createNotePage(input, database),
  getPage: (actor: NoteActor, pageId: string) => getNotePage(actor, pageId, database),
  getOwnedPageIncludingArchived: (actor: NoteActor, pageId: string) => getOwnedNotePageIncludingArchived(actor, pageId, database),
  archivedPages: (actor: NoteActor, pagination?: NotePaginationInput) => listOwnedArchivedNotePages(actor, database, pagination),
  updatePage: (input: UpdateNotePageInput) => updateNotePage(input, database),
  getOrCreateDaily: (actor: NoteActor, dailyDate: string) => getOrCreateDailyNotePage(actor, dailyDate, database),
  listDailyByMonth: (actor: NoteActor, month: string, pagination?: NotePaginationInput) => listDailyNotePagesByMonth(actor, month, database, pagination),
  pageTree: (actor: NoteActor, pagination?: NotePaginationInput) => getNotePageTree(actor, database, pagination),
  search: (actor: NoteActor, query: string, pagination?: NotePaginationInput) => searchNotePages(actor, query, database, pagination),
  listShares: (actor: NoteActor, pageId: string, pagination?: NotePaginationInput) => listNotePageShares(actor, pageId, database, pagination),
  setShare: (input: NoteActor & { pageId: string; sharedWithUserId: string; role: "viewer" | "editor" }) => setNotePageShare(input, database),
  removeShare: (input: NoteActor & { pageId: string; sharedWithUserId: string }) => removeNotePageShare(input, database),
  reparent: (input: NoteActor & { pageId: string; parentId: string | null; expectedStateVersion: number }) => reparentNotePage(input, database),
  pendingCarryover: (actor: NoteActor, pagination?: NotePaginationInput) => listPendingNoteCarryover(actor, database, pagination),
  dailyCarryover: (actor: NoteActor & { dailyDate: string }, pagination?: NotePaginationInput) => listDailyNoteCarryover(actor, database, pagination),
  listDailyCarryover: (actor: NoteActor & { dailyDate: string }, pagination?: NotePaginationInput) => listDailyNoteCarryover(actor, database, pagination),
  updateCarryoverItem: (input: UpdateCarryoverItemInput) => updateDailyCarryoverItem(input, database),
  updateChecklistItem: (input: UpdateNoteChecklistItemInput) => updateNoteChecklistItem(input, database),
  listChecklistItems: (actor: NoteActor, pageId: string, pagination?: NotePaginationInput) => listNoteChecklistItems(actor, pageId, database, pagination),
  links: (input: NoteActor & { pageId: string }, pagination?: NotePaginationInput) => listNotePageLinks(input, database, pagination),
  backlinks: (input: NoteActor & { pageId: string }, pagination?: NotePaginationInput) => listNotePageBacklinks(input, database, pagination),
  legacy: (actor: NoteActor, options?: NotePaginationInput & { disposition?: NoteLegacyDispositionFilter }) => listLegacyArchiveItems(actor, database, options),
  getLegacy: (actor: NoteActor, archiveId: string) => getLegacyArchiveItem(actor, archiveId, database),
  convertLegacy: (input: NoteActor & { archiveId: string; pageId?: string; actionId: string }) => convertLegacyArchiveItem(input, database),
  discardLegacy: (input: NoteActor & { archiveId: string; actionId: string }) => discardLegacyArchiveItem(input, database),
});

// Compatibility aliases used by API adapters during the incremental migration.
export const getNotePageById = getNotePage;
export const getNotePages = getNotePageTree;
export const listNotes = getNotePageTree;
export const getDailyNotePage = getOrCreateDailyNotePage;
export const searchNotes = searchNotePages;
export const addNotePageShare = setNotePageShare;
export const updateChecklistItem = updateNoteChecklistItem;
