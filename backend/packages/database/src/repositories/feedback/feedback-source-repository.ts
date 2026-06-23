import { db } from "../../client";
import {
  feedbackSources,
} from "../../schema";
import { eq, and, desc, sql } from "drizzle-orm";
import type { FeedbackSource, NewFeedbackSource } from "../../schema";
import type { PaginationParams } from "../../domain/types";

export const getFeedbackSources = async (
  pagination: PaginationParams
): Promise<{ sources: FeedbackSource[]; total: number }> => {
  const [sourcesResult, countResult] = await Promise.all([
    db
      .select()
      .from(feedbackSources)
      .orderBy(desc(feedbackSources.createdAt))
      .limit(pagination.limit)
      .offset(pagination.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(feedbackSources),
  ]);

  return {
    sources: sourcesResult,
    total: countResult[0]?.count ?? 0,
  };
};

export const getFeedbackSourceById = async (
  id: string
): Promise<FeedbackSource | null> => {
  const [source] = await db
    .select()
    .from(feedbackSources)
    .where(eq(feedbackSources.id, id))
    .limit(1);

  return source ?? null;
};

export const getFeedbackSourceByPublicKey = async (
  publicKey: string
): Promise<FeedbackSource | null> => {
  const [source] = await db
    .select()
    .from(feedbackSources)
    .where(
      and(
        eq(feedbackSources.publicKey, publicKey),
        eq(feedbackSources.isActive, true)
      )
    )
    .limit(1);

  return source ?? null;
};

export const createFeedbackSource = async (
  data: Omit<NewFeedbackSource, "id" | "createdAt" | "updatedAt" | "publicKey"> & { publicKey?: string }
): Promise<FeedbackSource> => {
  const [newSource] = await db
    .insert(feedbackSources)
    .values({
      ...data,
      publicKey: data.publicKey || generatePublicKey(),
    })
    .returning();

  if (!newSource) throw new Error("Failed to create feedback source");
  return newSource;
};

export const updateFeedbackSource = async (
  id: string,
  data: Partial<Pick<NewFeedbackSource, "name" | "allowedDomains" | "isActive" | "config">>
): Promise<FeedbackSource | null> => {
  const [updated] = await db
    .update(feedbackSources)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(feedbackSources.id, id))
    .returning();

  return updated ?? null;
};

export const deleteFeedbackSource = async (id: string): Promise<boolean> => {
  const result = await db
    .delete(feedbackSources)
    .where(eq(feedbackSources.id, id))
    .returning({ id: feedbackSources.id });

  return result.length > 0;
};

export const rotateFeedbackSourcePublicKey = async (
  id: string
): Promise<FeedbackSource | null> => {
  const newKey = generatePublicKey();
  const [updated] = await db
    .update(feedbackSources)
    .set({ publicKey: newKey, updatedAt: new Date() })
    .where(eq(feedbackSources.id, id))
    .returning();

  return updated ?? null;
};

// Generate a random 32-char hex public key
const generatePublicKey = (): string => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};
