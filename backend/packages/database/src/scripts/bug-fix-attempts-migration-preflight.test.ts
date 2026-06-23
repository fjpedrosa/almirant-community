import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { PGlite } from "@electric-sql/pglite";
import {
  BUG_FIX_ATTEMPTS_CLUSTER_DUPLICATE_REASON,
  BUG_FIX_ATTEMPTS_FEEDBACK_DUPLICATE_REASON,
  BUG_FIX_ATTEMPTS_UNIQUENESS_MIGRATION_TAG,
  maybeRunBugFixAttemptPreflight,
} from "./bug-fix-attempts-migration-preflight";

const migration0168Sql = readFileSync(
  resolve(import.meta.dir, "../../migrations/0168_gray_lucky_pierre.sql"),
  "utf-8"
);

const migration0168Statements = migration0168Sql
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter(Boolean);

const databases: PGlite[] = [];

const createDatabase = async (): Promise<PGlite> => {
  const db = new PGlite();
  await db.waitReady;
  databases.push(db);
  return db;
};

const createBugFixAttemptsTable = async (db: PGlite) => {
  await db.query(`
    CREATE TABLE "bug_fix_attempts" (
      "id" text PRIMARY KEY,
      "feedback_item_id" text NOT NULL,
      "cluster_id" text,
      "status" text NOT NULL,
      "attempt_number" integer NOT NULL,
      "failure_reason" text,
      "failure_detected_by" varchar(20),
      "created_at" timestamp with time zone NOT NULL,
      "updated_at" timestamp with time zone NOT NULL
    );
  `);
};

const seedDuplicateAttempts = async (db: PGlite) => {
  await db.query(`
    INSERT INTO "bug_fix_attempts" (
      "id",
      "feedback_item_id",
      "cluster_id",
      "status",
      "attempt_number",
      "created_at",
      "updated_at"
    ) VALUES
      ('attempt-1', 'feedback-1', 'cluster-1', 'analyzing', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
      ('attempt-2', 'feedback-1', 'cluster-1', 'implementing', 1, '2026-01-02T00:00:00Z', '2026-01-03T00:00:00Z'),
      ('attempt-3', 'feedback-2', 'cluster-1', 'proposed', 1, '2026-01-04T00:00:00Z', '2026-01-04T00:00:00Z');
  `);
};

const applyMigration0168 = async (db: PGlite) => {
  for (const statement of migration0168Statements) {
    await db.query(statement);
  }
};

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()));
});

describe("bug-fix-attempts migration preflight", () => {
  it("fails to apply migration 0168 when duplicate active attempts already exist", async () => {
    const db = await createDatabase();
    await createBugFixAttemptsTable(db);
    await seedDuplicateAttempts(db);

    await expect(applyMigration0168(db)).rejects.toThrow(/unique index|duplicat/i);
  });

  it("normalizes bug_fix_attempts so migration 0168 can be applied safely", async () => {
    const db = await createDatabase();
    await createBugFixAttemptsTable(db);
    await seedDuplicateAttempts(db);

    const summary = await maybeRunBugFixAttemptPreflight({
      pendingMigrationTags: [BUG_FIX_ATTEMPTS_UNIQUENESS_MIGRATION_TAG],
      executeInTransaction: async (callback) => callback((statement) => db.query(statement)),
      log: () => undefined,
    });

    expect(summary).not.toBeNull();
    expect(summary).toMatchObject({
      attemptNumberIssueGroups: 1,
      feedbackActiveDuplicateGroups: 1,
      clusterActiveDuplicateGroups: 1,
      attemptNumbersRepaired: 1,
      feedbackActiveAttemptsFailed: 1,
      clusterActiveAttemptsFailed: 1,
      hadRelevantIssues: true,
    });

    await expect(applyMigration0168(db)).resolves.toBeUndefined();

    const { rows } = await db.query(`
      SELECT
        "id",
        "feedback_item_id" AS "feedbackItemId",
        "cluster_id" AS "clusterId",
        "status",
        "attempt_number" AS "attemptNumber",
        "failure_reason" AS "failureReason",
        "failure_detected_by" AS "failureDetectedBy"
      FROM "bug_fix_attempts"
      ORDER BY "feedback_item_id" ASC, "attempt_number" ASC;
    `);

    expect(rows).toHaveLength(3);

    expect(rows[0]).toMatchObject({
      id: "attempt-1",
      feedbackItemId: "feedback-1",
      clusterId: "cluster-1",
      status: "failed",
      attemptNumber: 1,
      failureReason: BUG_FIX_ATTEMPTS_FEEDBACK_DUPLICATE_REASON,
      failureDetectedBy: "system",
    });

    expect(rows[1]).toMatchObject({
      id: "attempt-2",
      feedbackItemId: "feedback-1",
      clusterId: "cluster-1",
      status: "implementing",
      attemptNumber: 2,
      failureReason: null,
      failureDetectedBy: null,
    });

    expect(rows[2]).toMatchObject({
      id: "attempt-3",
      feedbackItemId: "feedback-2",
      clusterId: "cluster-1",
      status: "failed",
      attemptNumber: 1,
      failureReason: BUG_FIX_ATTEMPTS_CLUSTER_DUPLICATE_REASON,
      failureDetectedBy: "system",
    });

    const { rows: perFeedback } = await db.query(`
      SELECT "feedback_item_id" AS "feedbackItemId", COUNT(*)::int AS "activeCount"
      FROM "bug_fix_attempts"
      WHERE "status" IN ('analyzing', 'proposed', 'implementing')
      GROUP BY "feedback_item_id"
      ORDER BY "feedback_item_id" ASC;
    `);

    expect(perFeedback).toEqual([{ feedbackItemId: "feedback-1", activeCount: 1 }]);

    const { rows: perCluster } = await db.query(`
      SELECT "cluster_id" AS "clusterId", COUNT(*)::int AS "activeCount"
      FROM "bug_fix_attempts"
      WHERE "cluster_id" IS NOT NULL
        AND "status" IN ('analyzing', 'proposed', 'implementing')
      GROUP BY "cluster_id";
    `);

    expect(perCluster).toEqual([{ clusterId: "cluster-1", activeCount: 1 }]);

    const { rows: indexes } = (await db.query(`
      SELECT "indexname"
      FROM pg_indexes
      WHERE "tablename" = 'bug_fix_attempts'
      ORDER BY "indexname" ASC;
    `)) as { rows: Array<{ indexname: string }> };

    expect(indexes.map((row) => row.indexname)).toEqual([
      "bug_fix_attempts_cluster_active_unique_idx",
      "bug_fix_attempts_feedback_active_unique_idx",
      "bug_fix_attempts_feedback_attempt_number_unique_idx",
      "bug_fix_attempts_pkey",
    ]);
  });

  it("skips the preflight when migration 0168 is pending but the table does not exist yet", async () => {
    const db = await createDatabase();

    const summary = await maybeRunBugFixAttemptPreflight({
      pendingMigrationTags: [BUG_FIX_ATTEMPTS_UNIQUENESS_MIGRATION_TAG],
      executeInTransaction: async (callback) => callback((statement) => db.query(statement)),
      log: () => undefined,
    });

    expect(summary).toBeNull();
  });

});
