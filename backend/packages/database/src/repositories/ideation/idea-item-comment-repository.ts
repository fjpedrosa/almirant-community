import { db } from "../../client";
import { ideaItemComments, commentMentions, commentVersions } from "../../schema";
import { ideaItems } from "../../schema";
import { user } from "../../schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { parseMentionsFromHtml } from "../../utils/mention-parser";

export interface IdeaItemCommentWithAuthor {
  id: string;
  ideaItemId: string;
  userId: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  author: {
    id: string;
    name: string;
    email: string;
    image: string | null;
  };
  mentionedUserIds: string[];
}

export interface IdeaItemCommentVersionWithEditor {
  id: string;
  commentId: string;
  entityType: string;
  content: string;
  editedAt: Date;
  editedByUserId: string;
  editedBy: {
    id: string;
    name: string;
    email: string;
    image: string | null;
  };
}

/**
 * Syncs comment_mentions rows for a given comment.
 * Deletes existing mentions and inserts the new set.
 * Returns the list of mentioned user IDs.
 */
const syncMentions = async (
  commentId: string,
  ideaItemId: string,
  htmlContent: string
): Promise<string[]> => {
  const mentionedUserIds = parseMentionsFromHtml(htmlContent);

  // Delete existing mentions for this comment
  await db
    .delete(commentMentions)
    .where(eq(commentMentions.commentId, commentId));

  // Insert new mentions if any
  if (mentionedUserIds.length > 0) {
    await db.insert(commentMentions).values(
      mentionedUserIds.map((mentionedUserId) => ({
        commentId,
        mentionedUserId,
        ideaItemId,
      }))
    );
  }

  return mentionedUserIds;
};

export const getCommentsByIdeaItem = async (
  organizationId: string,
  ideaItemId: string
): Promise<IdeaItemCommentWithAuthor[]> => {
  const rows = await db
    .select({
      id: ideaItemComments.id,
      ideaItemId: ideaItemComments.ideaItemId,
      userId: ideaItemComments.userId,
      content: ideaItemComments.content,
      createdAt: ideaItemComments.createdAt,
      updatedAt: ideaItemComments.updatedAt,
      authorId: user.id,
      authorName: user.name,
      authorEmail: user.email,
      authorImage: user.image,
    })
    .from(ideaItemComments)
    .innerJoin(ideaItems, eq(ideaItemComments.ideaItemId, ideaItems.id))
    .innerJoin(user, eq(ideaItemComments.userId, user.id))
    .where(
      and(
        eq(ideaItemComments.ideaItemId, ideaItemId),
        eq(ideaItems.organizationId, organizationId)
      )
    )
    .orderBy(desc(ideaItemComments.createdAt));

  // Fetch mentions for all comments in one query
  const commentIds = rows.map((r) => r.id);
  const allMentions =
    commentIds.length > 0
      ? await db
          .select({
            commentId: commentMentions.commentId,
            mentionedUserId: commentMentions.mentionedUserId,
          })
          .from(commentMentions)
          .where(inArray(commentMentions.commentId, commentIds))
      : [];

  // Group mentions by commentId
  const mentionsByComment = new Map<string, string[]>();
  for (const m of allMentions) {
    const list = mentionsByComment.get(m.commentId) ?? [];
    list.push(m.mentionedUserId);
    mentionsByComment.set(m.commentId, list);
  }

  return rows.map((row) => ({
    id: row.id,
    ideaItemId: row.ideaItemId,
    userId: row.userId,
    content: row.content,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    author: {
      id: row.authorId,
      name: row.authorName,
      email: row.authorEmail,
      image: row.authorImage,
    },
    mentionedUserIds: mentionsByComment.get(row.id) ?? [],
  }));
};

export const createIdeaItemComment = async (
  organizationId: string,
  ideaItemId: string,
  userId: string,
  content: string
): Promise<IdeaItemCommentWithAuthor> => {
  // Verify the idea item belongs to the organization
  const [item] = await db
    .select({ id: ideaItems.id })
    .from(ideaItems)
    .where(
      and(eq(ideaItems.id, ideaItemId), eq(ideaItems.organizationId, organizationId))
    )
    .limit(1);

  if (!item) {
    throw new Error("IDEA_ITEM_NOT_FOUND");
  }

  const [result] = await db
    .insert(ideaItemComments)
    .values({ ideaItemId, userId, content })
    .returning();

  const [author] = await db
    .select({ id: user.id, name: user.name, email: user.email, image: user.image })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  if (!result) throw new Error("Failed to insert comment");

  // Sync mentions from HTML content
  const mentionedUserIds = await syncMentions(result.id, ideaItemId, content);

  return {
    id: result.id,
    ideaItemId: result.ideaItemId,
    userId: result.userId,
    content: result.content,
    createdAt: result.createdAt,
    updatedAt: result.updatedAt,
    author: author!,
    mentionedUserIds,
  };
};

