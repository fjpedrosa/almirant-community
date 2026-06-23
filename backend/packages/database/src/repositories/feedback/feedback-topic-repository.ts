import { db } from "../../client";
import {
  feedbackTopics,
  feedbackClusters,
  feedbackItems,
} from "../../schema";
import { eq, and, desc, sql, inArray, isNull, ilike, asc } from "drizzle-orm";
import type {
  FeedbackTopic,
  NewFeedbackTopic,
} from "../../schema";
import type { PaginationParams } from "../../domain/types";

// ── Helpers ──────────────────────────────────────────────

const toKebabCase = (str: string): string =>
  str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const generateSlug = (title: string, parentSlug?: string): string =>
  parentSlug ? `${parentSlug}/${toKebabCase(title)}` : toKebabCase(title);

/**
 * Compute cosine similarity between two numeric arrays.
 * Returns 0 when either vector has zero magnitude.
 */
const cosineSimilarity = (a: number[], b: number[]): number => {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dotProduct += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dotProduct / denominator;
};

// ── Filters ──────────────────────────────────────────────
//
// Feedback is mono-project by definition (the Almirant project). The
// per-project filter was dropped across topics, clusters, items and proposals.

export interface FeedbackTopicFilters {
  parentTopicId?: string | null; // null = root topics
  status?: string;
  search?: string;
}

// ── CRUD ─────────────────────────────────────────────────

export const createTopic = async (
  data: Omit<NewFeedbackTopic, "id" | "createdAt" | "updatedAt" | "slug"> & { slug?: string }
): Promise<FeedbackTopic> => {
  let parentSlug: string | undefined;

  if (data.parentTopicId) {
    const [parent] = await db
      .select({ slug: feedbackTopics.slug })
      .from(feedbackTopics)
      .where(eq(feedbackTopics.id, data.parentTopicId))
      .limit(1);
    parentSlug = parent?.slug;
  }

  const slug = data.slug ?? generateSlug(data.title, parentSlug);

  const [newTopic] = await db
    .insert(feedbackTopics)
    .values({ ...data, slug })
    .returning();

  if (!newTopic) throw new Error("Failed to create feedback topic");
  return newTopic;
};

export const getTopicById = async (
  id: string
): Promise<FeedbackTopic | null> => {
  const [topic] = await db
    .select()
    .from(feedbackTopics)
    .where(eq(feedbackTopics.id, id))
    .limit(1);

  return topic ?? null;
};

export const getTopicBySlug = async (
  slug: string
): Promise<FeedbackTopic | null> => {
  const [topic] = await db
    .select()
    .from(feedbackTopics)
    .where(eq(feedbackTopics.slug, slug))
    .limit(1);

  return topic ?? null;
};

export const listTopics = async (
  filters: FeedbackTopicFilters,
  pagination: PaginationParams
): Promise<{ items: FeedbackTopic[]; total: number }> => {
  const conditions = [];

  if (filters.parentTopicId === null) {
    conditions.push(isNull(feedbackTopics.parentTopicId));
  } else if (filters.parentTopicId !== undefined) {
    conditions.push(eq(feedbackTopics.parentTopicId, filters.parentTopicId));
  }

  if (filters.status) {
    conditions.push(
      eq(
        feedbackTopics.status,
        filters.status as (typeof feedbackTopics.status.enumValues)[number]
      )
    );
  }

  if (filters.search) {
    conditions.push(ilike(feedbackTopics.title, `%${filters.search}%`));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(feedbackTopics)
      .where(whereClause)
      .orderBy(desc(feedbackTopics.createdAt))
      .limit(pagination.limit)
      .offset(pagination.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(feedbackTopics)
      .where(whereClause),
  ]);

  return {
    items,
    total: countResult[0]?.count ?? 0,
  };
};

export const listChildren = async (
  parentTopicId: string
): Promise<FeedbackTopic[]> => {
  return db
    .select()
    .from(feedbackTopics)
    .where(eq(feedbackTopics.parentTopicId, parentTopicId))
    .orderBy(asc(feedbackTopics.title));
};

