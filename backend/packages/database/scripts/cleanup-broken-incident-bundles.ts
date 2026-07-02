/**
 * One-shot cleanup: delete incident_bundles rows with workspace_id IS NULL.
 *
 * These rows were created by a bug in the debug pipeline and HTTP handlers that
 * persisted bundles without owner attribution. They cannot be re-attributed and
 * must be removed before deploying the hardened repository functions.
 *
 * Run ONCE, manually, before deploying PR A:
 *   bun run backend/packages/database/scripts/cleanup-broken-incident-bundles.ts
 *
 * A JSON log of deleted IDs is written to:
 *   backend/packages/database/scripts/cleanup-broken-incident-bundles.log.json
 */

import { db } from "../src/client";
import { incidentBundles } from "../src/schema";
import { isNull } from "drizzle-orm";
import { writeFileSync } from "fs";
import { join } from "path";

const main = async () => {
  console.log("[cleanup] Starting cleanup of incident_bundles with workspace_id IS NULL...");

  // First: count and collect the rows to be deleted
  const toDelete = await db
    .select({ id: incidentBundles.id, createdAt: incidentBundles.createdAt })
    .from(incidentBundles)
    .where(isNull(incidentBundles.workspaceId));

  if (toDelete.length === 0) {
    console.log("[cleanup] No rows with workspace_id IS NULL found. Nothing to delete.");
    return;
  }

  console.log(`[cleanup] Found ${toDelete.length} row(s) with workspace_id IS NULL.`);

  // Delete
  const deleted = await db
    .delete(incidentBundles)
    .where(isNull(incidentBundles.workspaceId))
    .returning({ id: incidentBundles.id });

  const logEntry = {
    executedAt: new Date().toISOString(),
    deletedCount: deleted.length,
    deletedIds: deleted.map((r) => r.id),
  };

  const logPath = join(import.meta.dir, "cleanup-broken-incident-bundles.log.json");
  writeFileSync(logPath, JSON.stringify(logEntry, null, 2), "utf-8");

  console.log(`[cleanup] Deleted ${deleted.length} row(s).`);
  console.log(`[cleanup] Log written to: ${logPath}`);
};

main().catch((err) => {
  console.error("[cleanup] Fatal error:", err);
  process.exit(1);
});
