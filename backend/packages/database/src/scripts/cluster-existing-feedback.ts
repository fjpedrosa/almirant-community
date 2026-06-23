/**
 * One-off: cluster existing feedback_items that have embeddings but no cluster_id.
 *
 * Greedy agglomerative clustering by cosine similarity. Default threshold 0.65 —
 * laxer than the 0.75 used by the per-item feedback-triage skill, chosen for the
 * one-off historical backfill. Dry-run comparison on the 92-item backlog:
 *   0.55 -> 30 clusters incl. toxic super-cluster of 37 items.
 *   0.75 -> 86 clusters with no real grouping.
 *   0.65 -> 71 balanced clusters, max 7 items/cluster (chosen).
 *
 * Creates feedback_clusters, assigns items, then calls the OpenAI chat model
 * ONCE per final cluster to generate title + summary.
 *
 * Usage (from backend/packages/database):
 *   bun run --env-file .env.local src/scripts/cluster-existing-feedback.ts --dry-run
 *   bun run --env-file .env.local src/scripts/cluster-existing-feedback.ts
 *
 * Flags:
 *   --dry-run          Show proposed clusters, do not write anything
 *   --threshold=0.65   Cosine similarity threshold to join cluster (default 0.65)
 *   --model=gpt-4o-mini  OpenAI chat model for titles/summaries (default gpt-4o-mini)
 *
 * Idempotent against items already assigned: only processes rows where
 * cluster_id IS NULL AND embedding IS NOT NULL.
 */

import { db, closeConnections, sql } from "../client";
import { feedbackItems } from "../schema/feedback-items";
import { feedbackClusters } from "../schema/feedback-clusters";
import { and, isNull, isNotNull, eq, inArray } from "drizzle-orm";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");

const readFlag = (prefix: string, fallback: string): string => {
  const arg = args.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
};

const THRESHOLD = parseFloat(readFlag("--threshold=", "0.65"));
if (Number.isNaN(THRESHOLD) || THRESHOLD <= 0 || THRESHOLD >= 1) {
  console.error("Invalid --threshold, must be in (0,1)");
  process.exit(1);
}

const CHAT_MODEL = readFlag("--model=", process.env.OPENAI_MODEL ?? "gpt-4o-mini");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

// ---------------------------------------------------------------------------
// Vector helpers
// ---------------------------------------------------------------------------

const cosine = (a: number[], b: number[]): number => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
};

const addInPlace = (centroid: number[], v: number[]): void => {
  for (let i = 0; i < centroid.length; i++) centroid[i] += v[i];
};

const scale = (v: number[], factor: number): number[] => v.map((x) => x * factor);

const toVectorLiteral = (v: number[]): string => `[${v.join(",")}]`;

// Postgres can return pgvector as a string "[0.1, 0.2, ...]" or as a parsed array.
// Normalise to number[].
const parseEmbedding = (raw: unknown): number[] | null => {
  if (Array.isArray(raw)) return raw.map(Number);
  if (typeof raw === "string") {
    const trimmed = raw.trim().replace(/^\[|\]$/g, "");
    if (!trimmed) return null;
    return trimmed.split(",").map((n) => Number(n.trim()));
  }
  return null;
};

// ---------------------------------------------------------------------------
// OpenAI helpers
// ---------------------------------------------------------------------------

interface ChatResponse {
  choices: Array<{ message: { content: string } }>;
}

