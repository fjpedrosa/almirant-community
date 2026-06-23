import { db, agentJobs } from "@almirant/database";
import { sql } from "drizzle-orm";

const now = new Date();
try {
  const result = await db.transaction(async (tx) => {
    const rows = await tx.execute(sql`
      WITH picked AS (
        SELECT id
        FROM agent_jobs
        WHERE status = 'queued'
          AND (available_at IS NULL OR available_at <= ${now})
        ORDER BY created_at ASC
        LIMIT ${1}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE agent_jobs
      SET status = 'running',
          worker_id = ${'test-worker'},
          available_at = NULL,
          started_at = COALESCE(started_at, ${now}),
          updated_at = ${now}
      WHERE id IN (SELECT id FROM picked)
      RETURNING *
    `);
    console.log("SUCCESS:", JSON.stringify(rows));
    return rows;
  });
} catch (err: any) {
  console.error("ERROR:", err.message);
  console.error("CAUSE:", err.cause?.message ?? err.cause);
}
process.exit(0);
