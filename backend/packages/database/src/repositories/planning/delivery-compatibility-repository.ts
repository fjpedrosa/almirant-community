import { sql, type SQL } from "drizzle-orm";
import { db } from "../../client";
import {
  classifyDeliveryAuthority,
  type DeliveryAuthority,
  type DeliveryAuthorityFact,
  type DeliveryAuthorityScope,
} from "../../domain/delivery-authority";

export interface DeliveryCompatibilityExecutor {
  execute(query: SQL): Promise<unknown>;
}

export type CompatibilityReadinessCode =
  | "compatibility_schema_not_ready"
  | "board_column_nullable"
  | "compatibility_scope_mismatch"
  | "canonical_backlog_required"
  | "incompatible_native_links";

export class CompatibilityReadinessError extends Error {
  constructor(public readonly code: CompatibilityReadinessCode) {
    super(code);
    this.name = "CompatibilityReadinessError";
  }
}

const requiredChecks = [
  ["delivery_plans", "delivery_plans_creation_sha256_check"], ["delivery_plans", "delivery_plans_revision_lock_check"],
  ["delivery_plan_revisions", "delivery_plan_revisions_number_check"], ["delivery_plan_revisions", "delivery_plan_revisions_contract_check"], ["delivery_plan_revisions", "delivery_plan_revisions_sha256_check"],
  ["delivery_plan_items", "delivery_plan_items_projection_check"], ["delivery_plan_revision_items", "delivery_plan_revision_items_parent_check"], ["delivery_plan_revision_items", "delivery_plan_revision_items_order_check"],
  ["delivery_plan_revision_items", "delivery_plan_revision_items_sha256_check"], ["delivery_plan_revision_dependencies", "delivery_plan_revision_dependencies_order_check"], ["delivery_plan_revision_dependencies", "delivery_plan_revision_dependencies_self_check"],
  ["work_items", "work_items_work_unit_size_check"], ["work_items", "work_items_work_unit_size_origin_check"], ["work_items", "work_items_backlog_intent_check"], ["work_items", "work_items_work_unit_size_pair_check"],
] as const;
const planTables = ["delivery_plans", "delivery_plan_revisions", "delivery_plan_items", "delivery_plan_revision_items", "delivery_plan_revision_dependencies"];
const planTableNames = sql.join(planTables.map((name) => sql`${name}`), sql`, `);
const requiredCheckPairs = sql.join(requiredChecks.map(([table, name]) => sql`(${table}, ${name})`), sql`, `);

type AuthorityRow = DeliveryAuthorityFact & { workItemId: string };
type ReadinessRow = { tableCount: number; checkCount: number; boardColumnRequired: boolean; scopeMatches: boolean; backlogCount: number; canonicalBacklogCount: number; incompatibleCount: number };
const rows = <T>(value: unknown): T[] => value as T[];
const MAX_AUTHORITY_BATCH = 200;

export const loadDeliveryAuthorities = async (
  workItemIds: readonly string[],
  scope: DeliveryAuthorityScope,
  executor: DeliveryCompatibilityExecutor = db,
): Promise<Record<string, DeliveryAuthority>> => {
  if (workItemIds.length === 0) return {};
  if (workItemIds.length > MAX_AUTHORITY_BATCH) throw new RangeError("delivery_authority_batch_limit");
  const identifiers = sql.join(workItemIds.map((id) => sql`${id}::uuid`), sql`, `);
  const result = rows<AuthorityRow>(await executor.execute(sql`
    SELECT wi.id AS "workItemId", dpi.id AS "itemId", dpi.kind AS "itemKind", dp.id AS "planId",
      dp.workspace_id AS "planWorkspaceId", dp.project_id AS "planProjectId", dp.board_id AS "planBoardId",
      wb.workspace_id AS "workItemWorkspaceId", wi.project_id AS "workItemProjectId", wi.board_id AS "workItemBoardId",
      wi.type AS "workItemType", wi.parent_id AS "parentId", wi.work_unit_size AS "size", wi.work_unit_size_origin AS "sizeOrigin",
      wi.backlog_intent AS "backlogIntent", cr.id AS "currentRevisionId",
      CASE WHEN cr.id IS NULL OR NOT EXISTS (SELECT 1 FROM delivery_plan_revision_items ri WHERE ri.item_id = dpi.id) THEN 'missing'
        WHEN (SELECT count(*) FROM delivery_plan_revision_items ri WHERE ri.item_id = dpi.id AND ri.plan_revision_id = cr.id) > 1 THEN 'conflict'
        WHEN EXISTS (SELECT 1 FROM delivery_plan_revision_items ri WHERE ri.item_id = dpi.id AND ri.plan_revision_id = cr.id) THEN 'current'
        ELSE 'retired' END AS membership
    FROM work_items wi
    LEFT JOIN delivery_plan_items dpi ON dpi.work_item_id = wi.id
    LEFT JOIN delivery_plans dp ON dp.id = dpi.plan_id
    LEFT JOIN delivery_plan_revisions cr ON cr.plan_id = dp.id AND cr.revision_number = dp.current_revision_number
    LEFT JOIN boards wb ON wb.id = wi.board_id
    WHERE wi.id IN (${identifiers}) AND wb.workspace_id = ${scope.workspaceId}
      AND wi.project_id = ${scope.projectId}::uuid AND wi.board_id = ${scope.boardId}::uuid
  `));
  const grouped = new Map<string, DeliveryAuthorityFact[]>();
  for (const row of result) {
    const facts = grouped.get(row.workItemId) ?? [];
    if (row.itemId !== null) facts.push(row);
    grouped.set(row.workItemId, facts);
  }
  return Object.fromEntries(workItemIds.filter((id) => grouped.has(id)).map((id) => [id, classifyDeliveryAuthority(scope, grouped.get(id)!)]));
};

