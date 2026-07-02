import { db } from "../../client";
import { askDocuments, askIngestionState } from "../../schema";
import { eq, and, desc, gte, lte, sql, asc } from "drizzle-orm";
import type { NewAskDocument } from "../../schema/ask-documents";
import type { AskIngestionState } from "../../schema/ask-ingestion-state";

// ---------------------------------------------------------------------------
// Filter types
// ---------------------------------------------------------------------------

export interface AskDocumentFilters {
  sourceType?: "work_item" | "document" | "event" | "commit";
  featureId?: string;
  timeRange?: { from: Date; to: Date };
  limit?: number;
  offset?: number;
}

export interface AskSearchFilters extends AskDocumentFilters {
  /** Full-text search query string */
  query: string;
}

export interface IngestionStateUpdate {
  lastProcessedAt?: Date;
  lastProcessedId?: string;
  itemsProcessed?: number;
  status?: "idle" | "running" | "error" | "completed";
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Ask Document operations
// ---------------------------------------------------------------------------

/**
 * Upsert an ask_document by (sourceType, sourceId) for idempotent ingestion.
 * Updates content, excerpt, title, and metadata if the document already exists.
 */
export const upsertAskDocument = async (data: NewAskDocument) => {
  const [doc] = await db
    .insert(askDocuments)
    .values(data)
    .onConflictDoUpdate({
      target: [askDocuments.sourceType, askDocuments.sourceId],
      set: {
        title: data.title,
        content: data.content,
        excerpt: data.excerpt,
        featureId: data.featureId,
        sourceTimestamp: data.sourceTimestamp,
        metadata: data.metadata,
        searchVector: sql`to_tsvector('english', left(coalesce(${data.title}, '') || ' ' || coalesce(${data.content ?? ""}, ''), 500000))`,
        updatedAt: sql`now()`,
      },
    })
    .returning();
  return doc!;
};

/**
 * Retrieve ask_documents for a project with optional filters.
 */
export const getAskDocumentsByProject = async (
  projectId: string,
  filters?: AskDocumentFilters
) => {
  const conditions = [eq(askDocuments.projectId, projectId)];

  if (filters?.sourceType) {
    conditions.push(
      sql`${askDocuments.sourceType} = ${filters.sourceType}` as ReturnType<typeof eq>
    );
  }
  if (filters?.featureId) {
    conditions.push(eq(askDocuments.featureId, filters.featureId));
  }
  if (filters?.timeRange?.from) {
    conditions.push(gte(askDocuments.sourceTimestamp, filters.timeRange.from));
  }
  if (filters?.timeRange?.to) {
    conditions.push(lte(askDocuments.sourceTimestamp, filters.timeRange.to));
  }

  const query = db
    .select()
    .from(askDocuments)
    .where(and(...conditions))
    .orderBy(desc(askDocuments.sourceTimestamp));

  if (filters?.limit) {
    const limited = query.limit(filters.limit);
    if (filters?.offset) {
      return limited.offset(filters.offset);
    }
    return limited;
  }

  return query;
};

/**
 * Retrieve all ask_documents associated with a specific feature.
 */
export const getAskDocumentsByFeature = async (featureId: string) => {
  return db
    .select()
    .from(askDocuments)
    .where(eq(askDocuments.featureId, featureId))
    .orderBy(desc(askDocuments.sourceTimestamp));
};

/**
 * Get the evidence timeline for a feature, ordered chronologically.
 * Returns documents sorted by sourceTimestamp ascending for a timeline view.
 */
export const getFeatureTimeline = async (featureId: string) => {
  return db
    .select({
      id: askDocuments.id,
      sourceType: askDocuments.sourceType,
      sourceId: askDocuments.sourceId,
      title: askDocuments.title,
      excerpt: askDocuments.excerpt,
      sourceTimestamp: askDocuments.sourceTimestamp,
      metadata: askDocuments.metadata,
    })
    .from(askDocuments)
    .where(eq(askDocuments.featureId, featureId))
    .orderBy(asc(askDocuments.sourceTimestamp));
};

/**
 * Full-text search across ask_documents within a project.
 * Uses PostgreSQL tsvector for ranked search results.
 */
export const searchAskDocuments = async (
  projectId: string,
  query: string,
  filters?: AskDocumentFilters
) => {
  const tsQuery = sql`plainto_tsquery('english', ${query})`;
  const conditions = [
    eq(askDocuments.projectId, projectId),
    sql`${askDocuments.searchVector} @@ ${tsQuery}`,
  ];

  if (filters?.sourceType) {
    conditions.push(
      sql`${askDocuments.sourceType} = ${filters.sourceType}` as ReturnType<typeof eq>
    );
  }
  if (filters?.featureId) {
    conditions.push(eq(askDocuments.featureId, filters.featureId));
  }
  if (filters?.timeRange?.from) {
    conditions.push(gte(askDocuments.sourceTimestamp, filters.timeRange.from));
  }
  if (filters?.timeRange?.to) {
    conditions.push(lte(askDocuments.sourceTimestamp, filters.timeRange.to));
  }

  const rankExpr = sql`ts_rank(${askDocuments.searchVector}, ${tsQuery})`;

  const baseQuery = db
    .select({
      id: askDocuments.id,
      sourceType: askDocuments.sourceType,
      sourceId: askDocuments.sourceId,
      title: askDocuments.title,
      excerpt: askDocuments.excerpt,
      content: askDocuments.content,
      sourceTimestamp: askDocuments.sourceTimestamp,
      featureId: askDocuments.featureId,
      metadata: askDocuments.metadata,
      rank: rankExpr.as("rank"),
    })
    .from(askDocuments)
    .where(and(...conditions))
    .orderBy(sql`${rankExpr} DESC`);

  const effectiveLimit = filters?.limit ?? 20;
  const limited = baseQuery.limit(effectiveLimit);

  if (filters?.offset) {
    return limited.offset(filters.offset);
  }

  return limited;
};

/**
 * Delete ask_documents by source type and source ID.
 * Used when re-indexing or cleaning up deleted source records.
 */
export const deleteAskDocumentsBySource = async (
  sourceType: "work_item" | "document" | "event" | "commit",
  sourceId: string
) => {
  return db
    .delete(askDocuments)
    .where(
      and(
        sql`${askDocuments.sourceType} = ${sourceType}` as ReturnType<typeof eq>,
        eq(askDocuments.sourceId, sourceId)
      )
    )
    .returning();
};

// ---------------------------------------------------------------------------
// Ingestion State operations
// ---------------------------------------------------------------------------

/**
 * Get the current ingestion cursor for a specific source type.
 */
export const getIngestionState = async (
  orgId: string,
  projectId: string,
  sourceType: string
): Promise<AskIngestionState | undefined> => {
  const [state] = await db
    .select()
    .from(askIngestionState)
    .where(
      and(
        eq(askIngestionState.workspaceId, orgId),
        eq(askIngestionState.projectId, projectId),
        eq(askIngestionState.sourceType, sourceType)
      )
    )
    .limit(1);
  return state;
};

/**
 * Update (or create) the ingestion state cursor.
 * Uses upsert on the unique (workspaceId, projectId, sourceType) constraint.
 */
export const updateIngestionState = async (
  orgId: string,
  projectId: string,
  sourceType: string,
  data: IngestionStateUpdate
) => {
  const [state] = await db
    .insert(askIngestionState)
    .values({
      workspaceId: orgId,
      projectId,
      sourceType,
      lastProcessedAt: data.lastProcessedAt,
      lastProcessedId: data.lastProcessedId,
      itemsProcessed: data.itemsProcessed ?? 0,
      status: data.status ?? "idle",
      errorMessage: data.errorMessage,
      metadata: data.metadata ?? {},
    })
    .onConflictDoUpdate({
      target: [
        askIngestionState.workspaceId,
        askIngestionState.projectId,
        askIngestionState.sourceType,
      ],
      set: {
        lastProcessedAt: data.lastProcessedAt,
        lastProcessedId: data.lastProcessedId,
        itemsProcessed: data.itemsProcessed,
        status: data.status,
        errorMessage: data.errorMessage,
        metadata: data.metadata,
        updatedAt: sql`now()`,
      },
    })
    .returning();
  return state!;
};
