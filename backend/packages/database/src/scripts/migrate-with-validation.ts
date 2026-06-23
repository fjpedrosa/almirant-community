/**
 * Migration wrapper that validates journal integrity and reports applied migrations.
 *
 * Usage:
 *   bun run --env-file .env.local src/scripts/migrate-with-validation.ts
 *   NODE_ENV=production bun run --env-file .env src/scripts/migrate-with-validation.ts
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { maybeRunBugFixAttemptPreflight } from "./bug-fix-attempts-migration-preflight";
import { maybeRunVectorExtensionPreflight } from "./vector-extension-migration-preflight";

const migrationsFolder = resolve(import.meta.dir, "../../migrations");
const journalPath = resolve(migrationsFolder, "meta/_journal.json");

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

const COMPATIBLE_MIGRATION_HASHES: Record<string, string[]> = {
  "0046_happy_junta": [
    "fc0c02c60e024a6af78f03b8ba31db4c1d829aa84113e9d40a26ab157228f3ca",
  ],
  "0069_many_thor_girl": [
    "41c375aac8e4109d8241d2ae7ab79fc2f8cce837c1ee59daf9f2d0a0ac438430",
  ],
  "0070_add_check_constraint": [
    "4166fa19039c93df60d0fb15223f62c5e926f2e76dd2bba987c2ed8acaa16592",
  ],
  "0071_data_migrate_todos": [
    "29bfc2da1b09418ebf87f8d3ff624818f36de26995bb22396071aa2b591d7047",
  ],
  "0075_wet_lilith": [
    "6e017de3ef2bdf24963ba30479b45b4e80ac8633476a3b48e346ce592c13a8fe",
  ],
  "0080_wet_doctor_strange": [
    "d23564a678a687efce3ac89823a14f3d4484f2f48aae5e497fc8e9cf490c7d4d",
  ],
  "0085_data_migrate_seeds": [
    "2a8e554fa08dee11bd3c4dda5214e9dfd528808627ce3c450a4bfbfc1de6b30d",
  ],
  "0119_overconfident_warhawk": [
    "f0ff4f550c3ccc88da5aaa213986061b2adfd11bbf929a8f776fc8c26b7f224d",
  ],
  "0121_faithful_gideon": [
    "18dcd9ab58d5dd59ca7bc3e5d962c9fe19f3f2c9eb4a8e8238c3ee26a616a59a",
  ],
};

// ── 1. Validate journal ordering ────────────────────────────────────────────
const journal: { entries: JournalEntry[] } = JSON.parse(
  readFileSync(journalPath, "utf-8")
);

const entries = journal.entries;
const issues: string[] = [];

for (let i = 1; i < entries.length; i++) {
  if (entries[i].when <= entries[i - 1].when) {
    issues.push(
      `  idx ${entries[i].idx} (${entries[i].tag}): when=${entries[i].when} <= previous when=${entries[i - 1].when}`
    );
  }
}

if (issues.length > 0) {
  // Only block if the LAST entry is out of order — older ones are already applied
  const last = entries[entries.length - 1];
  const secondLast = entries[entries.length - 2];
  if (last.when <= secondLast.when) {
    console.error(
      `\n❌ BLOCKING: The latest migration (idx ${last.idx}, ${last.tag}) has when=${last.when}` +
        ` which is <= the previous entry's when=${secondLast.when}.` +
        `\n   Drizzle will silently skip it. Fix the 'when' value before migrating.\n`
    );
    process.exit(1);
  }
}

console.log("✅ Journal validated.\n");

// ── 2. Connect and find pending migrations ──────────────────────────────────
const databaseUrl = process.env.DATABASE_URL!;
const urlParts = new URL(databaseUrl);
console.log(`🔌 Database: ${urlParts.hostname}:${urlParts.port}${urlParts.pathname}`);
console.log(`   Environment: ${process.env.NODE_ENV || "development"}\n`);

const sql = postgres(databaseUrl, { max: 1 });
const db = drizzle(sql);

// Compute hashes for journal entries to find truly pending migrations
// Drizzle hashes each migration's SQL content with SHA-256
const { createHash } = await import("crypto");
const { readFileSync: readFile } = await import("fs");

const getMigrationHash = (entry: JournalEntry): string | null => {
  const sqlPath = resolve(migrationsFolder, `${entry.tag}.sql`);

  try {
    const content = readFile(sqlPath, "utf-8");
    return createHash("sha256").update(content).digest("hex");
  } catch {
    return null;
  }
};

const loadAppliedHashes = async (): Promise<{
  hashes: Set<string>;
  hasMigrationsTable: boolean;
}> => {
  const hashes = new Set<string>();

  try {
    const applied = await sql`
      SELECT hash, created_at FROM "drizzle"."__drizzle_migrations" ORDER BY created_at ASC
    `;

    for (const row of applied) {
      hashes.add(row.hash);
    }

    console.log(`📋 Already applied: ${applied.length} migrations in DB`);
    return {
      hashes,
      hasMigrationsTable: true,
    };
  } catch {
    console.log("📋 No __drizzle_migrations table yet (first run)");
    return {
      hashes,
      hasMigrationsTable: false,
    };
  }
};

const getPendingEntries = (appliedHashes: Set<string>): JournalEntry[] => {
  const result: JournalEntry[] = [];

  for (const entry of entries) {
    const hash = getMigrationHash(entry);
    if (!hash) {
      // SQL file missing — skip (may have been removed)
      continue;
    }

    if (!appliedHashes.has(hash)) {
      result.push(entry);
    }
  }

  return result;
};

const backfillCompatibleMigrationHashes = async (
  appliedHashes: Set<string>,
  hasMigrationsTable: boolean
): Promise<boolean> => {
  if (!hasMigrationsTable) {
    return false;
  }

  let inserted = false;

  for (const entry of entries) {
    const currentHash = getMigrationHash(entry);
    const compatibleHashes = COMPATIBLE_MIGRATION_HASHES[entry.tag] ?? [];

    if (!currentHash || compatibleHashes.length === 0 || appliedHashes.has(currentHash)) {
      continue;
    }

    const matchedLegacyHash = compatibleHashes.find((hash) => appliedHashes.has(hash));
    if (!matchedLegacyHash) {
      continue;
    }

    await sql`
      INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at")
      VALUES (${currentHash}, ${Date.now()})
    `;

    appliedHashes.add(currentHash);
    inserted = true;

    console.log(
      `🧩 Backfilled compatibility hash for ${entry.tag} (legacy hash ${matchedLegacyHash.slice(0, 12)}...).`
    );
  }

  return inserted;
};

let { hashes: appliedHashes, hasMigrationsTable } = await loadAppliedHashes();
if (await backfillCompatibleMigrationHashes(appliedHashes, hasMigrationsTable)) {
  ({ hashes: appliedHashes, hasMigrationsTable } = await loadAppliedHashes());
}
const pendingEntries = getPendingEntries(appliedHashes);
const initiallyPendingEntries = [...pendingEntries];

if (pendingEntries.length === 0) {
  console.log("✅ No pending migrations. Database is up to date.\n");
  await sql.end();
  process.exit(0);
}

console.log(`⏳ Pending: ${pendingEntries.length} migration(s) to apply:\n`);
for (const entry of pendingEntries) {
  console.log(`   → ${entry.tag} (idx ${entry.idx})`);
}
console.log();

await maybeRunBugFixAttemptPreflight({
  pendingMigrationTags: pendingEntries.map((entry) => entry.tag),
  executeInTransaction: async <T>(callback: (execute: (statement: string) => Promise<unknown>) => Promise<T>) =>
    (await sql.begin(async (tx) =>
      callback((statement) => tx.unsafe(statement) as Promise<unknown>))) as T,
  log: (message) => console.log(message),
});

await maybeRunVectorExtensionPreflight({
  pendingMigrationTags: pendingEntries.map((entry) => entry.tag),
  execute: (statement) => sql.unsafe(statement) as Promise<unknown>,
  log: (message) => console.log(message),
});

// ── 3. Run migrations ───────────────────────────────────────────────────────
try {
  await migrate(db, { migrationsFolder });
} catch (err) {
  console.error("\n❌ Migration failed:\n", err);
  await sql.end();
  process.exit(1);
}

// ── 4. Verify what was applied ──────────────────────────────────────────────
const afterApplied = (await sql`
  SELECT hash, created_at FROM "drizzle"."__drizzle_migrations" ORDER BY created_at ASC
`) as Array<{ hash: string }>;
const afterHashes = new Set(afterApplied.map((row) => row.hash));
const newlyApplied = initiallyPendingEntries.filter((entry) => {
  const hash = getMigrationHash(entry);
  if (!hash) {
    return false;
  }

  return afterHashes.has(hash);
});

if (newlyApplied.length > 0) {
  console.log(`\n✅ Successfully applied ${newlyApplied.length} migration(s):`);
  for (const entry of newlyApplied) {
    console.log(`   ✓ ${entry.tag}`);
  }
} else {
  console.warn(
    "\n⚠️  No migrations were applied despite pending entries." +
      "\n   This likely means Drizzle skipped them due to 'when' ordering." +
      "\n   Check the 'when' field in _journal.json.\n"
  );
}

console.log();
await sql.end();
