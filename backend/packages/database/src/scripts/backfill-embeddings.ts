/**
 * Backfill script: Generate embeddings for existing feedback_items and feedback_clusters.
 *
 * Calls OpenAI embeddings API in batches and writes vectors back to the database.
 *
 * Usage:
 *   cd backend/packages/database
 *   bun run --env-file .env.local src/scripts/backfill-embeddings.ts
 *   bun run --env-file .env.local src/scripts/backfill-embeddings.ts --dry-run
 *   bun run --env-file .env.local src/scripts/backfill-embeddings.ts --force --batch-size=25
 *
 * Flags:
 *   --dry-run       Count items and report without calling API or updating DB
 *   --force         Re-embed items that already have an embedding
 *   --batch-size=N  Number of items per batch (default: 50)
 *
 * Idempotent: re-running without --force skips already-embedded items.
 */

import { db, closeConnections, sql } from "../client";
import { feedbackItems } from "../schema/feedback-items";
import { feedbackClusters } from "../schema/feedback-clusters";
import { isNull } from "drizzle-orm";

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const FORCE = args.includes("--force");
const BATCH_SIZE = (() => {
  const bsArg = args.find((a) => a.startsWith("--batch-size="));
  if (!bsArg) return 50;
  const parsed = parseInt(bsArg.split("=")[1], 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    console.error("Invalid --batch-size value. Must be a positive integer.");
    process.exit(1);
  }
  return parsed;
})();

// ---------------------------------------------------------------------------
// OpenAI embeddings (self-contained, no cross-package imports)
// ---------------------------------------------------------------------------

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1_000;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503]);
const MAX_TOKEN_CHARS = 8191 * 4; // approximate: 1 token ~ 4 chars
const INTER_BATCH_DELAY_MS = 1_000;

interface EmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
  usage: { prompt_tokens: number; total_tokens: number };
  model: string;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const sanitizeInput = (text: string): string => {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= MAX_TOKEN_CHARS) return trimmed;
  return trimmed.slice(0, MAX_TOKEN_CHARS);
};