export const updateIdeaItemComment = async (
  organizationId: string,
  commentId: string,
  userId: string,
  content: string
): Promise<IdeaItemCommentWithAuthor | null> => {
  // Verify ownership: comment must belong to the user and idea must belong to the org
  const [existing] = await db
    .select({
      id: ideaItemComments.id,
      userId: ideaItemComments.userId,
      ideaItemId: ideaItemComments.ideaItemId,
      content: ideaItemComments.content,
      orgId: ideaItems.organizationId,
    })
    .from(ideaItemComments)
    .innerJoin(ideaItems, eq(ideaItemComments.ideaItemId, ideaItems.id))
    .where(eq(ideaItemComments.id, commentId))
    .limit(1);

  if (!existing || existing.orgId !== organizationId) {
    return null;
  }
  if (existing.userId !== userId) {
    throw new Error("COMMENT_NOT_OWNED");
  }

  // Save previous version before updating
  await db.insert(commentVersions).values({
    commentId: existing.id,
    entityType: "idea",
    content: existing.content,
    editedByUserId: userId,
  });

  const [result] = await db
    .update(ideaItemComments)
    .set({ content, updatedAt: new Date() })
    .where(eq(ideaItemComments.id, commentId))
    .returning();

  const [author] = await db
    .select({ id: user.id, name: user.name, email: user.email, image: user.image })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  if (!result) throw new Error("Failed to update comment");

  // Re-sync mentions from updated HTML content
  const mentionedUserIds = await syncMentions(result.id, existing.ideaItemId, content);

  return {
    id: result.id,
    ideaItemId: result.ideaItemId,
    userId: result.userId,
    content: result.content,
    createdAt: result.createdAt,
    updatedAt: result.updatedAt,
    author: author!,
    mentionedUserIds,
  };
};

export const getCommentMentionUserIds = async (
  commentId: string
): Promise<string[]> => {
  const rows = await db
    .select({ mentionedUserId: commentMentions.mentionedUserId })
    .from(commentMentions)
    .where(eq(commentMentions.commentId, commentId));
  return rows.map((r) => r.mentionedUserId);
};

export const getIdeaItemCommentVersions = async (
  organizationId: string,
  ideaItemId: string,
  commentId: string
): Promise<IdeaItemCommentVersionWithEditor[]> => {
  const rows = await db
    .select({
      id: commentVersions.id,
      commentId: commentVersions.commentId,
      entityType: commentVersions.entityType,
      content: commentVersions.content,
      editedAt: commentVersions.editedAt,
      editedByUserId: commentVersions.editedByUserId,
      editedByName: user.name,
      editedByEmail: user.email,
      editedByImage: user.image,
    })
    .from(commentVersions)
    .innerJoin(ideaItemComments, eq(commentVersions.commentId, ideaItemComments.id))
    .innerJoin(ideaItems, eq(ideaItemComments.ideaItemId, ideaItems.id))
    .innerJoin(user, eq(commentVersions.editedByUserId, user.id))
    .where(
      and(
        eq(commentVersions.commentId, commentId),
        eq(commentVersions.entityType, "idea"),
        eq(ideaItemComments.ideaItemId, ideaItemId),
        eq(ideaItems.organizationId, organizationId)
      )
    )
    .orderBy(desc(commentVersions.editedAt));

  return rows.map((row) => ({
    id: row.id,
    commentId: row.commentId,
    entityType: row.entityType,
    content: row.content,
    editedAt: row.editedAt,
    editedByUserId: row.editedByUserId,
    editedBy: {
      id: row.editedByUserId,
      name: row.editedByName,
      email: row.editedByEmail,
      image: row.editedByImage,
    },
  }));
};

export const deleteIdeaItemComment = async (
  organizationId: string,
  commentId: string,
  userId: string
): Promise<boolean> => {
  // Verify ownership
  const [existing] = await db
    .select({
      id: ideaItemComments.id,
      userId: ideaItemComments.userId,
      orgId: ideaItems.organizationId,
    })
    .from(ideaItemComments)
    .innerJoin(ideaItems, eq(ideaItemComments.ideaItemId, ideaItems.id))
    .where(eq(ideaItemComments.id, commentId))
    .limit(1);

  if (!existing || existing.orgId !== organizationId) {
    return false;
  }
  if (existing.userId !== userId) {
    throw new Error("COMMENT_NOT_OWNED");
  }

  // comment_mentions rows are CASCADE-deleted automatically
  const result = await db
    .delete(ideaItemComments)
    .where(eq(ideaItemComments.id, commentId))
    .returning();

  return result.length > 0;
};

export const getCommentCountByIdeaItem = async (
  ideaItemId: string
): Promise<number> => {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(ideaItemComments)
    .where(eq(ideaItemComments.ideaItemId, ideaItemId));

  return result?.count ?? 0;
};
