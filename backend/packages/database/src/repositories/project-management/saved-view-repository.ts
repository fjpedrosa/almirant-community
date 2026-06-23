import { db } from "../../client";
import { savedViews } from "../../schema";
import { eq, and, desc } from "drizzle-orm";

// Get all saved views for a user on a specific board
export const getSavedViewsByBoard = async (
  userId: string,
  boardId: string
) => {
  const results = await db
    .select()
    .from(savedViews)
    .where(
      and(
        eq(savedViews.userId, userId),
        eq(savedViews.boardId, boardId)
      )
    )
    .orderBy(desc(savedViews.updatedAt));

  return results;
};

// Get a single saved view by ID
export const getSavedViewById = async (id: string) => {
  const [result] = await db
    .select()
    .from(savedViews)
    .where(eq(savedViews.id, id))
    .limit(1);

  return result || null;
};

// Create a saved view
export const createSavedView = async (data: {
  userId: string;
  boardId: string;
  name: string;
  config: Record<string, unknown>;
}) => {
  const [view] = await db
    .insert(savedViews)
    .values({
      userId: data.userId,
      boardId: data.boardId,
      name: data.name,
      config: data.config,
    })
    .returning();

  if (!view) throw new Error("Failed to create saved view");
  return view;
};

// Update a saved view
export const updateSavedView = async (
  id: string,
  data: {
    name?: string;
    config?: Record<string, unknown>;
  }
) => {
  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (data.name !== undefined) updateData.name = data.name;
  if (data.config !== undefined) updateData.config = data.config;

  const [updated] = await db
    .update(savedViews)
    .set(updateData)
    .where(eq(savedViews.id, id))
    .returning();

  return updated || null;
};

// Delete a saved view
export const deleteSavedView = async (id: string): Promise<boolean> => {
  const result = await db
    .delete(savedViews)
    .where(eq(savedViews.id, id))
    .returning();
  return result.length > 0;
};
