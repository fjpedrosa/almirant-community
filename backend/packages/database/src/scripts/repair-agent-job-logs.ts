/**
 * Repair drift where migration 0091 is recorded but public.agent_job_logs
 * is missing or incomplete in the target database.
 *
 * Safe to re-run: creates the table, foreign keys, and indexes only when absent.
 *
 * Usage:
 *   cd backend/packages/database
 *   bun run --env-file .env src/scripts/repair-agent-job-logs.ts
 */

import { closeConnections, db, sql } from "../client";

type BoolRow = { exists: boolean };
type CountRow = { count: number };

const MIGRATION_0091_HASH =
  "1f695fb39b4dc94e890a7fc27a295e2bea22e4c9bcd9e8fac162dc17da64ff81";

const getTableExists = async () => {
  const [row] = (await db.execute(sql`
    select exists (
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and table_name = 'agent_job_logs'
    ) as exists
  `)) as unknown as BoolRow[];

  return row?.exists === true;
};

const getIndexCount = async () => {
  const [row] = (await db.execute(sql`
    select count(*)::int as count
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'agent_job_logs'
      and indexname in (
        'agent_job_logs_job_seq_unique_idx',
        'agent_job_logs_job_timestamp_idx',
        'agent_job_logs_timestamp_idx',
        'agent_job_logs_work_item_idx'
      )
  `)) as unknown as CountRow[];

  return row?.count ?? 0;
};

const getConstraintCount = async () => {
  const [row] = (await db.execute(sql`
    select count(*)::int as count
    from pg_constraint
    where conname in (
      'agent_job_logs_job_id_agent_jobs_id_fk',
      'agent_job_logs_org_id_workspace_id_fk',
      'agent_job_logs_work_item_id_work_items_id_fk'
    )
  `)) as unknown as CountRow[];

  return row?.count ?? 0;
};

const main = async () => {
  console.log("=== Repair agent_job_logs drift ===\n");

  const [migrationRow] = (await db.execute(sql`
    select exists (
      select 1
      from drizzle.__drizzle_migrations
      where hash = ${MIGRATION_0091_HASH}
    ) as exists
  `)) as unknown as BoolRow[];

  console.log(
    `0091_fluffy_goliath recorded in drizzle.__drizzle_migrations: ${migrationRow?.exists === true ? "yes" : "no"}`
  );

  const tableExistsBefore = await getTableExists();
  const indexCountBefore = await getIndexCount();
  const constraintCountBefore = await getConstraintCount();

  console.log(`Table exists before repair: ${tableExistsBefore ? "yes" : "no"}`);
  console.log(`Indexes present before repair: ${indexCountBefore}/4`);
  console.log(`Constraints present before repair: ${constraintCountBefore}/3\n`);

  await db.execute(sql`
    create table if not exists public.agent_job_logs (
      id uuid primary key default gen_random_uuid() not null,
      job_id uuid not null,
      org_id text not null,
      work_item_id uuid,
      seq integer not null,
      level varchar(16) default 'info' not null,
      phase varchar(64) not null,
      event_type varchar(128) not null,
      message text not null,
      payload jsonb default '{}'::jsonb not null,
      timestamp timestamp with time zone not null,
      created_at timestamp with time zone default now() not null
    )
  `);

  await db.execute(sql`
    do $$
    begin
      if not exists (
        select 1 from pg_constraint
        where conname = 'agent_job_logs_job_id_agent_jobs_id_fk'
      ) then
        alter table public.agent_job_logs
          add constraint agent_job_logs_job_id_agent_jobs_id_fk
          foreign key (job_id) references public.agent_jobs(id)
          on delete cascade on update no action;
      end if;
    end $$;
  `);

  await db.execute(sql`
    do $$
    begin
      if not exists (
        select 1 from pg_constraint
        where conname = 'agent_job_logs_org_id_workspace_id_fk'
      ) then
        alter table public.agent_job_logs
          add constraint agent_job_logs_org_id_workspace_id_fk
          foreign key (org_id) references public.workspace(id)
          on delete cascade on update no action;
      end if;
    end $$;
  `);

  await db.execute(sql`
    do $$
    begin
      if not exists (
        select 1 from pg_constraint
        where conname = 'agent_job_logs_work_item_id_work_items_id_fk'
      ) then
        alter table public.agent_job_logs
          add constraint agent_job_logs_work_item_id_work_items_id_fk
          foreign key (work_item_id) references public.work_items(id)
          on delete set null on update no action;
      end if;
    end $$;
  `);

  await db.execute(sql`
    create unique index if not exists agent_job_logs_job_seq_unique_idx
      on public.agent_job_logs using btree (job_id, seq)
  `);

  await db.execute(sql`
    create index if not exists agent_job_logs_job_timestamp_idx
      on public.agent_job_logs using btree (job_id, timestamp)
  `);

  await db.execute(sql`
    create index if not exists agent_job_logs_timestamp_idx
      on public.agent_job_logs using btree (timestamp)
  `);

  await db.execute(sql`
    create index if not exists agent_job_logs_work_item_idx
      on public.agent_job_logs using btree (work_item_id)
  `);

  const tableExistsAfter = await getTableExists();
  const indexCountAfter = await getIndexCount();
  const constraintCountAfter = await getConstraintCount();

  console.log("Repair summary:");
  console.log(`  - table exists after repair: ${tableExistsAfter ? "yes" : "no"}`);
  console.log(`  - indexes present after repair: ${indexCountAfter}/4`);
  console.log(`  - constraints present after repair: ${constraintCountAfter}/3`);

  if (!tableExistsAfter || indexCountAfter < 4 || constraintCountAfter < 3) {
    console.error("\nRepair incomplete.");
    process.exitCode = 1;
    return;
  }

  console.log("\nRepair OK.");
};

main()
  .catch((error) => {
    console.error("\nRepair failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeConnections();
  });
