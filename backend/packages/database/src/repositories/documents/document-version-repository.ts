import { db } from "../../client";
import { documentVersions } from "../../schema";
import { eq, desc, sql } from "drizzle-orm";
import type { PaginationParams } from "../../domain/types";

export const createDocumentVersion = async (data: {
  documentId: string;
  contentHash: string;
  s3Key: string;
  commitSha?: string;
}) => {
  const [version] = await db
    .insert(documentVersions)
    .values({
      documentId: data.documentId,
      contentHash: data.contentHash,
      s3Key: data.s3Key,
      commitSha: data.commitSha || null,
    })
    .returning();

  if (!version) throw new Error("Failed to create document version");
  return version;
};

export const createVersion = createDocumentVersion;

export const getVersionsByDocumentId = async (
  documentId: string,
  pagination: PaginationParams | { limit: number; offset: number }
): Promise<{ items: Array<typeof documentVersions.$inferSelect>; total: number }> => {
  const limit = pagination.limit;
  const offset = pagination.offset;

  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.documentId, documentId))
      .orderBy(desc(documentVersions.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, documentId)),
  ]);

  return {
    items,
    total: countResult[0]?.count ?? 0,
  };
};

export const getVersionByHash = async (
  documentId: string,
  contentHash: string
) => {
  const [version] = await db
    .select()
    .from(documentVersions)
    .where(
      sql`${documentVersions.documentId} = ${documentId} AND ${documentVersions.contentHash} = ${contentHash}`
    )
    .limit(1);

  return version || null;
};

export const getLatestVersion = async (documentId: string) => {
  const [version] = await db
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.documentId, documentId))
    .orderBy(desc(documentVersions.createdAt))
    .limit(1);

  return version || null;
};

export const getVersions = getVersionsByDocumentId;
