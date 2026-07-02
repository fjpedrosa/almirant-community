// ---------------------------------------------------------------------------
// Ask Feature – Incremental Ingestion Service
// ---------------------------------------------------------------------------
// Fetches new/updated records from source tables (work items, documents,
// events) and upserts them into the unified ask_documents evidence index.
// All operations are idempotent via upsert on (sourceType, sourceId).
// ---------------------------------------------------------------------------

import {
  db,
  workItems,
  documents,
  workItemEvents,
  eq,
  and,
  gte,
  desc,
  sql,
} from "@almirant/database";
import {
  upsertAskDocument,
  getIngestionState,
  updateIngestionState,
} from "@almirant/database";
import type { NewAskDocument } from "@almirant/database";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Truncate text to a maximum length for excerpts */
const truncateExcerpt = (text: string | null | undefined, maxLen = 300): string => {
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + "...";
};

// ---------------------------------------------------------------------------
// Source-specific ingestion functions
// ---------------------------------------------------------------------------

/**
 * Ingest work items updated since the last cursor.
 * Creates one ask_document per work item with its title and description.
 */
export const ingestWorkItems = async (
  orgId: string,
  projectId: string,
  since?: Date
): Promise<number> => {
  const conditions = [eq(workItems.projectId, projectId)];

  if (since) {
    conditions.push(gte(workItems.updatedAt, since));
  }

  const items = await db
    .select({
      id: workItems.id,
      title: workItems.title,
      description: workItems.description,
      type: workItems.type,
      parentId: workItems.parentId,
      updatedAt: workItems.updatedAt,
      createdAt: workItems.createdAt,
    })
    .from(workItems)
    .where(and(...conditions))
    .orderBy(desc(workItems.updatedAt));

  let count = 0;
  for (const item of items) {
    try {
      const doc: NewAskDocument = {
        workspaceId: orgId,
        projectId,
        sourceType: "work_item",
        sourceId: item.id,
        title: item.title,
        content: item.description ?? "",
        excerpt: truncateExcerpt(item.description),
        featureId: item.parentId ?? undefined,
        sourceTimestamp: item.updatedAt ?? item.createdAt,
        metadata: { type: item.type },
      };
      await upsertAskDocument(doc);
      count++;
    } catch {
      // Skip individual items that fail (e.g. content too large for tsvector)
    }
  }

  return count;
};

/**
 * Ingest documents updated since the last cursor.
 * Creates one ask_document per document with its title and content.
 */