export const listRootTopics = async (): Promise<FeedbackTopic[]> => {
  return db
    .select()
    .from(feedbackTopics)
    .where(isNull(feedbackTopics.parentTopicId))
    .orderBy(asc(feedbackTopics.title));
};

export const updateTopic = async (
  id: string,
  data: Partial<
    Pick<
      NewFeedbackTopic,
      | "title"
      | "description"
      | "embedding"
      | "itemCount"
      | "clusterCount"
      | "status"
      | "mergedIntoTopicId"
      | "metadata"
      | "parentTopicId"
    >
  >
): Promise<FeedbackTopic | null> => {
  const [updated] = await db
    .update(feedbackTopics)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(feedbackTopics.id, id))
    .returning();

  return updated ?? null;
};

export const deleteTopic = async (id: string): Promise<boolean> => {
  const result = await db
    .delete(feedbackTopics)
    .where(eq(feedbackTopics.id, id))
    .returning({ id: feedbackTopics.id });

  return result.length > 0;
};

// ── Vector Search ────────────────────────────────────────

export interface FindSimilarTopicsParams {
  embedding: number[];
  limit?: number;
  minSimilarity?: number;
  parentScope?: string; // restrict to children of this parent
  excludeTopicId?: string;
}

export interface SimilarTopicResult {
  topic: FeedbackTopic;
  similarity: number;
}

/**
 * Find topics with similar embeddings using cosine similarity.
 *
 * Since pgvector may not be available, we fetch candidate topics from the
 * database and compute cosine similarity in the application layer. This is
 * acceptable for the expected topic count (<1000 total for Almirant feedback).
 */
export const findSimilarTopics = async (
  params: FindSimilarTopicsParams
): Promise<SimilarTopicResult[]> => {
  const {
    embedding,
    limit = 10,
    minSimilarity = 0.5,
    parentScope,
    excludeTopicId,
  } = params;

  const conditions = [
    eq(
      feedbackTopics.status,
      "active" as (typeof feedbackTopics.status.enumValues)[number]
    ),
    sql`${feedbackTopics.embedding} IS NOT NULL`,
  ];

  if (parentScope) {
    conditions.push(eq(feedbackTopics.parentTopicId, parentScope));
  }

  if (excludeTopicId) {
    conditions.push(sql`${feedbackTopics.id} != ${excludeTopicId}`);
  }

  const candidates = await db
    .select()
    .from(feedbackTopics)
    .where(and(...conditions));

  const results: SimilarTopicResult[] = [];

  for (const topic of candidates) {
    if (!topic.embedding) continue;

    let parsed: number[];
    try {
      parsed = JSON.parse(topic.embedding) as number[];
    } catch {
      continue;
    }

    if (parsed.length !== embedding.length) continue;

    const similarity = cosineSimilarity(embedding, parsed);
    if (similarity >= minSimilarity) {
      results.push({ topic, similarity });
    }
  }

  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, limit);
};

// ── Merge (atomic) ───────────────────────────────────────

/**
 * Merge a source topic into a target topic atomically.
 *
 * Steps within a single transaction:
 * 1. Move all clusters from source to target
 * 2. Move all items from source to target
 * 3. Recompute item_count and cluster_count for target
 * 4. Mark source as merged, set mergedIntoTopicId
 * 5. Move child topics of source to target
 */
