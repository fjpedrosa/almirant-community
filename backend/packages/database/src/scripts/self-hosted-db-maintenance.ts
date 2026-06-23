/**
 * Self-hosted database maintenance entrypoint.
 *
 * This script bridges the historical self-hosted `drizzle-kit push --force`
 * bootstrap flow into Drizzle's real migration ledger. Existing self-hosted
 * installs created before the ledger existed are baselined exactly once, then
 * future updates use normal migrations.
 */
import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import postgres from "postgres";
import { seedPreviewData } from "../preview/preview-seed";
import { runRegisteredDataBackfills } from "../backfills/registry";

export interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

export interface MigrationRecord {
  entry: JournalEntry;
  hash: string;
}

export interface ExpectedColumn {
  schema: string;
  table: string;
  column: string;
}

interface SnapshotTable {
  name: string;
  schema?: string;
  columns: Record<string, { name: string }>;
}

interface SnapshotFile {
  tables: Record<string, SnapshotTable>;
}

interface ActualColumn {
  table_schema: string;
  table_name: string;
  column_name: string;
}

interface DbState {
  hasApplicationTables: boolean;
  hasMigrationLedger: boolean;
}

const DEFAULT_MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../migrations");
const DEFAULT_JOURNAL_PATH = resolve(
  DEFAULT_MIGRATIONS_FOLDER,
  "meta/_journal.json",
);

/**
 * Stable bridge point for legacy self-hosted databases that were created via
 * schema push and therefore have no migration ledger. Do not advance this when
 * adding new migrations: legacy no-ledger databases must baseline here and then
 * run later migrations normally.
 */
export const SELF_HOSTED_LEGACY_BASELINE_TAG = "0199_quick_famine";

const packageRoot = resolve(import.meta.dir, "../..");

export function loadJournalEntries(
  journalPath = DEFAULT_JOURNAL_PATH,
): JournalEntry[] {
  const journal = JSON.parse(readFileSync(journalPath, "utf-8")) as {
    entries?: JournalEntry[];
  };

  if (!Array.isArray(journal.entries) || journal.entries.length === 0) {
    throw new Error(`Migration journal has no entries: ${journalPath}`);
  }

  return journal.entries;
}

export function getLatestJournalEntry(entries: JournalEntry[]): JournalEntry {
  const latest = entries.at(-1);
  if (!latest) {
    throw new Error("Migration journal has no entries");
  }
  return latest;
}

export function getMigrationHash(
  entry: JournalEntry,
  migrationsFolder = DEFAULT_MIGRATIONS_FOLDER,
): string {
  const sqlPath = resolve(migrationsFolder, `${entry.tag}.sql`);
  if (!existsSync(sqlPath)) {
    throw new Error(`Migration SQL file not found: ${sqlPath}`);
  }

  return createHash("sha256")
    .update(readFileSync(sqlPath, "utf-8"))
    .digest("hex");
}

export function getMigrationRecordsThrough(
  entries: JournalEntry[],
  baselineTag: string,
  migrationsFolder = DEFAULT_MIGRATIONS_FOLDER,
): MigrationRecord[] {
  const baselineIndex = entries.findIndex((entry) => entry.tag === baselineTag);
  if (baselineIndex < 0) {
    throw new Error(`Baseline migration '${baselineTag}' was not found in journal`);
  }

  return entries.slice(0, baselineIndex + 1).map((entry) => ({
    entry,
    hash: getMigrationHash(entry, migrationsFolder),
  }));
}

export function getSnapshotPathForEntry(
  entry: JournalEntry,
  migrationsFolder = DEFAULT_MIGRATIONS_FOLDER,
): string {
  return resolve(
    migrationsFolder,
    "meta",
    `${String(entry.idx).padStart(4, "0")}_snapshot.json`,
  );
}

export function loadExpectedSchemaColumns(snapshotPath: string): ExpectedColumn[] {
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf-8")) as SnapshotFile;
  const columns: ExpectedColumn[] = [];

  for (const table of Object.values(snapshot.tables ?? {})) {
    const schema = table.schema && table.schema.length > 0 ? table.schema : "public";
    for (const column of Object.values(table.columns ?? {})) {
      columns.push({ schema, table: table.name, column: column.name });
    }
  }

  if (columns.length === 0) {
    throw new Error(`Snapshot has no table columns: ${snapshotPath}`);
  }

  return columns;
}

export function findMissingExpectedColumns(
  expected: ExpectedColumn[],
  actual: ExpectedColumn[],
): ExpectedColumn[] {
  const actualKeys = new Set(
    actual.map((column) => `${column.schema}.${column.table}.${column.column}`),
  );

  return expected.filter(
    (column) => !actualKeys.has(`${column.schema}.${column.table}.${column.column}`),
  );
}

async function ensureVectorExtension(databaseUrl: string): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await sql`CREATE EXTENSION IF NOT EXISTS vector;`;
  } finally {
    await sql.end();
  }
}

