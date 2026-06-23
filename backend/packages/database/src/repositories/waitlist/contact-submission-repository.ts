import { db } from "../../client";
import { contactSubmissions, type NewContactSubmission, type ContactSubmission } from "../../schema";
import { eq, desc, sql, and } from "drizzle-orm";

export const createContactSubmission = async (
  data: Omit<NewContactSubmission, "id" | "createdAt" | "updatedAt">
): Promise<ContactSubmission> => {
  const [submission] = await db
    .insert(contactSubmissions)
    .values(data)
    .returning();

  if (!submission) throw new Error("Failed to create contact submission");
  return submission;
};

export interface ContactSubmissionFilters {
  status?: string;
  email?: string;
}

export const getContactSubmissions = async (
  filters: ContactSubmissionFilters,
  pagination: { limit: number; offset: number }
): Promise<{ items: ContactSubmission[]; total: number }> => {
  const conditions = [];

  if (filters.status) {
    conditions.push(
      eq(contactSubmissions.status, filters.status as typeof contactSubmissions.status.enumValues[number])
    );
  }
  if (filters.email) {
    conditions.push(eq(contactSubmissions.email, filters.email));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(contactSubmissions)
      .where(whereClause)
      .orderBy(desc(contactSubmissions.createdAt))
      .limit(pagination.limit)
      .offset(pagination.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(contactSubmissions)
      .where(whereClause),
  ]);

  return {
    items,
    total: countResult[0]?.count ?? 0,
  };
};

export const getContactSubmissionById = async (
  id: string
): Promise<ContactSubmission | null> => {
  const [submission] = await db
    .select()
    .from(contactSubmissions)
    .where(eq(contactSubmissions.id, id))
    .limit(1);

  return submission ?? null;
};
