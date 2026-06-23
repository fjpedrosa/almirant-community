/**
 * Post-migration script: Update entity_type from 'idea' to 'seed' for migrated seeds.
 *
 * This script must run AFTER drizzle migrations are applied because:
 * - Drizzle wraps all pending migrations in a single transaction
 * - PostgreSQL forbids using new enum values (ALTER TYPE ADD VALUE) in DML
 *   within the same transaction where the value was added
 * - The 'seed' enum value is added in migration 0084, but can only be used
 *   in UPDATE statements after that transaction commits
 *
 * Idempotent: only updates rows that still have entity_type = 'idea' and
 * whose entity_id exists in the seeds table.
 *
 * Usage:
 *   cd backend/packages/database
 *   bun run src/scripts/migrate-seed-entity-types.ts
 */

import { db, sql, closeConnections } from "../client";

const main = async () => {
  console.log("Starting seed entity_type migration...\n");

  // Update entity_comments: change entity_type from 'idea' to 'seed'
  // for entities that now exist in the seeds table
  const commentsResult = await db.execute(sql`
    UPDATE "entity_comments"
    SET "entity_type" = 'seed'
    WHERE "entity_type" = 'idea'
      AND "entity_id" IN (SELECT "id" FROM "seeds")
  `);
  console.log(`Updated entity_comments: ${commentsResult.length ?? 0} rows`);

  // Update entity_events: change entity_type from 'idea' to 'seed'
  const eventsResult = await db.execute(sql`
    UPDATE "entity_events"
    SET "entity_type" = 'seed'
    WHERE "entity_type" = 'idea'
      AND "entity_id" IN (SELECT "id" FROM "seeds")
  `);
  console.log(`Updated entity_events: ${eventsResult.length ?? 0} rows`);

  console.log("\nSeed entity_type migration complete!");
  await closeConnections();
};

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
