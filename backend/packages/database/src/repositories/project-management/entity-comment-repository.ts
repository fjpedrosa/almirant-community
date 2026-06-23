import { db } from "../../client";
import { entityComments, commentVersions, user } from "../../schema";
import { and, desc, eq, sql } from "drizzle-orm";
import type { EntityType } from "./entity-event-repository";

export interface EntityCommentWithUser {
  id: string;
  entityType: string;
  entityId: string;
  userId: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  userName: string | null;
  userEmail: string | null;
  userImage: string | null;
}

export interface EntityCommentVersionWithEditor {
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

export const getEntityComments = async (
  entityType: EntityType,
  entityId: string
): Promise<EntityCommentWithUser[]> => {
  const results = await db
    .select({
      id: entityComments.id,
      entityType: entityComments.entityType,
      entityId: entityComments.entityId,
      userId: entityComments.userId,
      content: entityComments.content,
      createdAt: entityComments.createdAt,
      updatedAt: entityComments.updatedAt,
      userName: user.name,
      userEmail: user.email,
      userImage: user.image,
    })
    .from(entityComments)
    .innerJoin(user, eq(entityComments.userId, user.id))
    .where(
      and(
        eq(entityComments.entityType, entityType),
        eq(entityComments.entityId, entityId)
      )
    )
    .orderBy(desc(entityComments.createdAt));

  return results as EntityCommentWithUser[];
};

export interface LastCommentInfo {
  userName: string | null;
  userImage: string | null;
  createdAt: Date;
}

export const getLastEntityComment = async (
  entityType: EntityType,
  entityId: string
): Promise<LastCommentInfo | null> => {
  const [result] = await db
    .select({
      userName: user.name,
      userImage: user.image,
      createdAt: entityComments.createdAt,
    })
    .from(entityComments)
    .innerJoin(user, eq(entityComments.userId, user.id))
    .where(
      and(
        eq(entityComments.entityType, entityType),
        eq(entityComments.entityId, entityId)
      )
    )
    .orderBy(desc(entityComments.createdAt))
    .limit(1);

  return result ?? null;
};

export const getEntityCommentCount = async (
  entityType: EntityType,
  entityId: string
): Promise<number> => {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(entityComments)
    .where(
      and(
        eq(entityComments.entityType, entityType),
        eq(entityComments.entityId, entityId)
      )
    );

  return result?.count ?? 0;
};

export const createEntityComment = async (
  entityType: EntityType,
  entityId: string,
  userId: string,
  content: string
): Promise<EntityCommentWithUser> => {
  const [inserted] = await db
    .insert(entityComments)
    .values({
      entityType,
      entityId,
      userId,
      content,
    })
    .returning();

  if (!inserted) {
    throw new Error("FAILED_TO_CREATE_COMMENT");
  }

  const [hydrated] = await db
    .select({
      id: entityComments.id,
      entityType: entityComments.entityType,
      entityId: entityComments.entityId,
      userId: entityComments.userId,
      content: entityComments.content,
      createdAt: entityComments.createdAt,
      updatedAt: entityComments.updatedAt,
      userName: user.name,
      userEmail: user.email,
      userImage: user.image,
    })
    .from(entityComments)
    .innerJoin(user, eq(entityComments.userId, user.id))
    .where(eq(entityComments.id, inserted.id))
    .limit(1);

  return hydrated as EntityCommentWithUser;
};

export const updateEntityComment = async (
  entityType: EntityType,
  entityId: string,
  commentId: string,
  userId: string,
  content: string
): Promise<EntityCommentWithUser | null> => {
  const [existing] = await db
    .select()
    .from(entityComments)
    .where(
      and(
        eq(entityComments.id, commentId),
        eq(entityComments.entityType, entityType),
        eq(entityComments.entityId, entityId)
      )
    )
    .limit(1);

  if (!existing) return null;

  if (existing.userId !== userId) {
    throw new Error("COMMENT_NOT_OWNED");
  }

  // Save previous version before updating
  await db.insert(commentVersions).values({
    commentId: existing.id,
    entityType,
    content: existing.content,
    editedByUserId: userId,
  });

  await db
    .update(entityComments)
    .set({ content, updatedAt: new Date() })
    .where(eq(entityComments.id, commentId));

  const [hydrated] = await db
    .select({
      id: entityComments.id,
      entityType: entityComments.entityType,
      entityId: entityComments.entityId,
      userId: entityComments.userId,
      content: entityComments.content,
      createdAt: entityComments.createdAt,
      updatedAt: entityComments.updatedAt,
      userName: user.name,
      userEmail: user.email,
      userImage: user.image,
    })
    .from(entityComments)
    .innerJoin(user, eq(entityComments.userId, user.id))
    .where(eq(entityComments.id, commentId))
    .limit(1);

  return hydrated as EntityCommentWithUser;
};

export const deleteEntityComment = async (
  entityType: EntityType,
  entityId: string,
  commentId: string,
  userId: string
): Promise<boolean> => {
  const [existing] = await db
    .select()
    .from(entityComments)
    .where(
      and(
        eq(entityComments.id, commentId),
        eq(entityComments.entityType, entityType),
        eq(entityComments.entityId, entityId)
      )
    )
    .limit(1);

  if (!existing) return false;

  if (existing.userId !== userId) {
    throw new Error("COMMENT_NOT_OWNED");
  }

  const deleted = await db
    .delete(entityComments)
    .where(eq(entityComments.id, commentId))
    .returning({ id: entityComments.id });

  return deleted.length > 0;
};

export const getEntityCommentVersions = async (
  entityType: EntityType,
  entityId: string,
  commentId: string
): Promise<EntityCommentVersionWithEditor[]> => {
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
    .innerJoin(entityComments, eq(commentVersions.commentId, entityComments.id))
    .innerJoin(user, eq(commentVersions.editedByUserId, user.id))
    .where(
      and(
        eq(commentVersions.commentId, commentId),
        eq(commentVersions.entityType, entityType),
        eq(entityComments.entityType, entityType),
        eq(entityComments.entityId, entityId)
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
