import { db } from "../src/client";
import { sql } from "drizzle-orm";

async function backfill() {
  console.log(
    "Backfilling usage_records.user_id from agent_jobs.created_by_user_id..."
  );

  const result = await db.execute(sql`
    UPDATE usage_records
    SET user_id = aj.created_by_user_id
    FROM agent_jobs aj
    WHERE usage_records.job_id = aj.id
      AND usage_records.user_id IS NULL
      AND aj.created_by_user_id IS NOT NULL
  `);

  console.log("Backfill complete:", result.rowCount, "rows updated");
}

backfill()
  .catch(console.error)
  .finally(() => process.exit(0));