export const mergeTopics = async (
  sourceTopicId: string,
  targetTopicId: string,
  opts: { mergedBy: string }
): Promise<{ source: FeedbackTopic; target: FeedbackTopic }> => {
  return db.transaction(async (tx) => {
    // 1. Move clusters from source to target
    await tx
      .update(feedbackClusters)
      .set({ topicId: targetTopicId, updatedAt: new Date() })
      .where(eq(feedbackClusters.topicId, sourceTopicId));

    // 2. Move items from source to target
    await tx
      .update(feedbackItems)
      .set({ topicId: targetTopicId, updatedAt: new Date() })
      .where(eq(feedbackItems.topicId, sourceTopicId));

    // 3. Recompute counts for target
    const [itemCountResult] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(feedbackItems)
      .where(eq(feedbackItems.topicId, targetTopicId));

    const [clusterCountResult] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(feedbackClusters)
      .where(eq(feedbackClusters.topicId, targetTopicId));

    const targetItemCount = itemCountResult?.count ?? 0;
    const targetClusterCount = clusterCountResult?.count ?? 0;

    // 4. Mark source as merged
    const [updatedSource] = await tx
      .update(feedbackTopics)
      .set({
        status: "merged",
        mergedIntoTopicId: targetTopicId,
        itemCount: 0,
        clusterCount: 0,
        metadata: {
          mergedBy: opts.mergedBy,
          mergedAt: new Date().toISOString(),
        },
        updatedAt: new Date(),
      })
      .where(eq(feedbackTopics.id, sourceTopicId))
      .returning();

    if (!updatedSource) throw new Error("Source topic not found");

    // 5. Move child topics of source to target
    await tx
      .update(feedbackTopics)
      .set({ parentTopicId: targetTopicId, updatedAt: new Date() })
      .where(eq(feedbackTopics.parentTopicId, sourceTopicId));

    // Update target counts
    const [updatedTarget] = await tx
      .update(feedbackTopics)
      .set({
        itemCount: targetItemCount,
        clusterCount: targetClusterCount,
        updatedAt: new Date(),
      })
      .where(eq(feedbackTopics.id, targetTopicId))
      .returning();

    if (!updatedTarget) throw new Error("Target topic not found");

    return { source: updatedSource, target: updatedTarget };
  });
};

// ── Split (atomic) ───────────────────────────────────────

export interface SplitProposal {
  title: string;
  clusterIds: string[];
}

/**
 * Split a topic by creating new child topics and reassigning clusters.
 *
 * Steps within a single transaction:
 * 1. For each proposal, create a new child topic under the parent
 * 2. Move the specified clusters to each new child
 * 3. Move items belonging to those clusters to the new child
 * 4. Recompute counts for parent and children
 */
export const splitTopic = async (
  topicId: string,
  proposals: SplitProposal[]
): Promise<FeedbackTopic[]> => {
  return db.transaction(async (tx) => {
    // Fetch parent topic for slug generation
    const [parentTopic] = await tx
      .select()
      .from(feedbackTopics)
      .where(eq(feedbackTopics.id, topicId))
      .limit(1);

    if (!parentTopic) throw new Error("Parent topic not found");

    const createdTopics: FeedbackTopic[] = [];

    for (const proposal of proposals) {
      const childSlug = generateSlug(proposal.title, parentTopic.slug);

      // 1. Create child topic
      const [childTopic] = await tx
        .insert(feedbackTopics)
        .values({
          parentTopicId: topicId,
          title: proposal.title,
          slug: childSlug,
          status: "active",
          createdBy: parentTopic.createdBy,
          itemCount: 0,
          clusterCount: 0,
        })
        .returning();

      if (!childTopic) throw new Error(`Failed to create child topic: ${proposal.title}`);

      if (proposal.clusterIds.length > 0) {
        // 2. Move clusters to child
        await tx
          .update(feedbackClusters)
          .set({ topicId: childTopic.id, updatedAt: new Date() })
          .where(inArray(feedbackClusters.id, proposal.clusterIds));

        // 3. Move items belonging to those clusters to the child
        await tx
          .update(feedbackItems)
          .set({ topicId: childTopic.id, updatedAt: new Date() })
          .where(inArray(feedbackItems.clusterId, proposal.clusterIds));

        // 4. Recompute counts for the child
        const [childItemCount] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(feedbackItems)
          .where(eq(feedbackItems.topicId, childTopic.id));

        const [childClusterCount] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(feedbackClusters)
          .where(eq(feedbackClusters.topicId, childTopic.id));

        const [updatedChild] = await tx
          .update(feedbackTopics)
          .set({
            itemCount: childItemCount?.count ?? 0,
            clusterCount: childClusterCount?.count ?? 0,
            updatedAt: new Date(),
          })
          .where(eq(feedbackTopics.id, childTopic.id))
          .returning();

        createdTopics.push(updatedChild ?? childTopic);
      } else {
        createdTopics.push(childTopic);
      }
    }

    // 4. Recompute counts for parent
    const [parentItemCount] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(feedbackItems)
      .where(eq(feedbackItems.topicId, topicId));

    const [parentClusterCount] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(feedbackClusters)
      .where(eq(feedbackClusters.topicId, topicId));

    await tx
      .update(feedbackTopics)
      .set({
        itemCount: parentItemCount?.count ?? 0,
        clusterCount: parentClusterCount?.count ?? 0,
        updatedAt: new Date(),
      })
      .where(eq(feedbackTopics.id, topicId));

    return createdTopics;
  });
};

