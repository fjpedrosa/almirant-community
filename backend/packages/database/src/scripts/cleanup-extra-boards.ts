/**
 * Cleanup script for known extra boards.
 *
 * It migrates non-archived work items from boards that will be removed into
 * the board that will be kept, then deletes the source board.
 *
 * Safety checks:
 * - source and target board must exist
 * - source and target board must belong to the same organization
 * - source board must end with 0 non-archived items before delete
 *
 * Usage:
 *   cd backend/packages/database
 *   export BOARD_CLEANUP_MAPPINGS_JSON='[
 *     {
 *       "sourceBoardId": "source-board-id",
 *       "targetBoardId": "target-board-id",
 *       "reason": "Why this board should be merged"
 *     }
 *   ]'
 *   bun run src/scripts/cleanup-extra-boards.ts
 */

import { sql } from "drizzle-orm";
import { closeConnections, db } from "../client";

type Mapping = {
  sourceBoardId: string;
  targetBoardId: string;
  reason: string;
};

const parseMappingsFromEnv = (): Mapping[] => {
  const raw = process.env.BOARD_CLEANUP_MAPPINGS_JSON;

  if (!raw) {
    throw new Error(
      "BOARD_CLEANUP_MAPPINGS_JSON is required. Refusing to run board cleanup without explicit mappings."
    );
  }

  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error("BOARD_CLEANUP_MAPPINGS_JSON must be a JSON array.");
  }

  return parsed.map((mapping, index) => {
    if (
      typeof mapping !== "object" ||
      mapping === null ||
      typeof mapping.sourceBoardId !== "string" ||
      typeof mapping.targetBoardId !== "string" ||
      typeof mapping.reason !== "string"
    ) {
      throw new Error(`Invalid board cleanup mapping at index ${index}.`);
    }

    return {
      sourceBoardId: mapping.sourceBoardId,
      targetBoardId: mapping.targetBoardId,
      reason: mapping.reason,
    };
  });
};

const mappings: Mapping[] = parseMappingsFromEnv();

const summarizeBoards = async () => {
  return db.execute(sql`
    select
      o.name as organization_name,
      b.id as board_id,
      b.name as board_name,
      b.area,
      count(wi.id)::int as work_items_count
    from boards b
    inner join organization o on o.id = b.organization_id
    left join work_items wi on wi.board_id = b.id and wi.archived_at is null
    group by o.name, b.id, b.name, b.area
    order by o.name, b.name, b.id
  `);
};

const main = async () => {
  console.log("=== Cleanup Extra Boards ===\n");
  const before = await summarizeBoards();

  const applied = await db.transaction(async (tx) => {
    const perBoard: Array<Record<string, unknown>> = [];

    for (const mapping of mappings) {
      const boards = await tx.execute(sql`
        select id, organization_id, name, area
        from boards
        where id in (${mapping.sourceBoardId}, ${mapping.targetBoardId})
        order by id
      `);

      if (boards.length !== 2) {
        throw new Error(
          `Mapping invalid (${mapping.sourceBoardId} -> ${mapping.targetBoardId}): source/target board not found`
        );
      }

      const source = boards.find((b) => b.id === mapping.sourceBoardId)!;
      const target = boards.find((b) => b.id === mapping.targetBoardId)!;

      if (source.organization_id !== target.organization_id) {
        throw new Error(
          `Cross-org mapping blocked (${mapping.sourceBoardId} -> ${mapping.targetBoardId})`
        );
      }

      const moved = await tx.execute(sql`
        with source_items as (
          select wi.id, wi.task_id, wi.type, wi.board_column_id
          from work_items wi
          where wi.board_id = ${mapping.sourceBoardId}
            and wi.archived_at is null
        ), mapped as (
          select
            si.id,
            si.task_id,
            si.type,
            case
              when si.type in ('task', 'idea') then (
                select bc_target.id
                from board_columns bc_target
                where bc_target.board_id = ${mapping.targetBoardId}
                  and (
                    (
                      exists (
                        select 1
                        from board_columns bc_source
                        where bc_source.id = si.board_column_id
                          and bc_source.role is not null
                          and bc_target.role = bc_source.role
                      )
                    )
                    or (
                      not exists (
                        select 1
                        from board_columns bc_source
                        where bc_source.id = si.board_column_id
                          and bc_source.role is not null
                      )
                      and bc_target.role = 'backlog'
                    )
                  )
                order by bc_target."order" asc
                limit 1
              )
              else null
            end as target_column_id
          from source_items si
        )
        update work_items wi
        set
          board_id = ${mapping.targetBoardId},
          board_column_id =
            case
              when wi.type in ('task', 'idea') then mapped.target_column_id
              else null
            end,
          updated_at = now()
        from mapped
        where wi.id = mapped.id
          and (
            wi.type not in ('task', 'idea')
            or mapped.target_column_id is not null
          )
        returning wi.id, wi.task_id
      `);

      const remaining = await tx.execute(sql`
        select count(*)::int as count
        from work_items wi
        where wi.board_id = ${mapping.sourceBoardId}
          and wi.archived_at is null
      `);

      const remainingCount = Number(remaining[0]?.count ?? 0);
      if (remainingCount > 0) {
        throw new Error(
          `Abort delete: board ${mapping.sourceBoardId} still has ${remainingCount} non-archived items after migration`
        );
      }

      await tx.execute(sql`delete from boards where id = ${mapping.sourceBoardId}`);

      perBoard.push({
        sourceBoardId: mapping.sourceBoardId,
        targetBoardId: mapping.targetBoardId,
        reason: mapping.reason,
        movedCount: moved.length,
      });
    }

    return perBoard;
  });

  const after = await summarizeBoards();

  console.log(JSON.stringify({
    mappingsApplied: applied,
    before,
    after,
  }, null, 2));
};

main()
  .catch(async (err) => {
    console.error("\nCleanup failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeConnections();
  });
