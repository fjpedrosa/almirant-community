import { db } from "../../client";
import { feedbackTopicProposals, feedbackTopics } from "../../schema";
import { eq, and, desc, sql } from "drizzle-orm";
import type {
  FeedbackTopicProposal,
  NewFeedbackTopicProposal,
} from "../../schema";
import type { PaginationParams } from "../../domain/types";

// ── Filters ──────────────────────────────────────────────
//
// Feedback is mono-project by definition (the Almirant project). The
// `projectId` filter was dropped because the table no longer carries it.

export interface FeedbackTopicProposalFilters {
  status?: string;
  type?: string;
  topicId?: string;
}

// ── Enriched type (includes topic title) ─────────────────

export interface FeedbackTopicProposalWithTopic extends FeedbackTopicProposal {
  topicTitle: string | null;
}

// ── CRUD ─────────────────────────────────────────────────

export const listProposals = async (
  filters: FeedbackTopicProposalFilters,
  pagination: PaginationParams
): Promise<{ items: FeedbackTopicProposalWithTopic[]; total: number }> => {
  const conditions = [];

  if (filters.status) {
    conditions.push(
      eq(
        feedbackTopicProposals.status,
        filters.status as (typeof feedbackTopicProposals.status.enumValues)[number]
      )
    );
  }

  if (filters.type) {
    conditions.push(
      eq(
        feedbackTopicProposals.type,
        filters.type as (typeof feedbackTopicProposals.type.enumValues)[number]
      )
    );
  }

  if (filters.topicId) {
    conditions.push(eq(feedbackTopicProposals.topicId, filters.topicId));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, countResult] = await Promise.all([
    db
      .select({
        proposal: feedbackTopicProposals,
        topicTitle: feedbackTopics.title,
      })
      .from(feedbackTopicProposals)
      .leftJoin(
        feedbackTopics,
        eq(feedbackTopicProposals.topicId, feedbackTopics.id)
      )
      .where(whereClause)
      .orderBy(desc(feedbackTopicProposals.createdAt))
      .limit(pagination.limit)
      .offset(pagination.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(feedbackTopicProposals)
      .where(whereClause),
  ]);

  const items: FeedbackTopicProposalWithTopic[] = rows.map((row) => ({
    ...row.proposal,
    topicTitle: row.topicTitle,
  }));

  return {
    items,
    total: countResult[0]?.count ?? 0,
  };
};

export const getProposalById = async (
  id: string
): Promise<FeedbackTopicProposalWithTopic | null> => {
  const [row] = await db
    .select({
      proposal: feedbackTopicProposals,
      topicTitle: feedbackTopics.title,
    })
    .from(feedbackTopicProposals)
    .leftJoin(
      feedbackTopics,
      eq(feedbackTopicProposals.topicId, feedbackTopics.id)
    )
    .where(eq(feedbackTopicProposals.id, id))
    .limit(1);

  if (!row) return null;

  return {
    ...row.proposal,
    topicTitle: row.topicTitle,
  };
};

export const createProposal = async (
  data: Omit<NewFeedbackTopicProposal, "id" | "createdAt" | "updatedAt">
): Promise<FeedbackTopicProposal> => {
  const [created] = await db
    .insert(feedbackTopicProposals)
    .values(data)
    .returning();

  if (!created) throw new Error("Failed to create feedback topic proposal");
  return created;
};

export const updateProposalStatus = async (
  id: string,
  status: (typeof feedbackTopicProposals.status.enumValues)[number],
  reviewedBy?: string,
  reviewerNotes?: string
): Promise<FeedbackTopicProposal | null> => {
  const [updated] = await db
    .update(feedbackTopicProposals)
    .set({
      status,
      reviewedAt: new Date(),
      reviewedBy: reviewedBy ?? null,
      reviewerNotes: reviewerNotes ?? null,
      updatedAt: new Date(),
    })
    .where(eq(feedbackTopicProposals.id, id))
    .returning();

  return updated ?? null;
};
