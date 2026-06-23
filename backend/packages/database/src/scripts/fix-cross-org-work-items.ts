/**
 * Repair inconsistent work items where:
 *   project.organization_id != board.organization_id
 *
 * Strategy:
 * 1) Detect mismatched rows.
 * 2) Move each item to a board in the project's organization with the same area.
 * 3) For leaf items (task/idea), map destination column by role.
 * 4) Leave parent items (epic/feature/story) with board_column_id = NULL.
 *
 * Usage:
 *   cd backend/packages/database
 *   bun run src/scripts/fix-cross-org-work-items.ts
 */

import { db, closeConnections } from "../client";
import { sql } from "drizzle-orm";

const main = async () => {
  console.log("=== Fix Cross-Org Work Items ===\n");

  const mismatchedBefore = await db.execute(sql`
    select
      wi.id,
      wi.task_id,
      wi.type,
      wi.project_id,
      p.organization_id as project_org_id,
      wi.board_id,
      b.organization_id as board_org_id,
      b.area
    from work_items wi
    inner join projects p on p.id = wi.project_id
    inner join boards b on b.id = wi.board_id
    where p.organization_id <> b.organization_id
    order by wi.task_id nulls last, wi.id
  `);

  console.log(`Mismatched rows before fix: ${mismatchedBefore.length}`);
  if (mismatchedBefore.length === 0) {
    console.log("No inconsistent rows found. Nothing to do.");
    await closeConnections();
    process.exit(0);
  }

  const fixedRows = await db.execute(sql`
    with mismatched as (
      select
        wi.id,
        wi.task_id,
        wi.type,
        p.organization_id as project_org_id,
        b.area as source_area,
        bc.role as source_role
      from work_items wi
      inner join projects p on p.id = wi.project_id
      inner join boards b on b.id = wi.board_id
      left join board_columns bc on bc.id = wi.board_column_id
      where p.organization_id <> b.organization_id
    ),
    target_board as (
      select
        m.id,
        m.task_id,
        m.type,
        m.source_role,
        nb.id as target_board_id
      from mismatched m
      inner join lateral (
        select b2.id
        from boards b2
        where b2.organization_id = m.project_org_id
          and b2.area = m.source_area
        order by b2.is_default desc, b2.created_at asc
        limit 1
      ) nb on true
    ),
    target_mapping as (
      select
        tb.id,
        tb.task_id,
        tb.type,
        tb.target_board_id,
        case
          when tb.type in ('task', 'idea') then (
            select bc2.id
            from board_columns bc2
            where bc2.board_id = tb.target_board_id
              and (
                (tb.source_role is not null and bc2.role = tb.source_role)
                or (tb.source_role is null and bc2.role = 'backlog')
              )
            order by bc2."order" asc
            limit 1
          )
          else null
        end as target_column_id
      from target_board tb
    )
    update work_items wi
    set
      board_id = tm.target_board_id,
      board_column_id = tm.target_column_id,
      updated_at = now()
    from target_mapping tm
    where wi.id = tm.id
      and (wi.type not in ('task', 'idea') or tm.target_column_id is not null)
    returning wi.id, wi.task_id, wi.type, wi.project_id, wi.board_id, wi.board_column_id
  `);

  const mismatchedAfter = await db.execute(sql`
    select count(*)::int as count
    from work_items wi
    inner join projects p on p.id = wi.project_id
    inner join boards b on b.id = wi.board_id
    where p.organization_id <> b.organization_id
  `);

  console.log(`Rows fixed: ${fixedRows.length}`);
  console.log(`Mismatched rows after fix: ${mismatchedAfter[0]?.count ?? 0}`);

  if (fixedRows.length > 0) {
    console.log("\nFixed items:");
    for (const row of fixedRows) {
      console.log(`- ${row.task_id ?? row.id} -> board ${row.board_id}`);
    }
  }

  await closeConnections();
  process.exit(0);
};

main().catch(async (err) => {
  console.error("\nFix failed:", err);
  await closeConnections();
  process.exit(1);
});
