import { db } from "../../client";
import { tags } from "../../schema";
import { eq, and, asc } from "drizzle-orm";
import type {
  Tag,
  CreateTagRequest,
  UpdateTagRequest,
} from "../../domain/types";

// Get all tags
export const getTags = async (organizationId: string): Promise<Tag[]> => {
  return db.select().from(tags).where(eq(tags.organizationId, organizationId)).orderBy(asc(tags.name));
};

// Get tag by ID
export const getTagById = async (organizationId: string, id: string): Promise<Tag | null> => {
  const [tag] = await db.select().from(tags).where(and(eq(tags.id, id), eq(tags.organizationId, organizationId))).limit(1);
  return tag || null;
};

// Get tag by name
export const getTagByName = async (organizationId: string, name: string): Promise<Tag | null> => {
  const [tag] = await db.select().from(tags).where(and(eq(tags.name, name), eq(tags.organizationId, organizationId))).limit(1);
  return tag || null;
};

// Create tag
export const createTag = async (organizationId: string, data: CreateTagRequest): Promise<Tag> => {
  const [newTag] = await db
    .insert(tags)
    .values({
      name: data.name,
      color: data.color || "#6366f1",
      organizationId,
    })
    .returning();

  if (!newTag) throw new Error("Failed to create tag");
  return newTag;
};

// Update tag
export const updateTag = async (
  organizationId: string,
  id: string,
  data: UpdateTagRequest
): Promise<Tag | null> => {
  const [updated] = await db
    .update(tags)
    .set(data)
    .where(and(eq(tags.id, id), eq(tags.organizationId, organizationId)))
    .returning();

  return updated || null;
};

// Delete tag
export const deleteTag = async (organizationId: string, id: string): Promise<boolean> => {
  const result = await db.delete(tags).where(and(eq(tags.id, id), eq(tags.organizationId, organizationId))).returning();
  return result.length > 0;
};

// Create tag if not exists
export const createTagIfNotExists = async (
  organizationId: string,
  name: string,
  color?: string
): Promise<Tag> => {
  const existing = await getTagByName(organizationId, name);
  if (existing) return existing;

  return createTag(organizationId, { name, color });
};
