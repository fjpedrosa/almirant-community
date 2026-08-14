import { sql } from "drizzle-orm";
import { db } from "../client";

/**
 * VACUUM FULL takes an ACCESS EXCLUSIVE lock, so this is an operator-run
 * maintenance step, never a sweeper: it is only worth it after retention has
 * purged a large backlog, because DELETE never returns pages to the OS.
 */
export const COMPACTABLE_TABLES = ["agent_native_events", "session_events"] as const;

export type CompactableTable = (typeof COMPACTABLE_TABLES)[number];

export interface TableSize {
  table: string;
  totalBytes: number;
  liveTuples: number;
}

export interface CompactionPlanEntry {
  table: CompactableTable;
  totalBytes: number;
  liveTuples: number;
}

const GB = 1024 ** 3;
const MB = 1024 ** 2;

const formatBytes = (bytes: number): string =>
  bytes >= GB ? `${(bytes / GB).toFixed(2)} GB` : `${(bytes / MB).toFixed(2)} MB`;

export const formatReclaimed = (beforeBytes: number, afterBytes: number): string =>
  `${formatBytes(beforeBytes)} → ${formatBytes(afterBytes)}`;

/**
 * Selects on total size, not dead tuples: once autovacuum has run, the pages a
 * purge freed are reusable but still allocated, so n_dead_tup reads ~0 for
 * exactly the tables that are holding the most disk.
 */
export const buildCompactionPlan = (
  sizes: readonly TableSize[],
  { minimumTotalBytes }: { minimumTotalBytes: number },
): CompactionPlanEntry[] => {
  for (const entry of sizes) {
    if (!COMPACTABLE_TABLES.includes(entry.table as CompactableTable)) {
      throw new Error(`Table is not compactable: ${entry.table}`);
    }
  }

  return sizes
    .filter((entry) => entry.totalBytes >= minimumTotalBytes)
    .sort((left, right) => right.totalBytes - left.totalBytes)
    .map((entry) => ({ ...entry, table: entry.table as CompactableTable }));
};

export const readTableSizes = async (): Promise<TableSize[]> => {
  const rows = await db.execute<{
    table_name: string;
    total_bytes: string;
    live_tuples: string;
  }>(sql`
    select
      s.relname as table_name,
      pg_total_relation_size(s.relid) as total_bytes,
      s.n_live_tup as live_tuples
    from pg_stat_user_tables s
    where s.relname in ('agent_native_events', 'session_events')
  `);

  return rows.map((row) => ({
    table: row.table_name,
    totalBytes: Number(row.total_bytes),
    liveTuples: Number(row.live_tuples),
  }));
};