export const ingestDocuments = async (
  orgId: string,
  projectId: string,
  since?: Date
): Promise<number> => {
  const conditions = [eq(documents.projectId, projectId)];

  if (since) {
    conditions.push(gte(documents.updatedAt, since));
  }

  const docs = await db
    .select({
      id: documents.id,
      title: documents.title,
      content: documents.content,
      updatedAt: documents.updatedAt,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(and(...conditions))
    .orderBy(desc(documents.updatedAt));

  let count = 0;
  for (const doc of docs) {
    try {
      const askDoc: NewAskDocument = {
        workspaceId: orgId,
        projectId,
        sourceType: "document",
        sourceId: doc.id,
        title: doc.title,
        content: doc.content ?? "",
        excerpt: truncateExcerpt(doc.content),
        sourceTimestamp: doc.updatedAt ?? doc.createdAt,
        metadata: {},
      };
      await upsertAskDocument(askDoc);
      count++;
    } catch {
      // Skip individual documents that fail
    }
  }

  return count;
};

/**
 * Ingest work item events since the last cursor.
 * Creates one ask_document per event, linked to the parent work item's feature.
 */
export const ingestEvents = async (
  orgId: string,
  projectId: string,
  since?: Date
): Promise<number> => {
  // Events don't have a direct projectId — join through work_items
  const conditions = [eq(workItems.projectId, projectId)];

  if (since) {
    conditions.push(gte(workItemEvents.createdAt, since));
  }

  const events = await db
    .select({
      eventId: workItemEvents.id,
      workItemId: workItemEvents.workItemId,
      eventType: workItemEvents.eventType,
      fieldName: workItemEvents.fieldName,
      oldValue: workItemEvents.oldValue,
      newValue: workItemEvents.newValue,
      createdAt: workItemEvents.createdAt,
      workItemTitle: workItems.title,
      workItemParentId: workItems.parentId,
    })
    .from(workItemEvents)
    .innerJoin(workItems, eq(workItemEvents.workItemId, workItems.id))
    .where(and(...conditions))
    .orderBy(desc(workItemEvents.createdAt));

  let count = 0;
  for (const event of events) {
    try {
      const title = `${event.eventType}: ${event.workItemTitle}`;
      const contentParts: string[] = [`Event: ${event.eventType}`];
      if (event.fieldName) contentParts.push(`Field: ${event.fieldName}`);
      if (event.oldValue) contentParts.push(`From: ${event.oldValue}`);
      if (event.newValue) contentParts.push(`To: ${event.newValue}`);

      const askDoc: NewAskDocument = {
        workspaceId: orgId,
        projectId,
        sourceType: "event",
        sourceId: event.eventId,
        title,
        content: contentParts.join("\n"),
        excerpt: truncateExcerpt(contentParts.join(" | ")),
        featureId: event.workItemParentId ?? undefined,
        sourceTimestamp: event.createdAt,
        metadata: {
          eventType: event.eventType,
          fieldName: event.fieldName,
          workItemId: event.workItemId,
        },
      };
      await upsertAskDocument(askDoc);
      count++;
    } catch {
      // Skip individual events that fail
    }
  }

  return count;
};

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/** Source type identifiers matching the ingestion functions */
const SOURCE_TYPES = ["work_item", "document", "event"] as const;

/** Map source type to its ingestion function */
const ingestionFunctions: Record<
  (typeof SOURCE_TYPES)[number],
  (orgId: string, projectId: string, since?: Date) => Promise<number>
> = {
  work_item: ingestWorkItems,
  document: ingestDocuments,
  event: ingestEvents,
};

export interface IngestionResult {
  sourceType: string;
  itemsProcessed: number;
  status: "completed" | "error";
  errorMessage?: string;
}

/**
 * Run incremental ingestion for all source types within a project.
 * For each source type:
 *   1. Read the ingestion cursor
 *   2. Mark status as "running"
 *   3. Fetch & upsert new records since the cursor
 *   4. Update the cursor and mark as "completed" (or "error" on failure)
 */
export const runIncrementalIngestion = async (
  orgId: string,
  projectId: string
): Promise<IngestionResult[]> => {
  const results: IngestionResult[] = [];

  for (const sourceType of SOURCE_TYPES) {
    try {
      // 1. Get current cursor
      const state = await getIngestionState(orgId, projectId, sourceType);
      const since = state?.lastProcessedAt ?? undefined;

      // 2. Mark as running
      await updateIngestionState(orgId, projectId, sourceType, {
        status: "running",
        errorMessage: null,
      });

      // 3. Run ingestion
      const ingestFn = ingestionFunctions[sourceType];
      const itemsProcessed = await ingestFn(orgId, projectId, since);

      // 4. Update cursor
      const now = new Date();
      const previousCount = state?.itemsProcessed ?? 0;
      await updateIngestionState(orgId, projectId, sourceType, {
        status: "completed",
        lastProcessedAt: now,
        itemsProcessed: previousCount + itemsProcessed,
        errorMessage: null,
      });

      results.push({ sourceType, itemsProcessed, status: "completed" });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      await updateIngestionState(orgId, projectId, sourceType, {
        status: "error",
        errorMessage,
      }).catch(() => {
        // If updating state also fails, we still want to continue with other sources
      });

      results.push({
        sourceType,
        itemsProcessed: 0,
        status: "error",
        errorMessage,
      });
    }
  }

  return results;
};
