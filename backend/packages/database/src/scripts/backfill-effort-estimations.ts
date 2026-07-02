/**
 * Backfill: encola effort_estimation_requests para todos los work items existentes
 * cuyo type ∈ (task, story, feature, epic) y que no tengan ya un request
 * pending/processing/done.
 *
 * Ejecutar MANUALMENTE tras el primer deploy y antes de activar el feature flag
 * `effort-estimation-v1` para la primera organización.
 *
 * Run: DATABASE_URL=... bun run src/scripts/backfill-effort-estimations.ts
 */

import { inArray, sql } from "drizzle-orm";
import { db } from "../client";
import { workItems } from "../schema/work-items";
import { effortEstimationRequests } from "../schema/effort-estimation-requests";
import { computeWorkItemContentHash } from "../lib/content-hash";

const BATCH_SIZE = 500;
const ELIGIBLE_TYPES = ["task", "story", "feature", "epic"] as const;

const backfill = async () => {
  console.log("[backfill] Starting effort_estimation_requests backfill…");

  // Count total candidates: work items of eligible type that do NOT already
  // have a pending/processing/done request.
  const countRows = (await db.execute<{ count: string }>(sql`
    SELECT COUNT(*)::text AS count
    FROM work_items wi
    WHERE wi.type IN ('task','story','feature','epic')
      AND NOT EXISTS (
        SELECT 1 FROM effort_estimation_requests r
        WHERE r.work_item_id = wi.id
          AND r.status IN ('pending','processing','done')
      )
  `)) as unknown as Array<{ count: string }>;
  const total = parseInt(countRows[0]?.count ?? "0", 10);
  console.log(`[backfill] Found ${total} candidate work items`);

  if (total === 0) {
    console.log("[backfill] Nothing to do.");
    return;
  }

  let processed = 0;
  let lastId: string | null = null;

  type CandidateRow = {
    id: string;
    title: string;
    description: string | null;
    type: string;
    parent_id: string | null;
  };

  while (true) {
    // Keyset pagination by id to avoid re-processing in the face of inserts.
    const query = lastId
      ? sql`
          SELECT wi.id, wi.title, wi.description, wi.type, wi.parent_id
          FROM work_items wi
          WHERE wi.type IN ('task','story','feature','epic')
            AND NOT EXISTS (
              SELECT 1 FROM effort_estimation_requests r
              WHERE r.work_item_id = wi.id
                AND r.status IN ('pending','processing','done')
            )
            AND wi.id > ${lastId}
          ORDER BY wi.id ASC
          LIMIT ${BATCH_SIZE}
        `
      : sql`
          SELECT wi.id, wi.title, wi.description, wi.type, wi.parent_id
          FROM work_items wi
          WHERE wi.type IN ('task','story','feature','epic')
            AND NOT EXISTS (
              SELECT 1 FROM effort_estimation_requests r
              WHERE r.work_item_id = wi.id
                AND r.status IN ('pending','processing','done')
            )
          ORDER BY wi.id ASC
          LIMIT ${BATCH_SIZE}
        `;
    const rows = (await db.execute<CandidateRow>(query)) as unknown as CandidateRow[];

    if (rows.length === 0) break;

    const ids = rows.map((r) => r.id);
    // Pre-fetch all children ids for this batch in a single query.
    const childRows = await db
      .select({ id: workItems.id, parentId: workItems.parentId })
      .from(workItems)
      .where(inArray(workItems.parentId, ids));

    const childrenByParent = new Map<string, string[]>();
    for (const c of childRows) {
      if (!c.parentId) continue;
      const arr = childrenByParent.get(c.parentId) ?? [];
      arr.push(c.id);
      childrenByParent.set(c.parentId, arr);
    }

    const values = rows.map((row) => ({
      workItemId: row.id,
      requestedContentHash: computeWorkItemContentHash({
        title: row.title,
        description: row.description,
        type: row.type,
        parentId: row.parent_id,
        childIds: childrenByParent.get(row.id) ?? [],
      }),
      status: "pending" as const,
    }));

    await db
      .insert(effortEstimationRequests)
      .values(values)
      .onConflictDoNothing();

    processed += rows.length;
    lastId = rows[rows.length - 1]!.id;
    console.log(`[backfill] processed ${processed}/${total}`);
  }

  console.log(`[backfill] done (processed ${processed} work items)`);
};

backfill()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[backfill] failed:", err);
    process.exit(1);
  });
