import { db } from "../../client";
import { aiConversations, projects } from "../../schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import type { AiConversationDb, NewAiConversation } from "../../schema/ai-conversations";
import type { PaginationParams } from "../../domain/types";

// Get all conversations with pagination, filtered by projectId and workspaceId
export const getAiConversations = async (
  workspaceId: string,
  projectId: string,
  pagination: PaginationParams
): Promise<{ conversations: AiConversationDb[]; total: number }> => {
  const whereClause = and(
    eq(aiConversations.projectId, projectId),
    eq(projects.workspaceId, workspaceId)
  );

  const [conversations, countResult] = await Promise.all([
    db
      .select({
        id: aiConversations.id,
        projectId: aiConversations.projectId,
        boardId: aiConversations.boardId,
        title: aiConversations.title,
        messages: aiConversations.messages,
        generatedWorkItemIds: aiConversations.generatedWorkItemIds,
        status: aiConversations.status,
        createdAt: aiConversations.createdAt,
        updatedAt: aiConversations.updatedAt,
      })
      .from(aiConversations)
      .innerJoin(projects, eq(aiConversations.projectId, projects.id))
      .where(whereClause)
      .orderBy(desc(aiConversations.updatedAt))
      .limit(pagination.limit)
      .offset(pagination.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(aiConversations)
      .innerJoin(projects, eq(aiConversations.projectId, projects.id))
      .where(whereClause),
  ]);

  return {
    conversations: conversations as AiConversationDb[],
    total: countResult[0]?.count ?? 0,
  };
};

// Get a single conversation by ID, verified against workspaceId
export const getAiConversationById = async (
  workspaceId: string,
  id: string
): Promise<AiConversationDb | null> => {
  const [conversation] = await db
    .select({
      id: aiConversations.id,
      projectId: aiConversations.projectId,
      boardId: aiConversations.boardId,
      title: aiConversations.title,
      messages: aiConversations.messages,
      generatedWorkItemIds: aiConversations.generatedWorkItemIds,
      status: aiConversations.status,
      createdAt: aiConversations.createdAt,
      updatedAt: aiConversations.updatedAt,
    })
    .from(aiConversations)
    .innerJoin(projects, eq(aiConversations.projectId, projects.id))
    .where(
      and(
        eq(aiConversations.id, id),
        eq(projects.workspaceId, workspaceId)
      )
    )
    .limit(1);
  return (conversation as AiConversationDb) ?? null;
};

// Create a new conversation (org verification is done at the route level via projectId)
export const createAiConversation = async (
  data: NewAiConversation
): Promise<AiConversationDb> => {
  const [conversation] = await db
    .insert(aiConversations)
    .values(data)
    .returning();
  if (!conversation) throw new Error("Failed to create AI conversation");
  return conversation;
};

// Update a conversation, verified against workspaceId
export const updateAiConversation = async (
  workspaceId: string,
  id: string,
  data: Partial<Pick<NewAiConversation, "title" | "status" | "messages" | "generatedWorkItemIds" | "boardId">>
): Promise<AiConversationDb | null> => {
  // Subquery: only update if conversation belongs to a project owned by the org
  const orgProjectIds = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.workspaceId, workspaceId));

  const [updated] = await db
    .update(aiConversations)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(aiConversations.id, id),
        inArray(aiConversations.projectId, orgProjectIds)
      )
    )
    .returning();
  return updated ?? null;
};

// Delete a conversation, verified against workspaceId
export const deleteAiConversation = async (
  workspaceId: string,
  id: string
): Promise<boolean> => {
  // Subquery: only delete if conversation belongs to a project owned by the org
  const orgProjectIds = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.workspaceId, workspaceId));

  const result = await db
    .delete(aiConversations)
    .where(
      and(
        eq(aiConversations.id, id),
        inArray(aiConversations.projectId, orgProjectIds)
      )
    )
    .returning();
  return result.length > 0;
};