const callOpenAIEmbeddings = async (
  inputs: string[]
): Promise<number[][]> => {
  if (!OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is not set. Set it in .env.local or the environment."
    );
  }

  const sanitized = inputs.map(sanitizeInput);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delayMs = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      console.log(
        `  [RETRY] Attempt ${attempt}/${MAX_RETRIES}, waiting ${delayMs}ms...`
      );
      await sleep(delayMs);
    }

    let response: Response;
    try {
      response = await fetch(OPENAI_EMBEDDINGS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: OPENAI_EMBEDDING_MODEL,
          input: sanitized,
        }),
      });
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.error(`  [ERROR] Network error: ${lastError.message}`);
      continue;
    }

    if (response.ok) {
      const body = (await response.json()) as EmbeddingResponse;
      const sorted = [...body.data].sort((a, b) => a.index - b.index);
      return sorted.map((item) => item.embedding);
    }

    if (!RETRYABLE_STATUS_CODES.has(response.status)) {
      let errorBody = "";
      try {
        errorBody = await response.text();
      } catch {
        // ignore
      }
      throw new Error(
        `OpenAI embeddings API error ${response.status}: ${errorBody}`
      );
    }

    let errorBody = "";
    try {
      errorBody = await response.text();
    } catch {
      // ignore
    }
    lastError = new Error(
      `OpenAI embeddings API error ${response.status}: ${errorBody}`
    );
    console.warn(
      `  [WARN] Retryable error ${response.status} on attempt ${attempt}`
    );
  }

  throw lastError ?? new Error("Embedding request failed after all retries");
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const formatEta = (remainingBatches: number, avgBatchMs: number): string => {
  const totalMs = remainingBatches * avgBatchMs;
  const totalSec = Math.ceil(totalMs / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}m ${seconds}s`;
};

const vectorToSqlString = (embedding: number[]): string =>
  `[${embedding.join(",")}]`;

// ---------------------------------------------------------------------------
// Batch processing
// ---------------------------------------------------------------------------

interface ItemRow {
  id: string;
  text: string;
}

const processBatches = async (
  tableName: string,
  items: ItemRow[],
  updateRow: (id: string, embedding: number[]) => Promise<void>
): Promise<{ processed: number; failed: number }> => {
  const totalBatches = Math.ceil(items.length / BATCH_SIZE);
  let processed = 0;
  let failed = 0;
  const batchTimesMs: number[] = [];

  for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
    const batchStart = Date.now();
    const start = batchIdx * BATCH_SIZE;
    const batch = items.slice(start, start + BATCH_SIZE);
    const remaining = items.length - processed;
    const avgBatchMs =
      batchTimesMs.length > 0
        ? batchTimesMs.reduce((a, b) => a + b, 0) / batchTimesMs.length +
          INTER_BATCH_DELAY_MS
        : INTER_BATCH_DELAY_MS + 2000; // rough estimate for first batch
    const remainingBatches = totalBatches - batchIdx;
    const eta = formatEta(remainingBatches, avgBatchMs);

    console.log(
      `  [${tableName}] Batch ${batchIdx + 1}/${totalBatches}: ` +
        `processing ${batch.length} items (${remaining} remaining, ETA ~${eta})`
    );

    try {
      const texts = batch.map((item) => item.text);
      const embeddings = await callOpenAIEmbeddings(texts);

      for (let i = 0; i < batch.length; i++) {
        try {
          await updateRow(batch[i].id, embeddings[i]);
        } catch (err) {
          failed++;
          console.error(
            `  [ERROR] Failed to update ${tableName} row ${batch[i].id}: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
      }

      processed += batch.length;
    } catch (err) {
      failed += batch.length;
      console.error(
        `  [ERROR] Batch ${batchIdx + 1} failed for ${tableName}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }

    batchTimesMs.push(Date.now() - batchStart);

    // Rate-limit: sleep between batches (except after the last one)
    if (batchIdx < totalBatches - 1) {
      await sleep(INTER_BATCH_DELAY_MS);
    }
  }

  return { processed, failed };
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = async () => {
  console.log("=== Backfill Embeddings Script ===");
  console.log(
    `  Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}` +
      `  Force: ${FORCE}` +
      `  Batch size: ${BATCH_SIZE}` +
      `  Model: ${OPENAI_EMBEDDING_MODEL}`
  );
  console.log();

  // ---------------------------------------------------------------
  // Step 1: Gather feedback items
  // ---------------------------------------------------------------
  console.log("Step 1: Querying feedback_items...");

  const embeddingCondition = FORCE ? undefined : isNull(feedbackItems.embedding);
  const feedbackItemRows = await db
    .select({
      id: feedbackItems.id,
      title: feedbackItems.title,
      content: feedbackItems.content,
    })
    .from(feedbackItems)
    .where(embeddingCondition ?? undefined);

  // Filter to only items with meaningful text for embedding
  const itemsToEmbed: ItemRow[] = feedbackItemRows
    .map((row) => ({
      id: row.id,
      text: [row.title, row.content].filter(Boolean).join("\n\n"),
    }))
    .filter((item) => item.text.trim().length > 0);

  console.log(
    `  Found ${feedbackItemRows.length} feedback_items` +
      `${FORCE ? " (including already-embedded)" : " without embeddings"}, ` +
      `${itemsToEmbed.length} with embeddable text`
  );

  // ---------------------------------------------------------------
  // Step 2: Gather feedback clusters
  // ---------------------------------------------------------------
  console.log("\nStep 2: Querying feedback_clusters...");

  const clusterCondition = FORCE
    ? undefined
    : isNull(feedbackClusters.embedding);
  const feedbackClusterRows = await db
    .select({
      id: feedbackClusters.id,
      title: feedbackClusters.title,
      summary: feedbackClusters.summary,
    })
    .from(feedbackClusters)
    .where(clusterCondition ?? undefined);

  const clustersToEmbed: ItemRow[] = feedbackClusterRows
    .map((row) => ({
      id: row.id,
      text: [row.title, row.summary].filter(Boolean).join("\n\n"),
    }))
    .filter((item) => item.text.trim().length > 0);

  console.log(
    `  Found ${feedbackClusterRows.length} feedback_clusters` +
      `${FORCE ? " (including already-embedded)" : " without embeddings"}, ` +
      `${clustersToEmbed.length} with embeddable text`
  );

  // ---------------------------------------------------------------
  // Dry run summary
  // ---------------------------------------------------------------
  if (DRY_RUN) {
    console.log("\n=== Dry Run Summary ===");
    console.log(`  feedback_items to embed: ${itemsToEmbed.length}`);
    console.log(`  feedback_clusters to embed: ${clustersToEmbed.length}`);
    console.log(`  Total API calls (batches): ${
      Math.ceil(itemsToEmbed.length / BATCH_SIZE) +
      Math.ceil(clustersToEmbed.length / BATCH_SIZE)
    }`);
    console.log("  No changes made.");
    return;
  }

  // ---------------------------------------------------------------
  // Validate API key before starting
  // ---------------------------------------------------------------
  if (!OPENAI_API_KEY) {
    console.error(
      "\n[FATAL] OPENAI_API_KEY is not set. Cannot generate embeddings."
    );
    process.exit(1);
  }

  // ---------------------------------------------------------------
  // Step 3: Process feedback items
  // ---------------------------------------------------------------
  let totalProcessed = 0;
  let totalFailed = 0;

  if (itemsToEmbed.length > 0) {
    console.log(
      `\nStep 3: Embedding ${itemsToEmbed.length} feedback_items...`
    );
    const result = await processBatches(
      "feedback_items",
      itemsToEmbed,
      async (id, embedding) => {
        await db.execute(
          sql`UPDATE feedback_items SET embedding = ${vectorToSqlString(embedding)}::vector, updated_at = now() WHERE id = ${id}`
        );
      }
    );
    totalProcessed += result.processed;
    totalFailed += result.failed;
    console.log(
      `  feedback_items done: ${result.processed} processed, ${result.failed} failed`
    );
  } else {
    console.log("\nStep 3: No feedback_items to embed. Skipping.");
  }

  // ---------------------------------------------------------------
  // Step 4: Process feedback clusters
  // ---------------------------------------------------------------
  if (clustersToEmbed.length > 0) {
    console.log(
      `\nStep 4: Embedding ${clustersToEmbed.length} feedback_clusters...`
    );
    const result = await processBatches(
      "feedback_clusters",
      clustersToEmbed,
      async (id, embedding) => {
        await db.execute(
          sql`UPDATE feedback_clusters SET embedding = ${vectorToSqlString(embedding)}::vector, updated_at = now() WHERE id = ${id}`
        );
      }
    );
    totalProcessed += result.processed;
    totalFailed += result.failed;
    console.log(
      `  feedback_clusters done: ${result.processed} processed, ${result.failed} failed`
    );
  } else {
    console.log("\nStep 4: No feedback_clusters to embed. Skipping.");
  }

  // ---------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------
  console.log("\n=== Backfill Complete ===");
  console.log(`  Total processed: ${totalProcessed}`);
  console.log(`  Total failed: ${totalFailed}`);

  if (totalFailed > 0) {
    console.warn(
      "  Some items failed. Re-run the script to retry (idempotent)."
    );
  }
};

main()
  .then(async () => {
    await closeConnections();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("\nBackfill failed:", err);
    await closeConnections();
    process.exit(1);
  });
