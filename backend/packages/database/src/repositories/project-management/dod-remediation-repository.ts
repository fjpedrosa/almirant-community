import { sql } from "drizzle-orm";
import { db } from "../../client";

const rowsToIds = (rows: unknown): string[] => {
  const raw =
    (rows as { rows?: Array<{ id: string }> })?.rows ??
    (rows as Array<{ id: string }>);

  return Array.isArray(raw) ? raw.map((row) => row.id) : [];
};

/**
 * Recursively resolve the leaf tasks that runner-fix-dod is still expected to
 * complete for a root work item.
 *
 * Unlike the generic implementation contract, DoD remediation must NOT expect
 * tasks that were already moved back to Review/Validating, tasks without an
 * actionable DoD report, or tasks explicitly marked as requiring human action.
 */
export const getDodRemediationExpectedLeafTaskIdsUnder = async (
  workspaceId: string,
  rootWorkItemId: string,
): Promise<string[]> => {
  const rows = await db.execute<{ id: string }>(sql`
    WITH RECURSIVE descendants AS (
      SELECT wi.id, wi.type, wi.archived_at, wi.parent_id, wi.board_column_id, wi.metadata
      FROM work_items wi
      INNER JOIN projects p ON wi.project_id = p.id
      WHERE wi.id = ${rootWorkItemId}
        AND p.workspace_id = ${workspaceId}
      UNION ALL
      SELECT child.id, child.type, child.archived_at, child.parent_id, child.board_column_id, child.metadata
      FROM work_items child
      INNER JOIN descendants d ON child.parent_id = d.id
    )
    SELECT d.id
    FROM descendants d
    INNER JOIN board_columns bc ON bc.id = d.board_column_id
    WHERE d.archived_at IS NULL
      AND d.type = 'task'
      AND bc.role = 'backlog'
      AND d.metadata ->> 'dod_incompleted' = 'true'
      AND COALESCE(NULLIF(BTRIM(d.metadata ->> 'dod_report'), ''), '') <> ''
      AND COALESCE(d.metadata ->> 'dod_human_action_required', 'false') <> 'true'
      AND COALESCE(d.metadata ->> 'dod_human_review_required', 'false') <> 'true'
      AND COALESCE(d.metadata ->> 'dod_auto_remediation_blocked', 'false') <> 'true'
      AND COALESCE(d.metadata ->> 'dod_external_validation_required', 'false') <> 'true'
      AND NOT EXISTS (
        SELECT 1
        FROM work_items c
        WHERE c.parent_id = d.id
          AND c.archived_at IS NULL
      )
  `);

  return rowsToIds(rows);
};
