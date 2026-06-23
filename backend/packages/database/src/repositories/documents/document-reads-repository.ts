import { db } from "../../client";
import { documentReads } from "../../schema";
import { eq, and, inArray } from "drizzle-orm";

/**
 * Mark a document as read by a user.
 * Uses INSERT ON CONFLICT to make it idempotent - if the user already
 * read the document, just updates the readAt timestamp.
 */
export const markDocumentAsRead = async (
  userId: string,
  documentId: string
): Promise<void> => {
  await db
    .insert(documentReads)
    .values({ userId, documentId, readAt: new Date() })
    .onConflictDoUpdate({
      target: [documentReads.userId, documentReads.documentId],
      set: { readAt: new Date() },
    });
};

/**
 * Returns a Set of document IDs that the given user has read.
 * Efficient batch query - pass all document IDs at once, not N+1.
 */
export const getReadDocumentIds = async (
  userId: string,
  documentIds: string[]
): Promise<Set<string>> => {
  if (documentIds.length === 0) return new Set();

  const rows = await db
    .select({ documentId: documentReads.documentId })
    .from(documentReads)
    .where(
      and(
        eq(documentReads.userId, userId),
        inArray(documentReads.documentId, documentIds)
      )
    );

  return new Set(rows.map((r) => r.documentId));
};