const callOpenAIChat = async (prompt: string): Promise<string> => {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");
  const response = await fetch(OPENAI_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages: [
        {
          role: "system",
          content:
            "Eres un analista de feedback de producto. Respondes SOLO con JSON valido, sin markdown ni texto adicional. Escribe en espanol.",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OpenAI chat ${response.status}: ${body}`);
  }
  const body = (await response.json()) as ChatResponse;
  return body.choices[0]?.message?.content ?? "{}";
};

interface ClusterLabel {
  title: string;
  summary: string;
}

const labelCluster = async (
  items: Array<{ title: string; content: string | null }>
): Promise<ClusterLabel> => {
  const sample = items
    .slice(0, 8)
    .map(
      (it, idx) =>
        `Item ${idx + 1}:\nTitulo: ${it.title}\nContenido: ${(it.content ?? "").slice(0, 500)}`
    )
    .join("\n\n");

  const prompt = `Analiza estos ${items.length} feedback items que pertenecen al mismo cluster (agrupados por similitud semantica). Genera un titulo conciso y un resumen del tema comun.

${sample}

Responde en JSON con esta forma exacta:
{
  "title": "string de maximo 80 caracteres, descriptivo",
  "summary": "string de maximo 240 caracteres, explicando el tema comun"
}`;

  const raw = await callOpenAIChat(prompt);
  try {
    const parsed = JSON.parse(raw) as ClusterLabel;
    return {
      title: (parsed.title ?? "Cluster sin nombre").slice(0, 80),
      summary: (parsed.summary ?? "").slice(0, 240),
    };
  } catch {
    return { title: items[0].title.slice(0, 80), summary: "" };
  }
};

// ---------------------------------------------------------------------------
// Clustering
// ---------------------------------------------------------------------------

interface ItemRow {
  id: string;
  title: string;
  content: string | null;
  embedding: number[];
}

interface Cluster {
  items: ItemRow[];
  centroid: number[];
}

const buildClusters = (items: ItemRow[]): Cluster[] => {
  const clusters: Cluster[] = [];
  for (const item of items) {
    let best: { idx: number; sim: number } | null = null;
    for (let i = 0; i < clusters.length; i++) {
      const sim = cosine(item.embedding, clusters[i].centroid);
      if (!best || sim > best.sim) best = { idx: i, sim };
    }
    if (best && best.sim >= THRESHOLD) {
      const c = clusters[best.idx];
      const n = c.items.length;
      // running centroid: (centroid * n + item) / (n + 1)
      const newCentroid = new Array(item.embedding.length);
      for (let i = 0; i < newCentroid.length; i++) {
        newCentroid[i] = (c.centroid[i] * n + item.embedding[i]) / (n + 1);
      }
      c.items.push(item);
      c.centroid = newCentroid;
    } else {
      clusters.push({ items: [item], centroid: [...item.embedding] });
    }
  }
  return clusters;
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = async () => {
  console.log("=== Cluster Existing Feedback ===");
  console.log(`  Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log(`  Similarity threshold: ${THRESHOLD}`);
  console.log(`  Chat model: ${CHAT_MODEL}`);
  console.log();

  // Step 1: load items
  console.log("Step 1: Loading feedback_items with embeddings and no cluster...");
  const rows = await db
    .select({
      id: feedbackItems.id,
      title: feedbackItems.title,
      content: feedbackItems.content,
      embedding: feedbackItems.embedding,
    })
    .from(feedbackItems)
    .where(and(isNull(feedbackItems.clusterId), isNotNull(feedbackItems.embedding)));

  const items: ItemRow[] = [];
  for (const r of rows) {
    const v = parseEmbedding(r.embedding as unknown);
    if (v && v.length === 1536) {
      items.push({
        id: r.id,
        title: r.title,
        content: r.content,
        embedding: v,
      });
    }
  }
  console.log(`  Loaded ${items.length} items (skipped ${rows.length - items.length} with invalid embeddings)`);

  if (items.length === 0) {
    console.log("Nothing to cluster. Exiting.");
    return;
  }

  // Step 2: cluster
  console.log("\nStep 2: Greedy clustering by cosine similarity...");
  const clusters = buildClusters(items);
  clusters.sort((a, b) => b.items.length - a.items.length);

  console.log(`  Produced ${clusters.length} clusters from ${items.length} items.`);
  console.log("  Top 10 by size:");
  clusters.slice(0, 10).forEach((c, i) => {
    console.log(`    #${i + 1}: ${c.items.length} items | head: "${c.items[0].title.slice(0, 60)}"`);
  });

  if (DRY_RUN) {
    console.log("\n=== Dry Run Summary ===");
    console.log(`  Would create ${clusters.length} clusters`);
    console.log(`  Would assign ${items.length} items`);
    console.log(`  Would make ${clusters.length} LLM calls for titles`);
    return;
  }

  if (!OPENAI_API_KEY) {
    console.error("\n[FATAL] OPENAI_API_KEY is not set. Cannot generate titles.");
    process.exit(1);
  }

  // Step 3: label each cluster via LLM
  console.log(`\nStep 3: Labeling ${clusters.length} clusters via ${CHAT_MODEL}...`);
  const labels: ClusterLabel[] = [];
  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i];
    process.stdout.write(`  [${i + 1}/${clusters.length}] ${c.items.length} items ... `);
    try {
      const label = await labelCluster(c.items);
      labels.push(label);
      console.log(`"${label.title}"`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`FAILED (${msg}) — using fallback title`);
      labels.push({ title: c.items[0].title.slice(0, 80), summary: "" });
    }
  }

  // Step 4: persist — transactionally per cluster
  console.log(`\nStep 4: Inserting clusters and assigning items...`);
  let persisted = 0;
  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i];
    const label = labels[i];
    try {
      await db.transaction(async (tx) => {
        // Feedback is mono-project by definition (the Almirant project), so
        // clusters no longer carry a `projectId` — the column was dropped.
        const inserted = await tx
          .insert(feedbackClusters)
          .values({
            title: label.title,
            summary: label.summary || null,
            itemCount: c.items.length,
            status: "open",
          })
          .returning({ id: feedbackClusters.id });

        const clusterId = inserted[0].id;
        const vectorLit = toVectorLiteral(c.centroid);
        await tx.execute(
          sql`UPDATE feedback_clusters SET embedding = ${vectorLit}::vector WHERE id = ${clusterId}`
        );
        await tx
          .update(feedbackItems)
          .set({ clusterId, updatedAt: new Date() })
          .where(inArray(feedbackItems.id, c.items.map((it) => it.id)));
      });
      persisted++;
    } catch (err) {
      console.error(
        `  [ERROR] Cluster #${i + 1} failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  console.log("\n=== Done ===");
  console.log(`  Clusters persisted: ${persisted}/${clusters.length}`);
  console.log(`  Items assigned: ${items.length}`);
};

main()
  .then(async () => {
    await closeConnections();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("\nScript failed:", err);
    await closeConnections();
    process.exit(1);
  });