// ── Reparent (with cycle detection) ──────────────────────

/**
 * Reparent a topic, preventing cycles by walking up the ancestor chain
 * from the new parent.
 *
 * Steps:
 * 1. If newParentId is not null, walk up from newParentId; if we find
 *    topicId in the chain, throw an error (cycle detected).
 * 2. Update parentTopicId.
 * 3. Regenerate slug based on new parent.
 * 4. Recursively update slugs of all descendants.
 */
export const reparentTopic = async (
  topicId: string,
  newParentId: string | null
): Promise<FeedbackTopic> => {
  return db.transaction(async (tx) => {
    // 1. Cycle detection
    if (newParentId !== null) {
      // Cannot reparent to self
      if (newParentId === topicId) {
        throw new Error("Cannot reparent a topic to itself");
      }

      let currentId: string | null = newParentId;
      const visited = new Set<string>();

      while (currentId !== null) {
        if (currentId === topicId) {
          throw new Error(
            "Cycle detected: the new parent is a descendant of the topic being moved"
          );
        }
        if (visited.has(currentId)) {
          // Safety: break out of unexpected loops in existing data
          break;
        }
        visited.add(currentId);

        const [ancestor] = await tx
          .select({ parentTopicId: feedbackTopics.parentTopicId })
          .from(feedbackTopics)
          .where(eq(feedbackTopics.id, currentId))
          .limit(1);

        currentId = ancestor?.parentTopicId ?? null;
      }
    }

    // Fetch the topic to get its current title
    const [topic] = await tx
      .select()
      .from(feedbackTopics)
      .where(eq(feedbackTopics.id, topicId))
      .limit(1);

    if (!topic) throw new Error("Topic not found");

    // 2. Determine new slug
    let newParentSlug: string | undefined;
    if (newParentId !== null) {
      const [newParent] = await tx
        .select({ slug: feedbackTopics.slug })
        .from(feedbackTopics)
        .where(eq(feedbackTopics.id, newParentId))
        .limit(1);
      newParentSlug = newParent?.slug;
    }

    const newSlug = generateSlug(topic.title, newParentSlug);
    const oldSlug = topic.slug;

    // 3. Update the topic
    const [updated] = await tx
      .update(feedbackTopics)
      .set({
        parentTopicId: newParentId,
        slug: newSlug,
        updatedAt: new Date(),
      })
      .where(eq(feedbackTopics.id, topicId))
      .returning();

    if (!updated) throw new Error("Failed to update topic");

    // 4. Recursively update slugs of all descendants
    // Use a prefix replacement: descendants whose slug starts with oldSlug + "/"
    // get their prefix replaced with newSlug + "/"
    if (oldSlug !== newSlug) {
      await tx.execute(
        sql`UPDATE feedback_topics
            SET slug = ${newSlug} || substr(slug, ${oldSlug.length + 1}),
                updated_at = now()
            WHERE slug LIKE ${oldSlug + "/%"}`
      );
    }

    return updated;
  });
};
