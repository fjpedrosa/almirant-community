/**
 * Feedback Triage Service
 *
 * Groups similar feedback items into clusters using AI (OpenAI via LangChain).
 * Processes feedback in batches, creates/updates clusters, and links items.
 *
 * Used by: MC-328 (deduplication and clustering)
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { logger } from '@almirant/config';
import { isAiConfigured } from '../../ai/shared/services/ai-service';
import { getDefaultModel } from '../../ai/shared/services/model-factory';
import { localeToLanguageName } from '../../ai/shared/services/locale-utils';
import {
  db,
  feedbackItems,
  feedbackClusters,
  createFeedbackCluster,
  updateFeedbackCluster,
  batchAssignItemsToCluster,
  recalculateClusterItemCount,
  recalculateAllClusterCounts,
  getClusterItems,
  getFeedbackClusterById,
  transitionCluster,
  eq,
  and,
  inArray,
  isNull,
  getBugFixAttemptsByCluster,
  markAttemptAsFailed,
} from '@almirant/database';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_BATCH_SIZE = 50;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single cluster group as returned by the LLM */
interface AiClusterGroup {
  title: string;
  summary: string;
  feedbackItemIds: string[];
}

/** Expected JSON structure from the LLM response */
interface AiClusteringResponse {
  clusters: AiClusterGroup[];
  unclustered: string[];
}

