/**
 * Recalculate persisted RAM forecasts for implementation blocks affected by
 * work items currently in Backlog columns.
 *
 * Usage:
 *   cd backend/api
 *   bun run --env-file .env src/scripts/recalculate-backlog-resource-forecasts.ts
 *
 * Optional filters:
 *   --organization-id <orgId>
 *   --project-id <projectId>
 *   --limit <n>
 */

import {
  and,
  boardColumns,
  closeConnections,
  db,
  eq,
  isNotNull,
  isNull,
  projects,
  sql,
  workItems,
} from "@almirant/database";
import { refreshResourceForecastForAffectedBlocks } from "../domains/agents/services/resource-forecast";

interface CliOptions {
  organizationId?: string;
  projectId?: string;
  limit?: number;
}

const readFlag = (flagName: string): string | undefined => {
  const index = process.argv.indexOf(flagName);
  if (index === -1) return undefined;
  return process.argv[index + 1];
};

const parseOptions = (): CliOptions => {
  const rawLimit = readFlag("--limit");
  const limit = rawLimit ? Number(rawLimit) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    throw new Error("--limit must be a positive integer");
  }

  return {
    organizationId: readFlag("--organization-id"),
    projectId: readFlag("--project-id"),
    limit,
  };
};

const main = async () => {
  const options = parseOptions();
  const conditions = [
    sql`${boardColumns.role} = 'backlog'::column_role`,
    isNull(workItems.archivedAt),
    isNotNull(projects.organizationId),
  ];

  if (options.organizationId) {
    conditions.push(eq(projects.organizationId, options.organizationId));
  }
  if (options.projectId) {
    conditions.push(eq(projects.id, options.projectId));
  }

  const query = db
    .select({
      id: workItems.id,
      taskId: workItems.taskId,
      title: workItems.title,
      projectId: workItems.projectId,
      organizationId: projects.organizationId,
    })
    .from(workItems)
    .innerJoin(boardColumns, eq(workItems.boardColumnId, boardColumns.id))
    .innerJoin(projects, eq(workItems.projectId, projects.id))
    .where(and(...conditions));

  const rawBacklogItems = await query;
  const limitedBacklogItems = options.limit
    ? rawBacklogItems.slice(0, options.limit)
    : rawBacklogItems;
  const backlogItems = limitedBacklogItems.flatMap((item) =>
    typeof item.organizationId === "string" && item.organizationId.length > 0
      ? [{ ...item, organizationId: item.organizationId }]
      : [],
  );

  console.log(`Found ${backlogItems.length} backlog work item(s) to refresh.`);

  const byOrg = new Map<string, string[]>();
  for (const item of backlogItems) {
    const ids = byOrg.get(item.organizationId) ?? [];
    ids.push(item.id);
    byOrg.set(item.organizationId, ids);
  }

  let totalRefreshed = 0;
  let totalFailed = 0;

  for (const [organizationId, ids] of byOrg) {
    console.log(`\nOrganization ${organizationId}: ${ids.length} backlog item(s)`);
    const result = await refreshResourceForecastForAffectedBlocks(organizationId, ids);
    totalRefreshed += result.refreshed.length;
    totalFailed += result.failed.length;

    console.log(`  affected blocks: ${result.affectedBlockIds.length}`);
    console.log(`  refreshed: ${result.refreshed.length}`);
    if (result.skipped.length > 0) {
      console.log(`  skipped: ${result.skipped.length}`);
    }
    if (result.failed.length > 0) {
      console.log(`  failed: ${result.failed.length}`);
      for (const failure of result.failed.slice(0, 10)) {
        console.log(`    - ${failure.workItemId}: ${failure.errorMessage}`);
      }
    }
  }

  console.log(`\nDone. Refreshed ${totalRefreshed} forecast(s), failed ${totalFailed}.`);
};

main()
  .catch((error) => {
    console.error("Fatal error:", error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(() => closeConnections());
