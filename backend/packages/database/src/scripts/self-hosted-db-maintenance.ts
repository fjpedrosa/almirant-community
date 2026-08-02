/**
 * Self-hosted database maintenance entrypoint.
 *
 * This script bridges the historical self-hosted `drizzle-kit push --force`
 * bootstrap flow into Drizzle's real migration ledger. Existing self-hosted
 * installs created before the ledger existed are baselined exactly once, then
 * future updates use normal migrations.
 */
import { resolve } from "path";
import postgres from "postgres";
import { seedPreviewData } from "../preview/preview-seed";
import { runRegisteredDataBackfills } from "../backfills/registry";
import {
  applyCurrentSchema,
  baselineMigrationLedger,
  ensureVectorExtension,
  getLatestJournalEntry,
  getMigrationRecordsThrough,
  loadJournalEntries,
  materializeCurrentSchemaImperativeObjects,
  validateCurrentSchema,
} from "./current-schema-bootstrap";

export {
  findMissingExpectedColumns,
  getLatestJournalEntry,
  getMigrationHash,
  getMigrationRecordsThrough,
  getSnapshotPathForEntry,
  loadExpectedSchemaColumns,
  loadJournalEntries,
  type ExpectedColumn,
  type JournalEntry,
  type MigrationRecord,
} from "./current-schema-bootstrap";

interface DbState {
  hasApplicationTables: boolean;
  hasMigrationLedger: boolean;
}

/**
 * Stable bridge point for legacy self-hosted databases that were created via
 * schema push and therefore have no migration ledger. Do not advance this when
 * adding new migrations: legacy no-ledger databases must baseline here and then
 * run later migrations normally.
 */
export const SELF_HOSTED_LEGACY_BASELINE_TAG = "0199_quick_famine";

const packageRoot = resolve(import.meta.dir, "../..");

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
    await applyCurrentSchema(databaseUrl, "[self-hosted-db]");
    await materializeCurrentSchemaImperativeObjects(
      databaseUrl,
      "[self-hosted-db]",
    );
    await validateCurrentSchema(databaseUrl, latestEntry, "[self-hosted-db]");
    await baselineMigrationLedger(
      databaseUrl,
      getMigrationRecordsThrough(journalEntries, latestEntry.tag),
      "[self-hosted-db]",
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

    await applyCurrentSchema(databaseUrl, "[self-hosted-db]");
    await validateCurrentSchema(
      databaseUrl,
      legacyBaselineEntry,
      "[self-hosted-db]",
    );
    await baselineMigrationLedger(
      databaseUrl,
      getMigrationRecordsThrough(journalEntries, SELF_HOSTED_LEGACY_BASELINE_TAG),
      "[self-hosted-db]",
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