export const assertNativePlanCompatibilityReady = async (
  scope: DeliveryAuthorityScope,
  executor: DeliveryCompatibilityExecutor = db,
): Promise<void> => {
  let result: ReadinessRow | undefined;
  try {
    [result] = rows<ReadinessRow>(await executor.execute(sql`
      SELECT
        (SELECT count(*)::int FROM pg_tables WHERE schemaname = 'public' AND tablename IN (${planTableNames})) AS "tableCount",
        (SELECT count(*)::int FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace WHERE c.contype = 'c' AND n.nspname = 'public'
          AND (t.relname, c.conname) IN (${requiredCheckPairs})) AS "checkCount",
        COALESCE((SELECT is_nullable = 'NO' FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'work_items' AND column_name = 'board_column_id'), false) AS "boardColumnRequired",
        EXISTS (SELECT 1 FROM projects p JOIN boards b ON b.id = ${scope.boardId}::uuid WHERE p.id = ${scope.projectId}::uuid AND p.workspace_id = ${scope.workspaceId} AND b.workspace_id = ${scope.workspaceId} AND b.area = 'desarrollo') AS "scopeMatches",
        (SELECT count(*)::int FROM board_columns WHERE board_id = ${scope.boardId}::uuid AND role = 'backlog') AS "backlogCount",
        (SELECT count(*)::int FROM board_columns WHERE board_id = ${scope.boardId}::uuid AND role = 'backlog' AND name = 'Backlog') AS "canonicalBacklogCount",
        (SELECT count(*)::int FROM delivery_plan_items dpi
          LEFT JOIN delivery_plans dp ON dp.id = dpi.plan_id LEFT JOIN work_items wi ON wi.id = dpi.work_item_id
          LEFT JOIN boards wb ON wb.id = wi.board_id LEFT JOIN delivery_plan_revisions cr ON cr.plan_id = dp.id AND cr.revision_number = dp.current_revision_number
          WHERE dpi.work_item_id IS NOT NULL AND (dp.project_id = ${scope.projectId}::uuid OR wi.project_id = ${scope.projectId}::uuid OR dp.board_id = ${scope.boardId}::uuid OR wi.board_id = ${scope.boardId}::uuid)
            AND (dpi.kind IS DISTINCT FROM 'work_unit' OR dp.workspace_id IS DISTINCT FROM ${scope.workspaceId}
              OR dp.project_id IS DISTINCT FROM ${scope.projectId}::uuid OR dp.board_id IS DISTINCT FROM ${scope.boardId}::uuid
              OR wb.workspace_id IS DISTINCT FROM ${scope.workspaceId} OR wi.project_id IS DISTINCT FROM ${scope.projectId}::uuid
              OR wi.board_id IS DISTINCT FROM ${scope.boardId}::uuid OR wi.type IS DISTINCT FROM 'task' OR wi.parent_id IS NOT NULL
              OR COALESCE(wi.work_unit_size, '') NOT IN ('XS', 'S', 'M', 'L', 'XL')
              OR wi.work_unit_size_origin IS DISTINCT FROM 'plan' OR COALESCE(wi.backlog_intent, '') NOT IN ('new', 'fix') OR cr.id IS NULL
              OR (SELECT count(*) FROM delivery_plan_items peer WHERE peer.work_item_id = dpi.work_item_id) <> 1
              OR NOT EXISTS (SELECT 1 FROM delivery_plan_revision_items ri WHERE ri.item_id = dpi.id)
              OR (SELECT count(*) FROM delivery_plan_revision_items ri WHERE ri.item_id = dpi.id AND ri.plan_revision_id = cr.id) > 1)) AS "incompatibleCount"
    `));
  } catch (error) {
    const databaseError = error as { code?: string; cause?: { code?: string } };
    if (["42P01", "42703"].includes(databaseError.code ?? "") || ["42P01", "42703"].includes(databaseError.cause?.code ?? "")) throw new CompatibilityReadinessError("compatibility_schema_not_ready");
    throw error;
  }
  if (!result || result.tableCount !== planTables.length || result.checkCount !== requiredChecks.length) throw new CompatibilityReadinessError("compatibility_schema_not_ready");
  if (!result.boardColumnRequired) throw new CompatibilityReadinessError("board_column_nullable");
  if (!result.scopeMatches) throw new CompatibilityReadinessError("compatibility_scope_mismatch");
  if (result.backlogCount !== 1 || result.canonicalBacklogCount !== 1) throw new CompatibilityReadinessError("canonical_backlog_required");
  if (result.incompatibleCount > 0) throw new CompatibilityReadinessError("incompatible_native_links");
};
