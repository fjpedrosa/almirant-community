import { db } from "../../client";
import { tags } from "../../schema";
import { eq, and, asc } from "drizzle-orm";
import type {
  Tag,
  CreateTagRequest,
  UpdateTagRequest,
} from "../../domain/types";

// Get all tags
export const getTags = async (workspaceId: string): Promise<Tag[]> => {
  return db.select().from(tags).where(eq(tags.workspaceId, workspaceId)).orderBy(asc(tags.name));
};

// Get tag by ID
export const getTagById = async (workspaceId: string, id: string): Promise<Tag | null> => {
  const [tag] = await db.select().from(tags).where(and(eq(tags.id, id), eq(tags.workspaceId, workspaceId))).limit(1);
  return tag || null;
};

// Get tag by name
export const getTagByName = async (workspaceId: string, name: string): Promise<Tag | null> => {
  const [tag] = await db.select().from(tags).where(and(eq(tags.name, name), eq(tags.workspaceId, workspaceId))).limit(1);
  return tag || null;
};

// Create tag
export const createTag = async (workspaceId: string, data: CreateTagRequest): Promise<Tag> => {
  const [newTag] = await db
    .insert(tags)
    .values({
      name: data.name,
      color: data.color || "#6366f1",
      workspaceId,
    })
    .returning();

  if (!newTag) throw new Error("Failed to create tag");
  return newTag;
};

// Update tag
export const updateTag = async (
  workspaceId: string,
  id: string,
  data: UpdateTagRequest
): Promise<Tag | null> => {
  const [updated] = await db
    .update(tags)
    .set(data)
    .where(and(eq(tags.id, id), eq(tags.workspaceId, workspaceId)))
    .returning();

  return updated || null;
};

// Delete tag
export const deleteTag = async (workspaceId: string, id: string): Promise<boolean> => {
  const result = await db.delete(tags).where(and(eq(tags.id, id), eq(tags.workspaceId, workspaceId))).returning();
  return result.length > 0;
};

// Create tag if not exists
export const createTagIfNotExists = async (
  workspaceId: string,
  name: string,
  color?: string
): Promise<Tag> => {
  const existing = await getTagByName(workspaceId, name);
  if (existing) return existing;

  return createTag(workspaceId, { name, color });
};