/** Summary returned after a triage run */
export interface TriageResult {
  itemsProcessed: number;
  clustersCreated: number;
  clustersUpdated: number;
  itemsClustered: number;
  itemsUnclustered: number;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const buildClusteringPrompt = (locale: string = 'es'): string => {
  const langName = localeToLanguageName(locale);
  return `You are a feedback deduplication and clustering assistant.

You will receive a list of user feedback items, each with an id, title, and optional content.
Your job is to group items that describe the same problem, request, or topic into clusters.

Rules:
- Two items belong in the same cluster if they describe essentially the same issue, feature request, or topic, even if worded differently.
- Each cluster must have a short, descriptive "title" (max 100 chars) that captures the common theme.
- Each cluster must have a "summary" (1-3 sentences) explaining what the group is about.
- Each cluster's "title" and "summary" MUST be written in ${langName}.
- Items that are unique and do not match any other item should go into the "unclustered" array.
- A cluster must contain at least 2 items. Single items go to "unclustered".
- Do NOT invent feedback items. Only use the IDs provided.
- Return valid JSON only, no markdown fences, no explanation.

Output JSON schema:
{
  "clusters": [
    {
      "title": "string",
      "summary": "string",
      "feedbackItemIds": ["uuid", "uuid"]
    }
  ],
  "unclustered": ["uuid"]
}`;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Fetches feedback items with status "new" and no cluster assigned.
 * Uses db directly because the repository filter doesn't support IS NULL on clusterId.
 */
const fetchUnclusteredItems = async (): Promise<{ id: string; title: string; content: string | null }[]> => {
  const rows = await db
    .select({
      id: feedbackItems.id,
      title: feedbackItems.title,
      content: feedbackItems.content,
    })
    .from(feedbackItems)
    .where(
      and(
        eq(feedbackItems.status, 'new'),
        isNull(feedbackItems.clusterId)
      )
    )
    .orderBy(feedbackItems.createdAt);

  return rows;
};

/**
 * Splits an array into chunks of a given size.
 */
const chunk = <T>(array: T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
};

/**
 * Builds the user message containing the feedback items for the LLM.
 */
const buildUserMessage = (
  items: { id: string; title: string; content: string | null }[]
): string => {
  const lines = items.map((item, idx) => {
    const contentSnippet = item.content
      ? ` | Content: ${item.content.slice(0, 300)}`
      : '';
    return `${idx + 1}. [${item.id}] Title: ${item.title}${contentSnippet}`;
  });

  return `Here are ${items.length} feedback items to cluster:\n\n${lines.join('\n')}`;
};

/**
 * Calls the LLM to cluster a batch of feedback items.
 * Returns the parsed clustering response or null on failure.
 */
const clusterBatchWithAi = async (
  items: { id: string; title: string; content: string | null }[],
  model?: BaseChatModel,
  locale: string = 'es'
): Promise<AiClusteringResponse | null> => {
  const resolvedModel = model ?? getDefaultModel();
  const userMessage = buildUserMessage(items);

  const response = await resolvedModel.invoke([
    new SystemMessage(buildClusteringPrompt(locale)),
    new HumanMessage(userMessage),
  ]);

  const rawContent =
    typeof response.content === 'string'
      ? response.content
      : String(response.content);

  // Strip potential markdown code fences the LLM might add despite instructions
  const cleaned = rawContent
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as AiClusteringResponse;

    // Basic validation
    if (!Array.isArray(parsed.clusters)) {
      logger.warn({ raw: cleaned }, 'AI response missing clusters array');
      return null;
    }

    // Validate that every cluster has the required fields
    const validClusters = parsed.clusters.filter((c) => {
      const valid =
        typeof c.title === 'string' &&
        typeof c.summary === 'string' &&
        Array.isArray(c.feedbackItemIds) &&
        c.feedbackItemIds.length >= 2;
      if (!valid) {
        logger.warn({ cluster: c }, 'Skipping invalid cluster from AI response');
      }
      return valid;
    });

    return {
      clusters: validClusters,
      unclustered: Array.isArray(parsed.unclustered) ? parsed.unclustered : [],
    };
  } catch (err) {
    logger.error(
      { error: err, raw: cleaned.slice(0, 500) },
      'Failed to parse AI clustering response'
    );
    return null;
  }
};

/**
 * Finds an existing open cluster in the project with a matching title (case-insensitive).
 */
const findExistingCluster = async (
  title: string
): Promise<{ id: string; itemCount: number } | null> => {
  const normalizedTitle = title.trim().toLowerCase();

  // Since Drizzle doesn't have a simple case-insensitive equality, we query
  // all open clusters and filter in-app. For a manageable number of open
  // clusters this is efficient enough.
  const rows = await db
    .select({
      id: feedbackClusters.id,
      title: feedbackClusters.title,
      itemCount: feedbackClusters.itemCount,
    })
    .from(feedbackClusters)
    .where(
      eq(feedbackClusters.status, 'open')
    );

  const match = rows.find(
    (r) => r.title.trim().toLowerCase() === normalizedTitle
  );

  return match ? { id: match.id, itemCount: match.itemCount } : null;
};

/**
 * Detects regression: if a cluster has a merged bugFixAttempt and new bug feedback
 * arrives, marks the merged attempt as failed (automatic detection) AND transitions
 * the cluster from `resolved` to `regression` so the UI surfaces the regression.
 *
 * Regression transition is idempotent — if the cluster is not in `resolved` (e.g.
 * already `regression`, `investigating`, `fix_ready`), we skip the status change
 * because a human or an in-flight attempt is already handling it.
 *
 * We intentionally do NOT auto-launch a new investigation: product decision is
 * that a regression is a human-reviewed event.
 */
const detectRegressionInCluster = async (
  clusterId: string,
  itemIds: string[]
): Promise<void> => {
  if (itemIds.length === 0) return;

  // Check if any of the new items are bugs
  const newBugItems = await db
    .select({ id: feedbackItems.id, category: feedbackItems.category })
    .from(feedbackItems)
    .where(and(
      inArray(feedbackItems.id, itemIds),
      eq(feedbackItems.category, 'bug')
    ));

  if (newBugItems.length === 0) return;

  // Check if the cluster has any merged bug fix attempts
  const attempts = await getBugFixAttemptsByCluster(clusterId);
  const mergedAttempts = attempts.filter(a => a.status === 'merged');

  if (mergedAttempts.length === 0) return;

  const attemptsUpdated: { id: string; attemptNumber: number }[] = [];

  for (const attempt of mergedAttempts) {
    const updated = await markAttemptAsFailed(
      attempt.id,
      'Nuevo bug reportado en cluster tras merge del fix',
      'automatic'
    );
    if (updated) {
      attemptsUpdated.push({ id: updated.id, attemptNumber: updated.attemptNumber });
    }
    logger.info(
      { clusterId, attemptId: attempt.id, attemptNumber: attempt.attemptNumber },
      'Regression detected: merged bug fix attempt marked as failed'
    );
  }

  // Transition the cluster status so the regression is visible in the UI.
  // Only clusters currently in `resolved` are valid sources for this transition.
  // If the cluster is in `investigating`/`fix_ready` a fix is already in progress;
  // if it is already `regression` a previous detection handled it; in `dismissed`
  // or `promoted` the transition is terminal. We skip all non-`resolved` cases
  // explicitly to keep this helper idempotent on re-runs.
  const cluster = await getFeedbackClusterById(clusterId);
  if (!cluster) return;

  if (cluster.status !== 'resolved') {
    logger.info(
      { clusterId, currentStatus: cluster.status, newItemIds: itemIds },
      'Regression detected but cluster is not in resolved state — skipping status transition'
    );
    return;
  }

  const transition = await transitionCluster(clusterId, 'regression', {
    triggeredByKind: 'system',
    reason: 'new_bug_after_merge',
    metadata: {
      newItemIds: itemIds,
      previousAttemptIds: attemptsUpdated.map((a) => a.id),
    },
  });

  if (transition.success) {
    logger.info(
      {
        clusterId,
        fromStatus: transition.from,
        toStatus: transition.to,
        newItemIds: itemIds,
        previousAttemptIds: attemptsUpdated.map((a) => a.id),
      },
      'Cluster transitioned to regression after new bug report on merged fix'
    );
  } else {
    logger.warn(
      { clusterId, transition },
      'Failed to transition cluster to regression'
    );
  }
};

/**
 * Creates or updates a cluster and links the given feedback items to it.
 * Uses batch assignment for efficiency and recalculates the item count
 * from the database for re-execution consistency.
 *
 * Returns whether the cluster was newly created or updated.
 */
const upsertClusterAndLink = async (
  group: AiClusterGroup,
  validItemIds: Set<string>
): Promise<'created' | 'updated'> => {
  // Filter to only IDs that actually exist in our batch
  const itemIds = group.feedbackItemIds.filter((id) => validItemIds.has(id));
  if (itemIds.length === 0) return 'updated';

  const existing = await findExistingCluster(group.title);

  let clusterId: string;
  let action: 'created' | 'updated';

  if (existing) {
    // Update existing cluster summary (count will be recalculated below)
    await updateFeedbackCluster(existing.id, {
      summary: group.summary,
    });
    clusterId = existing.id;
    action = 'updated';
  } else {
    // Create new cluster (itemCount will be recalculated after linking)
    const cluster = await createFeedbackCluster({
      title: group.title.slice(0, 500),
      summary: group.summary,
      itemCount: 0,
    });
    clusterId = cluster.id;
    action = 'created';
  }

  // Batch-assign all items to the cluster and set status to "triaged"
  const updatedCount = await batchAssignItemsToCluster(itemIds, clusterId, 'triaged');

  // Recalculate the cluster's itemCount from the actual DB state.
  // This ensures consistency even on re-executions where some items
  // may already have been linked in a previous run.
  const actualCount = await recalculateClusterItemCount(clusterId);

  // Detect regression: if new bug items arrive in a cluster with a merged fix
  await detectRegressionInCluster(clusterId, itemIds);

  logger.info(
    {
      clusterId,
      title: group.title,
      action,
      itemsLinked: updatedCount,
      totalItemCount: actualCount,
    },
    action === 'created'
      ? 'Created new feedback cluster'
      : 'Updated existing feedback cluster'
  );

  return action;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Runs the feedback triage process for a given project.
 *
 * 1. Fetches all unprocessed (status=new, clusterId=null) feedback items.
 * 2. Sends them in batches to the LLM for clustering.
 * 3. Creates/updates clusters and links items.
 * 4. Returns a summary of what was processed.
 *
 * @throws Error if AI is not configured (missing OPENAI_API_KEY).
 */
export const triageFeedback = async (
  model?: BaseChatModel,
  locale: string = 'es'
): Promise<TriageResult> => {
  if (!model && !isAiConfigured()) {
    throw new Error(
      'AI is not configured. Set the OPENAI_API_KEY environment variable to enable feedback triage.'
    );
  }

  const allItems = await fetchUnclusteredItems();

  if (allItems.length === 0) {
    logger.info('No unclustered feedback items to triage');
    return {
      itemsProcessed: 0,
      clustersCreated: 0,
      clustersUpdated: 0,
      itemsClustered: 0,
      itemsUnclustered: 0,
    };
  }

  logger.info(
    { totalItems: allItems.length },
    'Starting feedback triage'
  );

  const batches = chunk(allItems, MAX_BATCH_SIZE);
  let totalClustersCreated = 0;
  let totalClustersUpdated = 0;
  let totalItemsClustered = 0;
  let totalItemsUnclustered = 0;

  for (const [batchIdx, batch] of batches.entries()) {
    logger.info(
      {
        batch: batchIdx + 1,
        totalBatches: batches.length,
        batchSize: batch.length,
      },
      'Processing feedback batch'
    );

    const result = await clusterBatchWithAi(batch, model, locale);

    if (!result) {
      logger.warn(
        { batch: batchIdx + 1 },
        'AI clustering failed for batch, skipping'
      );
      continue;
    }

    // Build a set of valid item IDs from this batch for safety
    const validItemIds = new Set(batch.map((item) => item.id));

    // Process each cluster group
    for (const group of result.clusters) {
      const action = await upsertClusterAndLink(group, validItemIds);
      if (action === 'created') {
        totalClustersCreated++;
      } else {
        totalClustersUpdated++;
      }

      const linkedCount = group.feedbackItemIds.filter((id) =>
        validItemIds.has(id)
      ).length;
      totalItemsClustered += linkedCount;
    }

    // Count unclustered items from this batch
    const unclusteredCount = result.unclustered.filter((id) =>
      validItemIds.has(id)
    ).length;
    totalItemsUnclustered += unclusteredCount;
  }

  const summary: TriageResult = {
    itemsProcessed: allItems.length,
    clustersCreated: totalClustersCreated,
    clustersUpdated: totalClustersUpdated,
    itemsClustered: totalItemsClustered,
    itemsUnclustered: totalItemsUnclustered,
  };

  // Final reconciliation: recalculate all cluster counts for the project.
  // This catches edge cases where items were manually moved between clusters
  // or clusters were affected by previous partial triage runs.
  await recalculateAllClusterCounts();

  logger.info({ ...summary }, 'Feedback triage completed');

  return summary;
};

/**
 * Regenerates a cluster's summary based on its current linked items.
 *
 * 1. Recalculates the `itemCount` from the database.
 * 2. If AI is configured, regenerates the summary text from the cluster's items.
 * 3. Returns the updated cluster or null if the cluster does not exist.
 *
 * Useful when items have been manually added/removed from a cluster.
 */
export const refreshClusterSummary = async (
  clusterId: string,
  model?: BaseChatModel,
  locale: string = 'es'
): Promise<{ itemCount: number; summary: string | null } | null> => {
  const cluster = await getFeedbackClusterById(clusterId);
  if (!cluster) return null;

  // 1. Recalculate actual count
  const actualCount = await recalculateClusterItemCount(clusterId);

  // 2. Regenerate summary if AI is available and items exist
  let newSummary: string | null = cluster.summary;

  if (isAiConfigured() && actualCount > 0) {
    const items = await getClusterItems(clusterId);

    if (items.length > 0) {
      const resolvedModel = model ?? getDefaultModel();

      const itemsList = items
        .map((item, idx) => {
          const contentSnippet = item.content
            ? ` | Content: ${item.content.slice(0, 200)}`
            : '';
          return `${idx + 1}. Title: ${item.title}${contentSnippet}`;
        })
        .join('\n');

      const langName = localeToLanguageName(locale);
      const response = await resolvedModel.invoke([
        new SystemMessage(
          `You are a feedback summarization assistant. Given a cluster title and its feedback items, write a concise 1-3 sentence summary in ${langName} that captures the common theme. Return only the summary text, no JSON, no markdown.`
        ),
        new HumanMessage(
          `Cluster title: "${cluster.title}"\n\nItems (${items.length}):\n${itemsList}`
        ),
      ]);

      const rawContent =
        typeof response.content === 'string'
          ? response.content
          : String(response.content);

      newSummary = rawContent.trim();

      await updateFeedbackCluster(clusterId, { summary: newSummary });

      logger.info(
        { clusterId, itemCount: actualCount },
        'Refreshed cluster summary via AI'
      );
    }
  } else if (actualCount === 0) {
    // No items left -- clear the summary
    newSummary = null;
    await updateFeedbackCluster(clusterId, { summary: null });

    logger.info({ clusterId }, 'Cleared cluster summary (no items)');
  }

  return { itemCount: actualCount, summary: newSummary };
};
