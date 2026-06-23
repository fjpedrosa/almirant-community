/**
 * Verify database schema and runtime signals for worker timeout handling.
 *
 * Checks:
 * 1) Enum values for worker_interaction_status and agent_job_status
 * 2) Column enum bindings for worker_interactions.status and agent_jobs.status
 * 3) Presence of timeout index worker_interactions_expires_pending_idx
 * 4) Runtime counters related to BUN-1 / BUN-2 symptom patterns
 *
 * Usage:
 *   cd backend/packages/database
 *   bun run --env-file .env.local src/scripts/verify-worker-timeout-schema.ts
 */

import { closeConnections, db, sql } from "../client";

type EnumRow = {
  enum_name: string;
  value: string;
  sort_order: number;
};

type ColumnRow = {
  table_name: string;
  column_name: string;
  udt_name: string;
};

type IndexRow = {
  indexname: string;
  indexdef: string;
};

type HealthRow = {
  expired_pending: number;
  timed_out_total: number;
  running_without_worker: number;
  waiting_without_worker: number;
};

const EXPECTED_ENUMS: Record<string, string[]> = {
  worker_interaction_status: ["pending", "answered", "timed_out", "cancelled"],
  agent_job_status: [
    "queued",
    "running",
    "finalizing",
    "completed",
    "incomplete",
    "failed",
    "cancelled",
    "waiting_for_input",
  ],
};

const main = async () => {
  console.log("=== Verify Worker Timeout Schema ===\n");

  const enumRows = (await db.execute(sql`
    select
      t.typname as enum_name,
      e.enumlabel as value,
      e.enumsortorder as sort_order
    from pg_type t
    inner join pg_enum e on e.enumtypid = t.oid
    where t.typname in ('worker_interaction_status', 'agent_job_status')
    order by t.typname, e.enumsortorder
  `)) as unknown as EnumRow[];

  const enumMap = new Map<string, string[]>();
  for (const row of enumRows) {
    const current = enumMap.get(row.enum_name) ?? [];
    current.push(row.value);
    enumMap.set(row.enum_name, current);
  }

  console.log("Enum values:");
  for (const enumName of Object.keys(EXPECTED_ENUMS)) {
    const values = enumMap.get(enumName) ?? [];
    console.log(`  - ${enumName}: [${values.join(", ")}]`);
  }
  console.log();

  const missingEnumValues: string[] = [];
  for (const [enumName, expectedValues] of Object.entries(EXPECTED_ENUMS)) {
    const actualValues = enumMap.get(enumName) ?? [];
    for (const expectedValue of expectedValues) {
      if (!actualValues.includes(expectedValue)) {
        missingEnumValues.push(`${enumName}.${expectedValue}`);
      }
    }
  }

  const columnRows = (await db.execute(sql`
    select
      c.table_name,
      c.column_name,
      c.udt_name
    from information_schema.columns c
    where (c.table_name = 'worker_interactions' and c.column_name = 'status')
       or (c.table_name = 'agent_jobs' and c.column_name = 'status')
    order by c.table_name
  `)) as unknown as ColumnRow[];

  console.log("Status column bindings:");
  for (const row of columnRows) {
    console.log(`  - ${row.table_name}.${row.column_name} -> ${row.udt_name}`);
  }
  console.log();

  const workerStatusBindingOk = columnRows.some(
    (row) =>
      row.table_name === "worker_interactions" &&
      row.column_name === "status" &&
      row.udt_name === "worker_interaction_status"
  );
  const agentStatusBindingOk = columnRows.some(
    (row) =>
      row.table_name === "agent_jobs" &&
      row.column_name === "status" &&
      row.udt_name === "agent_job_status"
  );

  const indexRows = (await db.execute(sql`
    select indexname, indexdef
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'worker_interactions'
      and indexname = 'worker_interactions_expires_pending_idx'
  `)) as unknown as IndexRow[];

  console.log("Timeout index:");
  if (indexRows.length > 0) {
    console.log(`  - OK: ${indexRows[0].indexname}`);
  } else {
    console.log("  - MISSING: worker_interactions_expires_pending_idx");
  }
  console.log();

  const [health] = (await db.execute(sql`
    select
      (
        select count(*)::int
        from worker_interactions
        where status = 'pending'
          and expires_at < now()
      ) as expired_pending,
      (
        select count(*)::int
        from worker_interactions
        where status = 'timed_out'
      ) as timed_out_total,
      (
        select count(*)::int
        from agent_jobs
        where status = 'running'
          and worker_id is null
      ) as running_without_worker,
      (
        select count(*)::int
        from agent_jobs
        where status = 'waiting_for_input'
          and worker_id is null
      ) as waiting_without_worker
  `)) as unknown as HealthRow[];

  console.log("Runtime counters:");
  console.log(`  - expired pending interactions: ${health.expired_pending}`);
  console.log(`  - timed_out interactions total: ${health.timed_out_total}`);
  console.log(`  - running jobs without worker: ${health.running_without_worker}`);
  console.log(
    `  - waiting_for_input jobs without worker: ${health.waiting_without_worker}`
  );
  console.log();

  const failures: string[] = [];
  if (missingEnumValues.length > 0) {
    failures.push(`Missing enum values: ${missingEnumValues.join(", ")}`);
  }
  if (!workerStatusBindingOk) {
    failures.push(
      "Column binding mismatch: worker_interactions.status is not worker_interaction_status"
    );
  }
  if (!agentStatusBindingOk) {
    failures.push("Column binding mismatch: agent_jobs.status is not agent_job_status");
  }
  if (indexRows.length === 0) {
    failures.push("Missing index: worker_interactions_expires_pending_idx");
  }

  if (failures.length > 0) {
    console.error("Verification FAILED:");
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("Verification OK.");
};

main()
  .catch((error) => {
    console.error("Verification failed with error:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeConnections();
  });
