import { db } from "../../client";
import { documentCategories, documents } from "../../schema";
import { eq, and, asc, sql, isNull } from "drizzle-orm";

// Get all document categories with document count
export const getDocumentCategories = async (workspaceId: string) => {
  // Count non-archived documents per category in a single query
  const countsByCategory = await db
    .select({
      categoryId: documents.categoryId,
      count: sql<number>`count(*)::int`,
    })
    .from(documents)
    .where(isNull(documents.archivedAt))
    .groupBy(documents.categoryId);

  const countMap = new Map(
    countsByCategory.map((r) => [r.categoryId, r.count])
  );

  const categories = await db
    .select()
    .from(documentCategories)
    .where(eq(documentCategories.workspaceId, workspaceId))
    .orderBy(asc(documentCategories.order));

  return categories.map((category) => ({
    ...category,
    documentCount: countMap.get(category.id) ?? 0,
  }));
};

// Get document category by ID
export const getDocumentCategoryById = async (workspaceId: string, id: string) => {
  const [category] = await db
    .select()
    .from(documentCategories)
    .where(and(eq(documentCategories.id, id), eq(documentCategories.workspaceId, workspaceId)))
    .limit(1);

  return category || null;
};

// Get document category by name and parentId (for idempotent upserts)
export const getDocumentCategoryByNameAndParent = async (
  workspaceId: string,
  name: string,
  parentId?: string | null
) => {
  const conditions = [
    sql`lower(${documentCategories.name}) = lower(${name.trim()})`,
    eq(documentCategories.workspaceId, workspaceId),
  ];

  if (parentId) {
    conditions.push(eq(documentCategories.parentId, parentId));
  } else {
    conditions.push(isNull(documentCategories.parentId));
  }

  const [category] = await db
    .select()
    .from(documentCategories)
    .where(and(...conditions))
    .limit(1);

  return category || null;
};

// Create document category
export const createDocumentCategory = async (workspaceId: string, data: {
  name: string;
  color?: string;
  icon?: string;
  parentId?: string;
}) => {
  // Get max order within the workspace
  const [maxOrder] = await db
    .select({ maxOrder: sql<number>`coalesce(max(${documentCategories.order}), -1)` })
    .from(documentCategories)
    .where(eq(documentCategories.workspaceId, workspaceId));

  const [category] = await db
    .insert(documentCategories)
    .values({
      name: data.name,
      color: data.color || "#8b5cf6",
      icon: data.icon,
      parentId: data.parentId,
      order: (maxOrder?.maxOrder ?? -1) + 1,
      workspaceId,
    })
    .returning();

  return category;
};

// Update document category
export const updateDocumentCategory = async (
  workspaceId: string,
  id: string,
  data: { name?: string; color?: string; icon?: string; parentId?: string | null; status?: "active" | "archived" }
) => {
  const [updated] = await db
    .update(documentCategories)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(and(eq(documentCategories.id, id), eq(documentCategories.workspaceId, workspaceId)))
    .returning();

  return updated || null;
};

// Delete document category
export const deleteDocumentCategory = async (workspaceId: string, id: string): Promise<boolean> => {
  const result = await db
    .delete(documentCategories)
    .where(and(eq(documentCategories.id, id), eq(documentCategories.workspaceId, workspaceId)))
    .returning();
  return result.length > 0;
};
