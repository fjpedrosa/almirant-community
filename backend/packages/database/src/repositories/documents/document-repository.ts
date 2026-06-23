import { db } from "../../client";
import { documents, documentCategories, projects } from "../../schema";
import { eq, and, or, ilike, desc, asc, sql, isNull, inArray } from "drizzle-orm";
import type { PaginationParams } from "../../domain/types";

// Find document by file path within a project
export const getDocumentByFilePath = async (
  organizationId: string,
  filePath: string,
  projectId: string
) => {
  // Defense-in-depth: verify project belongs to organization
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
    .limit(1);

  if (!project) return null;

  const [result] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.filePath, filePath), eq(documents.projectId, projectId)))
    .limit(1);
  return result || null;
};

// Legacy lookup for environments where file_path is not available yet.
// Falls back to title + project matching, taking the most recently updated row.
export const getDocumentByTitleAndProject = async (
  organizationId: string,
  title: string,
  projectId: string
) => {
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
    .limit(1);

  if (!project) return null;

  const [result] = await db
    .select({
      id: documents.id,
      title: documents.title,
      content: documents.content,
      categoryId: documents.categoryId,
      projectId: documents.projectId,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .where(and(eq(documents.title, title), eq(documents.projectId, projectId)))
    .orderBy(desc(documents.updatedAt))
    .limit(1);

  return result || null;
};

// Create document with sync fields (filePath, contentHash, s3Key)
export const createSyncedDocument = async (organizationId: string, data: {
  title: string;
  content: string;
  projectId: string;
  filePath: string;
  contentHash: string;
  s3Key: string;
  categoryId?: string;
}) => {
  const metrics = computeContentMetrics(data.content);
  const [doc] = await db
    .insert(documents)
    .values({
      title: data.title,
      content: data.content,
      projectId: data.projectId,
      filePath: data.filePath,
      contentHash: data.contentHash,
      s3Key: data.s3Key,
      categoryId: data.categoryId || null,
      wordCount: metrics.wordCount,
      sizeBytes: metrics.sizeBytes,
    })
    .returning();
  if (!doc) throw new Error("Failed to create synced document");
  return doc;
};

// Update document with sync fields (contentHash, s3Key, filePath, content, title)
export const updateSyncedDocument = async (
  organizationId: string,
  id: string,
  data: {
    title: string;
    content: string;
    contentHash: string;
    s3Key: string;
    filePath: string;
    categoryId?: string;
  }
) => {
  const metrics = computeContentMetrics(data.content);
  const [updated] = await db
    .update(documents)
    .set({
      title: data.title,
      content: data.content,
      contentHash: data.contentHash,
      s3Key: data.s3Key,
      filePath: data.filePath,
      ...(data.categoryId !== undefined ? { categoryId: data.categoryId } : {}),
      wordCount: metrics.wordCount,
      sizeBytes: metrics.sizeBytes,
      updatedAt: new Date(),
    })
    .where(and(eq(documents.id, id), inArray(documents.projectId, orgProjectIds(organizationId))))
    .returning();
  return updated || null;
};

// Update only the category assignment of a document (used when content hasn't changed but category mapping has)
export const updateDocumentCategoryAssignment = async (organizationId: string, id: string, categoryId: string) => {
  const [updated] = await db
    .update(documents)
    .set({ categoryId, updatedAt: new Date() })
    .where(and(eq(documents.id, id), inArray(documents.projectId, orgProjectIds(organizationId))))
    .returning();
  return updated || null;
};

// Get all synced documents (with filePath) that have no category assigned
export const getUncategorizedSyncedDocuments = async (
  projectId: string
): Promise<Array<{ id: string; filePath: string }>> => {
  return db
    .select({ id: documents.id, filePath: documents.filePath })
    .from(documents)
    .where(
      and(
        eq(documents.projectId, projectId),
        isNull(documents.categoryId),
        sql`${documents.filePath} IS NOT NULL`
      )
    ) as unknown as Promise<Array<{ id: string; filePath: string }>>;
};

// Build a subquery that returns project IDs belonging to a given organization.
// Used to scope document operations to the correct organization when the
// documents table lacks a direct organizationId column.
const orgProjectIds = (organizationId: string) =>
  db.select({ id: projects.id }).from(projects).where(eq(projects.organizationId, organizationId));

// Calculate word count and size from content
const computeContentMetrics = (content: string | null | undefined) => {
  if (!content) return { wordCount: 0, sizeBytes: 0 };
  const wordCount = content.trim().split(/\s+/).filter(Boolean).length;
  const sizeBytes = new TextEncoder().encode(content).length;
  return { wordCount, sizeBytes };
};

// Get documents with pagination and filters
export const getDocuments = async (
  organizationId: string,
  pagination: PaginationParams,
  filters?: {
    search?: string;
    categoryId?: string;
    isPinned?: boolean;
    projectId?: string;
    includeArchived?: boolean;
  }
): Promise<{ items: Array<Record<string, unknown>>; total: number }> => {
  const conditions = [];

  // Exclude archived documents by default
  if (!filters?.includeArchived) {
    conditions.push(isNull(documents.archivedAt));
  }

  // Defense-in-depth: filter by organization through project
  conditions.push(
    sql`(${documents.projectId} IS NULL OR ${documents.projectId} IN (SELECT id FROM projects WHERE organization_id = ${organizationId} AND status != 'archived'))`
  );

  if (filters?.search) {
    if (filters.search.length >= 2) {
      conditions.push(
        sql`${documents.searchVector} @@ (plainto_tsquery('spanish', ${filters.search}) || plainto_tsquery('english', ${filters.search}))`
      );
    } else {
      conditions.push(
        or(
          ilike(documents.title, `%${filters.search}%`),
          ilike(documents.content, `%${filters.search}%`)
        )
      );
    }
  }

  if (filters?.categoryId) {
    conditions.push(eq(documents.categoryId, filters.categoryId));
  }

  if (filters?.isPinned !== undefined) {
    conditions.push(eq(documents.isPinned, filters.isPinned));
  }

  if (filters?.projectId) {
    if (filters.projectId === "none") {
      conditions.push(isNull(documents.projectId));
    } else {
      conditions.push(eq(documents.projectId, filters.projectId));
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [itemsResult, countResult] = await Promise.all([
    db
      .select({
        id: documents.id,
        title: documents.title,
        content: documents.content,
        categoryId: documents.categoryId,
        projectId: documents.projectId,
        wordCount: documents.wordCount,
        sizeBytes: documents.sizeBytes,
        isPinned: documents.isPinned,
        createdAt: documents.createdAt,
        updatedAt: documents.updatedAt,
        categoryName: documentCategories.name,
        categoryColor: documentCategories.color,
        categoryIcon: documentCategories.icon,
        projectName: projects.name,
        projectColor: projects.color,
      })
      .from(documents)
      .leftJoin(documentCategories, eq(documents.categoryId, documentCategories.id))
      .leftJoin(projects, eq(documents.projectId, projects.id))
      .where(whereClause)
      .orderBy(desc(documents.isPinned), desc(documents.updatedAt))
      .limit(pagination.limit)
      .offset(pagination.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(documents)
      .where(whereClause),
  ]);

  return {
    items: itemsResult,
    total: countResult[0]?.count ?? 0,
  };
};

// Get document by ID with category and project
export const getDocumentById = async (organizationId: string, id: string) => {
  const [result] = await db
    .select({
      id: documents.id,
      title: documents.title,
      content: documents.content,
      categoryId: documents.categoryId,
      projectId: documents.projectId,
      filePath: documents.filePath,
      wordCount: documents.wordCount,
      sizeBytes: documents.sizeBytes,
      isPinned: documents.isPinned,
      createdAt: documents.createdAt,
      updatedAt: documents.updatedAt,
      categoryName: documentCategories.name,
      categoryColor: documentCategories.color,
      categoryIcon: documentCategories.icon,
      projectName: projects.name,
      projectColor: projects.color,
    })
    .from(documents)
    .leftJoin(documentCategories, eq(documents.categoryId, documentCategories.id))
    .leftJoin(projects, eq(documents.projectId, projects.id))
    .where(and(
      eq(documents.id, id),
      sql`(${documents.projectId} IS NULL OR ${projects.organizationId} = ${organizationId})`
    ))
    .limit(1);

  return result || null;
};

// Create document
export const createDocument = async (organizationId: string, data: {
  title: string;
  content?: string;
  categoryId?: string;
  projectId?: string;
}) => {
  const metrics = computeContentMetrics(data.content);

  const [doc] = await db
    .insert(documents)
    .values({
      title: data.title,
      content: data.content || "",
      categoryId: data.categoryId || null,
      projectId: data.projectId || null,
      wordCount: metrics.wordCount,
      sizeBytes: metrics.sizeBytes,
    })
    .returning();

  if (!doc) throw new Error("Failed to create document");
  return getDocumentById(organizationId, doc.id);
};

// Update document
export const updateDocument = async (
  organizationId: string,
  id: string,
  data: {
    title?: string;
    content?: string;
    categoryId?: string | null;
    projectId?: string | null;
    isPinned?: boolean;
  }
) => {
  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (data.title !== undefined) updateData.title = data.title;
  if (data.categoryId !== undefined) updateData.categoryId = data.categoryId;
  if (data.projectId !== undefined) updateData.projectId = data.projectId;
  if (data.isPinned !== undefined) updateData.isPinned = data.isPinned;

  if (data.content !== undefined) {
    updateData.content = data.content;
    const metrics = computeContentMetrics(data.content);
    updateData.wordCount = metrics.wordCount;
    updateData.sizeBytes = metrics.sizeBytes;
  }

  const [updated] = await db
    .update(documents)
    .set(updateData)
    .where(and(
      eq(documents.id, id),
      sql`(${documents.projectId} IS NULL OR ${documents.projectId} IN (SELECT id FROM projects WHERE organization_id = ${organizationId}))`
    ))
    .returning();

  if (!updated) return null;

  return getDocumentById(organizationId, id);
};

// Archive document (soft delete - sets archivedAt timestamp)
export const archiveDocument = async (organizationId: string, id: string) => {
  const [archived] = await db
    .update(documents)
    .set({
      archivedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(
      eq(documents.id, id),
      sql`(${documents.projectId} IS NULL OR ${documents.projectId} IN (SELECT id FROM projects WHERE organization_id = ${organizationId}))`
    ))
    .returning();
  return archived || null;
};

// Unarchive document (restore from archive)
export const unarchiveDocument = async (organizationId: string, id: string) => {
  const [restored] = await db
    .update(documents)
    .set({
      archivedAt: null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(documents.id, id),
      sql`(${documents.projectId} IS NULL OR ${documents.projectId} IN (SELECT id FROM projects WHERE organization_id = ${organizationId}))`
    ))
    .returning();
  return restored || null;
};

// Delete document
export const deleteDocument = async (organizationId: string, id: string): Promise<boolean> => {
  const result = await db
    .delete(documents)
    .where(and(
      eq(documents.id, id),
      sql`(${documents.projectId} IS NULL OR ${documents.projectId} IN (SELECT id FROM projects WHERE organization_id = ${organizationId}))`
    ))
    .returning();
  return result.length > 0;
};

// Get documents grouped by project for cross-project navigation
export const getDocumentsCrossProject = async (organizationId: string, filters?: {
  search?: string;
  categoryId?: string;
  includeArchived?: boolean;
}): Promise<{
  groups: Array<{
    projectId: string | null;
    projectName: string | null;
    projectColor: string | null;
    documents: Array<{
      id: string;
      title: string;
      categoryId: string | null;
      categoryName: string | null;
      categoryColor: string | null;
      categoryIcon: string | null;
      wordCount: number | null;
      isPinned: boolean | null;
      updatedAt: Date;
    }>;
  }>;
}> => {
  const conditions = [];

  // Exclude archived documents by default
  if (!filters?.includeArchived) {
    conditions.push(isNull(documents.archivedAt));
  }

  // Defense-in-depth: filter by organization through project
  conditions.push(
    sql`(${documents.projectId} IS NULL OR ${documents.projectId} IN (SELECT id FROM projects WHERE organization_id = ${organizationId} AND status != 'archived'))`
  );

  if (filters?.search) {
    if (filters.search.length >= 2) {
      conditions.push(
        sql`${documents.searchVector} @@ (plainto_tsquery('spanish', ${filters.search}) || plainto_tsquery('english', ${filters.search}))`
      );
    } else {
      conditions.push(
        or(
          ilike(documents.title, `%${filters.search}%`),
          ilike(documents.content, `%${filters.search}%`)
        )
      );
    }
  }

  if (filters?.categoryId) {
    conditions.push(eq(documents.categoryId, filters.categoryId));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const results = await db
    .select({
      id: documents.id,
      title: documents.title,
      categoryId: documents.categoryId,
      projectId: documents.projectId,
      wordCount: documents.wordCount,
      isPinned: documents.isPinned,
      updatedAt: documents.updatedAt,
      categoryName: documentCategories.name,
      categoryColor: documentCategories.color,
      categoryIcon: documentCategories.icon,
      projectName: projects.name,
      projectColor: projects.color,
    })
    .from(documents)
    .leftJoin(documentCategories, eq(documents.categoryId, documentCategories.id))
    .leftJoin(projects, eq(documents.projectId, projects.id))
    .where(whereClause)
    .orderBy(desc(documents.isPinned), desc(documents.updatedAt));

  // Group by project
  const groupMap = new Map<
    string,
    {
      projectId: string | null;
      projectName: string | null;
      projectColor: string | null;
      documents: Array<{
        id: string;
        title: string;
        categoryId: string | null;
        categoryName: string | null;
        categoryColor: string | null;
        categoryIcon: string | null;
        wordCount: number | null;
        isPinned: boolean | null;
        updatedAt: Date;
      }>;
    }
  >();

  for (const row of results) {
    const key = row.projectId ?? "__knowhow__";
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        projectId: row.projectId,
        projectName: row.projectName,
        projectColor: row.projectColor,
        documents: [],
      });
    }
    groupMap.get(key)!.documents.push({
      id: row.id,
      title: row.title,
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      categoryColor: row.categoryColor,
      categoryIcon: row.categoryIcon,
      wordCount: row.wordCount,
      isPinned: row.isPinned,
      updatedAt: row.updatedAt,
    });
  }

  // Build result array: Know-How (null projectId) first, then projects alphabetically
  const groups = Array.from(groupMap.values());
  groups.sort((a, b) => {
    // null projectId (Know-How) always first
    if (a.projectId === null) return -1;
    if (b.projectId === null) return 1;
    return (a.projectName || "").localeCompare(b.projectName || "");
  });

  return { groups };
};

// Full-text search across all documents with filters and content snippets
export const searchDocumentsFullText = async (
  organizationId: string,
  query: string,
  filters?: {
    projectId?: string;
    categoryId?: string;
  },
  pagination?: { page?: number; limit?: number }
): Promise<{
  items: Array<{
    id: string;
    title: string;
    snippet: string | null;
    categoryId: string | null;
    categoryName: string | null;
    categoryColor: string | null;
    categoryIcon: string | null;
    projectId: string | null;
    projectName: string | null;
    projectColor: string | null;
    wordCount: number | null;
    updatedAt: Date;
    matchedIn: "title" | "content" | "both";
  }>;
  total: number;
}> => {
  const page = pagination?.page ?? 1;
  const limit = Math.min(pagination?.limit ?? 20, 100);
  const offset = (page - 1) * limit;

  const useTsvector = query.length >= 2;

  // Build the tsquery combining Spanish and English configs
  const tsqueryExpr = sql`(plainto_tsquery('spanish', ${query}) || plainto_tsquery('english', ${query}))`;

  const conditions = [
    // Exclude archived documents
    isNull(documents.archivedAt),
    // Defense-in-depth: filter by organization through project
    sql`(${documents.projectId} IS NULL OR ${documents.projectId} IN (SELECT id FROM projects WHERE organization_id = ${organizationId} AND status != 'archived'))`,
  ];

  // Search condition: tsvector for 2+ chars, ILIKE fallback for single char
  if (useTsvector) {
    conditions.push(
      sql`${documents.searchVector} @@ ${tsqueryExpr}`
    );
  } else {
    conditions.push(
      or(
        ilike(documents.title, `%${query}%`),
        ilike(documents.content, `%${query}%`)
      )!
    );
  }

  if (filters?.projectId) {
    if (filters.projectId === "none") {
      conditions.push(isNull(documents.projectId));
    } else {
      conditions.push(eq(documents.projectId, filters.projectId));
    }
  }

  if (filters?.categoryId) {
    conditions.push(eq(documents.categoryId, filters.categoryId));
  }

  const whereClause = and(...conditions);

  // Build select fields - add tsvector-computed columns when using full-text search
  const baseSelect = {
    id: documents.id,
    title: documents.title,
    content: documents.content,
    categoryId: documents.categoryId,
    projectId: documents.projectId,
    wordCount: documents.wordCount,
    updatedAt: documents.updatedAt,
    categoryName: documentCategories.name,
    categoryColor: documentCategories.color,
    categoryIcon: documentCategories.icon,
    projectName: projects.name,
    projectColor: projects.color,
  };

  if (useTsvector) {
    // Use ts_rank for relevance and ts_headline for snippets
    const selectWithFts = {
      ...baseSelect,
      rank: sql<number>`ts_rank(${documents.searchVector}, ${tsqueryExpr})`.as("rank"),
      snippet: sql<string>`ts_headline(
        'spanish',
        COALESCE(${documents.content}, ''),
        ${tsqueryExpr},
        'MaxFragments=1,MaxWords=30,MinWords=15,StartSel=<mark>,StopSel=</mark>'
      )`.as("snippet"),
      titleMatch: sql<boolean>`(
        to_tsvector('spanish', ${documents.title}) @@ ${tsqueryExpr}
        OR to_tsvector('english', ${documents.title}) @@ ${tsqueryExpr}
      )`.as("title_match"),
      contentMatch: sql<boolean>`(
        ${documents.content} IS NOT NULL
        AND (
          to_tsvector('spanish', COALESCE(${documents.content}, '')) @@ ${tsqueryExpr}
          OR to_tsvector('english', COALESCE(${documents.content}, '')) @@ ${tsqueryExpr}
        )
      )`.as("content_match"),
    };

    const [itemsResult, countResult] = await Promise.all([
      db
        .select(selectWithFts)
        .from(documents)
        .leftJoin(documentCategories, eq(documents.categoryId, documentCategories.id))
        .leftJoin(projects, eq(documents.projectId, projects.id))
        .where(whereClause)
        .orderBy(sql`rank DESC`, desc(documents.updatedAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(documents)
        .where(whereClause),
    ]);

    const items = itemsResult.map((row) => {
      const titleMatches = Boolean(row.titleMatch);
      const contentMatches = Boolean(row.contentMatch);

      let matchedIn: "title" | "content" | "both" = "title";
      if (titleMatches && contentMatches) matchedIn = "both";
      else if (contentMatches) matchedIn = "content";

      // Use ts_headline snippet; fallback to beginning of content if headline is empty
      let snippet: string | null = row.snippet || null;
      if (!snippet && row.content) {
        snippet = row.content.slice(0, 200).replace(/\n+/g, " ").trim();
        if (row.content.length > 200) snippet += "...";
      }

      return {
        id: row.id,
        title: row.title,
        snippet,
        categoryId: row.categoryId,
        categoryName: row.categoryName,
        categoryColor: row.categoryColor,
        categoryIcon: row.categoryIcon,
        projectId: row.projectId,
        projectName: row.projectName,
        projectColor: row.projectColor,
        wordCount: row.wordCount,
        updatedAt: row.updatedAt,
        matchedIn,
      };
    });

    return {
      items,
      total: countResult[0]?.count ?? 0,
    };
  }

  // ILIKE fallback path for single-character queries
  const [itemsResult, countResult] = await Promise.all([
    db
      .select(baseSelect)
      .from(documents)
      .leftJoin(documentCategories, eq(documents.categoryId, documentCategories.id))
      .leftJoin(projects, eq(documents.projectId, projects.id))
      .where(whereClause)
      .orderBy(desc(documents.updatedAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(documents)
      .where(whereClause),
  ]);

  const items = itemsResult.map((row) => {
    const titleMatches = row.title.toLowerCase().includes(query.toLowerCase());
    const contentMatches = row.content
      ? row.content.toLowerCase().includes(query.toLowerCase())
      : false;

    let matchedIn: "title" | "content" | "both" = "title";
    if (titleMatches && contentMatches) matchedIn = "both";
    else if (contentMatches) matchedIn = "content";

    // Extract a snippet around the first match in content
    let snippet: string | null = null;
    if (row.content) {
      const lowerContent = row.content.toLowerCase();
      const matchIndex = lowerContent.indexOf(query.toLowerCase());
      if (matchIndex !== -1) {
        const snippetRadius = 100;
        const start = Math.max(0, matchIndex - snippetRadius);
        const end = Math.min(row.content.length, matchIndex + query.length + snippetRadius);
        snippet =
          (start > 0 ? "..." : "") +
          row.content.slice(start, end).replace(/\n+/g, " ").trim() +
          (end < row.content.length ? "..." : "");
      } else {
        // No content match -- show beginning of content as preview
        snippet = row.content.slice(0, 200).replace(/\n+/g, " ").trim();
        if (row.content.length > 200) snippet += "...";
      }
    }

    return {
      id: row.id,
      title: row.title,
      snippet,
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      categoryColor: row.categoryColor,
      categoryIcon: row.categoryIcon,
      projectId: row.projectId,
      projectName: row.projectName,
      projectColor: row.projectColor,
      wordCount: row.wordCount,
      updatedAt: row.updatedAt,
      matchedIn,
    };
  });

  return {
    items,
    total: countResult[0]?.count ?? 0,
  };
};