async function readDbState(databaseUrl: string): Promise<DbState> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const [tablesRow] = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
    `;
    const [ledgerRow] = await sql<{ exists: boolean }[]>`
      SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS exists
    `;

    return {
      hasApplicationTables: Number(tablesRow?.count ?? "0") > 0,
      hasMigrationLedger: ledgerRow?.exists === true,
    };
  } finally {
    await sql.end();
  }
}

async function readActualColumns(databaseUrl: string): Promise<ExpectedColumn[]> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const rows = await sql<ActualColumn[]>`
      SELECT table_schema, table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
    `;

    return rows.map((row) => ({
      schema: row.table_schema,
      table: row.table_name,
      column: row.column_name,
    }));
  } finally {
    await sql.end();
  }
}

async function validateBaselineSchema(
  databaseUrl: string,
  baselineEntry: JournalEntry,
): Promise<void> {
  const snapshotPath = getSnapshotPathForEntry(baselineEntry);
  const expected = loadExpectedSchemaColumns(snapshotPath);
  const actual = await readActualColumns(databaseUrl);
  const missing = findMissingExpectedColumns(expected, actual);

  if (missing.length === 0) {
    console.log(
      `[self-hosted-db] Baseline schema validation passed (${expected.length} columns checked).`,
    );
    return;
  }

  const sample = missing
    .slice(0, 20)
    .map((column) => `${column.schema}.${column.table}.${column.column}`)
    .join("\n  - ");
  const suffix = missing.length > 20 ? `\n  ...and ${missing.length - 20} more` : "";

  throw new Error(
    `Cannot baseline self-hosted migrations because the database schema is missing ${missing.length} expected column(s):\n  - ${sample}${suffix}`,
  );
}

async function baselineMigrationLedger(
  databaseUrl: string,
  records: MigrationRecord[],
): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe("CREATE SCHEMA IF NOT EXISTS drizzle");
      await tx.unsafe(`
        CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
          id SERIAL PRIMARY KEY,
          hash text NOT NULL,
          created_at bigint
        )
      `);

      const existingRows = (await tx.unsafe(
        "SELECT hash FROM drizzle.__drizzle_migrations",
      )) as Array<{ hash: string }>;
      const existingHashes = new Set(existingRows.map((row) => row.hash));

      for (const record of records) {
        if (existingHashes.has(record.hash)) {
          continue;
        }

        await tx.unsafe(
          "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)",
          [record.hash, record.entry.when],
        );
      }
    });

    console.log(
      `[self-hosted-db] Baseline ledger contains ${records.length} migration record(s).`,
    );
  } finally {
    await sql.end();
  }
}

async function runCommand(
  label: string,
  command: string[],
  databaseUrl: string,
): Promise<void> {
  console.log(`[self-hosted-db] ${label}...`);
  const child = Bun.spawn(command, {
    cwd: packageRoot,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      NODE_ENV: process.env.NODE_ENV ?? "production",
    },
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`${label} failed with exit code ${exitCode}`);
  }
}

async function runDrizzlePush(databaseUrl: string): Promise<void> {
  await runCommand(
    "Applying current schema with drizzle-kit push",
    ["bunx", "drizzle-kit", "push", "--force"],
    databaseUrl,
  );
}

async function runValidatedMigrations(databaseUrl: string): Promise<void> {
  await runCommand(
    "Running validated Drizzle migrations",
    ["bun", "run", "src/scripts/migrate-with-validation.ts"],
    databaseUrl,
  );
}

export async function maintainSelfHostedDatabase(databaseUrl: string): Promise<void> {
  console.log("[self-hosted-db] Ensuring pgvector extension...");
  await ensureVectorExtension(databaseUrl);

  const journalEntries = loadJournalEntries();
  const latestEntry = getLatestJournalEntry(journalEntries);
  const legacyBaselineEntry = journalEntries.find(
    (entry) => entry.tag === SELF_HOSTED_LEGACY_BASELINE_TAG,
  );
  if (!legacyBaselineEntry) {
    throw new Error(
      `Configured legacy baseline '${SELF_HOSTED_LEGACY_BASELINE_TAG}' was not found in the migration journal`,
    );
  }

  const initialState = await readDbState(databaseUrl);

  if (!initialState.hasApplicationTables) {
    console.log(
      "[self-hosted-db] Empty database detected. Creating latest schema...",
    );
    await runDrizzlePush(databaseUrl);
    await validateBaselineSchema(databaseUrl, latestEntry);
    await baselineMigrationLedger(
      databaseUrl,
      getMigrationRecordsThrough(journalEntries, latestEntry.tag),
    );
  } else if (!initialState.hasMigrationLedger) {
    console.log(
      "[self-hosted-db] Legacy self-hosted database without migration ledger detected.",
    );

    if (latestEntry.tag !== SELF_HOSTED_LEGACY_BASELINE_TAG) {
      throw new Error(
        `This database has no Drizzle migration ledger and the current release contains migrations after the self-hosted baseline (${SELF_HOSTED_LEGACY_BASELINE_TAG}). ` +
          "Refusing to silently mark newer migrations as applied. Upgrade first through the baseline release or run a manual recovery.",
      );
    }

    await runDrizzlePush(databaseUrl);
    await validateBaselineSchema(databaseUrl, legacyBaselineEntry);
    await baselineMigrationLedger(
      databaseUrl,
      getMigrationRecordsThrough(journalEntries, SELF_HOSTED_LEGACY_BASELINE_TAG),
    );
    await runValidatedMigrations(databaseUrl);
  } else {
    console.log("[self-hosted-db] Migration ledger detected.");
    await runValidatedMigrations(databaseUrl);
  }

  console.log("[self-hosted-db] Running registered data backfills...");
  await runRegisteredDataBackfills(databaseUrl);

  console.log("[self-hosted-db] Seeding self-hosted platform defaults...");
  await seedPreviewData(databaseUrl);
  console.log("[self-hosted-db] Self-hosted database maintenance completed.");
}

if (import.meta.main) {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error(
      "[self-hosted-db] ERROR: DATABASE_URL environment variable is required.",
    );
    process.exit(1);
  }

  maintainSelfHostedDatabase(databaseUrl)
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("[self-hosted-db] Maintenance failed:", error);
      process.exit(1);
    });
}
