import { db } from "../../client";
import { documentFavorites, documents, documentCategories, projects } from "../../schema";
import { eq, and, sql, desc, isNull } from "drizzle-orm";

/**
 * Toggle a document as favorite for a user.
 * If the user already favorited the document, remove it.
 * If not, add it.
 * Returns whether the document is now a favorite.
 */
export const toggleDocumentFavorite = async (
  userId: string,
  documentId: string,
  workspaceId: string
): Promise<{ isFavorite: boolean } | null> => {
  // Defense-in-depth: document must be reachable from the active workspace.
  const [documentInOrg] = await db
    .select({ id: documents.id })
    .from(documents)
    .leftJoin(projects, eq(documents.projectId, projects.id))
    .where(
      and(
        eq(documents.id, documentId),
        sql`(${documents.projectId} IS NULL OR ${projects.workspaceId} = ${workspaceId})`
      )
    )
    .limit(1);

  if (!documentInOrg) {
    return null;
  }

  // Check if already favorited
  const [existing] = await db
    .select({ id: documentFavorites.id })
    .from(documentFavorites)
    .where(
      and(
        eq(documentFavorites.userId, userId),
        eq(documentFavorites.documentId, documentId)
      )
    )
    .limit(1);

  if (existing) {
    // Remove favorite
    await db
      .delete(documentFavorites)
      .where(eq(documentFavorites.id, existing.id));
    return { isFavorite: false };
  }

  // Add favorite
  await db
    .insert(documentFavorites)
    .values({ userId, documentId });
  return { isFavorite: true };
};

/**
 * Returns a Set of document IDs that the given user has favorited.
 */
export const getFavoriteDocumentIds = async (
  userId: string
): Promise<Set<string>> => {
  const rows = await db
    .select({ documentId: documentFavorites.documentId })
    .from(documentFavorites)
    .where(eq(documentFavorites.userId, userId));

  return new Set(rows.map((r) => r.documentId));
};

/**
 * Returns full document list for a user's favorites, joined with category and project info.
 * Filters by workspace (via project) and excludes archived documents.
 */
export const getFavoriteDocuments = async (
  userId: string,
  workspaceId: string
): Promise<
  Array<{
    id: string;
    title: string;
    categoryId: string | null;
    categoryName: string | null;
    categoryColor: string | null;
    categoryIcon: string | null;
    projectId: string | null;
    projectName: string | null;
    projectColor: string | null;
    wordCount: number | null;
    isPinned: boolean | null;
    updatedAt: Date;
    favoritedAt: Date;
  }>
> => {
  const rows = await db
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
      favoritedAt: documentFavorites.createdAt,
    })
    .from(documentFavorites)
    .innerJoin(documents, eq(documentFavorites.documentId, documents.id))
    .leftJoin(documentCategories, eq(documents.categoryId, documentCategories.id))
    .leftJoin(projects, eq(documents.projectId, projects.id))
    .where(
      and(
        eq(documentFavorites.userId, userId),
        isNull(documents.archivedAt),
        sql`(${documents.projectId} IS NULL OR ${documents.projectId} IN (SELECT id FROM projects WHERE workspace_id = ${workspaceId}))`
      )
    )
    .orderBy(desc(documentFavorites.createdAt));

  return rows;
};
