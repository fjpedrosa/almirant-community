import { sql } from "drizzle-orm";
import { db } from "../client";
import {
  buildCompactionPlan,
  formatReclaimed,
  readTableSizes,
  type CompactionPlanEntry,
} from "./compact-archived-tables";

const MINIMUM_TOTAL_BYTES = 100 * 1024 ** 2;

const formatBytesOnDisk = (bytes: number): string => formatReclaimed(bytes, bytes).split(" → ")[0]!;

const totalBytesOf = async (table: string): Promise<number> => {
  const [row] = await db.execute<{ bytes: string }>(
    sql`select pg_total_relation_size(${table}::regclass) as bytes`,
  );
  return Number(row?.bytes ?? 0);
};

const compact = async (entry: CompactionPlanEntry): Promise<void> => {
  const before = await totalBytesOf(entry.table);
  const startedAt = Date.now();

  console.log(`[compact] ${entry.table}: starting VACUUM FULL (exclusive lock)`);
  // The identifier comes from COMPACTABLE_TABLES, which buildCompactionPlan enforces.
  await db.execute(sql.raw(`VACUUM (FULL, ANALYZE) ${entry.table}`));

  const after = await totalBytesOf(entry.table);
  console.log(
    `[compact] ${entry.table}: ${formatReclaimed(before, after)} in ${Math.round(
      (Date.now() - startedAt) / 1000,
    )}s`,
  );
};

const main = async (): Promise<void> => {
  const apply = process.argv.includes("--apply");

  const plan = buildCompactionPlan(await readTableSizes(), {
    minimumTotalBytes: MINIMUM_TOTAL_BYTES,
  });

  if (plan.length === 0) {
    console.log("[compact] Nothing to compact: no table is large enough to be worth a rewrite.");
    return;
  }

  for (const entry of plan) {
    console.log(
      `[compact] ${entry.table}: ${formatBytesOnDisk(entry.totalBytes)} on disk, ${entry.liveTuples.toLocaleString("en-US")} live rows`,
    );
  }

  if (!apply) {
    console.log("\n[compact] Dry run. Re-run with --apply to rewrite these tables.");
    console.log("[compact] VACUUM FULL blocks all reads and writes on each table it rewrites.");
    return;
  }

  for (const entry of plan) {
    await compact(entry);
  }

  console.log("[compact] Done.");
};

await main();
process.exit(0);
