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
import { withMigrationAdvisoryLock } from "./migration-advisory-lock";
import {
  COMPATIBLE_MIGRATION_HASHES,
  planCompatibleMigrationLedgerRepairs,
  type AppliedMigrationRecord,
} from "./migration-compatibility-repair";
import {
  executeObsoleteCursorNormalizations,
  planObsoleteCursorNormalizations,
  toMigrationLedgerRecord,
  type MigrationLedgerRecord,
} from "./migration-cursor-normalization";
import {
  assertPendingMigrationsApplied,
  readMigrationFileHash,
} from "./migration-application-verifier";
import {
  resolveMigrationDatabaseUrl,
  resolveMigrationLockTimeoutMs,
} from "./migration-runtime-config";
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

// Validate the complete journal before connecting or reporting that the
// database is current. A missing/unreadable SQL file is a broken release, not a
// migration that may be silently skipped.
const migrationHashes = new Map(
  entries.map((entry) => [
    entry.tag,
    readMigrationFileHash(migrationsFolder, entry.tag),
  ]),
);

// ── 2. Connect and find pending migrations ──────────────────────────────────
const databaseUrl = resolveMigrationDatabaseUrl(process.env);
const migrationLockTimeoutMs = resolveMigrationLockTimeoutMs(process.env);
const urlParts = new URL(databaseUrl);
console.log(`🔌 Database: ${urlParts.hostname}:${urlParts.port}${urlParts.pathname}`);
console.log(`   Environment: ${process.env.NODE_ENV || "development"}\n`);

// Keep the migrator on a single direct/session-pooled PostgreSQL connection so
// its session advisory lock covers every preflight and migration query. Drizzle
// requires the postgres.js Sql client itself (ReservedSql is not compatible
// with the driver), therefore max: 1 is the connection-affinity boundary.
const sql = postgres(databaseUrl, { max: 1 });
const db = drizzle(sql);

const getMigrationHash = (entry: JournalEntry): string => {
  const hash = migrationHashes.get(entry.tag);
  if (!hash) {
    throw new Error(`No validated SQL hash exists for migration ${entry.tag}`);
  }

  return hash;
};

const loadAppliedHashes = async (): Promise<{
  hashes: Set<string>;
  migrations: MigrationLedgerRecord[];
  hasMigrationsTable: boolean;
}> => {
  const hashes = new Set<string>();

  try {
    const applied = (await sql`
      SELECT id, hash, created_at FROM "drizzle"."__drizzle_migrations" ORDER BY created_at ASC
    `) as Array<{ id: string | number; hash: string; created_at: string | number }>;

    for (const row of applied) {
      hashes.add(row.hash);
    }

    console.log(`📋 Already applied: ${applied.length} migrations in DB`);
    return {
      hashes,
      migrations: applied.map(toMigrationLedgerRecord),
      hasMigrationsTable: true,
    };
  } catch {
    console.log("📋 No __drizzle_migrations table yet (first run)");
    return {
      hashes,
      migrations: [],
      hasMigrationsTable: false,
    };
  }
};

const getPendingEntries = (appliedHashes: Set<string>): JournalEntry[] => {
  const result: JournalEntry[] = [];

  for (const entry of entries) {
    const hash = getMigrationHash(entry);
    if (!appliedHashes.has(hash)) {
      result.push(entry);
    }
  }

  return result;
};

const repairCompatibleMigrationHashes = async (
  appliedMigrations: readonly AppliedMigrationRecord[],
  hasMigrationsTable: boolean
): Promise<boolean> => {
  if (!hasMigrationsTable) {
    return false;
  }

  const repairs = planCompatibleMigrationLedgerRepairs({
    entries,
    migrationHashes,
    compatibleHashes: COMPATIBLE_MIGRATION_HASHES,
    appliedMigrations,
  });

  for (const repair of repairs) {
    if (repair.action === "insert") {
      await sql`
        INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at")
        SELECT ${repair.hash}, ${repair.createdAt}
        WHERE NOT EXISTS (
          SELECT 1
          FROM "drizzle"."__drizzle_migrations"
          WHERE "hash" = ${repair.hash}
        )
      `;
    } else {
      await sql`
        UPDATE "drizzle"."__drizzle_migrations"
        SET "created_at" = ${repair.createdAt}
        WHERE "hash" = ${repair.hash}
          AND "created_at" <> ${repair.createdAt}
      `;
    }

    console.log(
      `🧩 ${repair.action === "insert" ? "Backfilled" : "Repaired"} compatibility hash for ${repair.tag} (legacy hash ${repair.legacyHash.slice(0, 12)}...).`
    );
  }

  return repairs.length > 0;
};

const normalizeObsoleteMigrationCursor = async (
  appliedMigrations: readonly MigrationLedgerRecord[],
  hasMigrationsTable: boolean,
): Promise<boolean> => {
  if (!hasMigrationsTable) {
    return false;
  }

  const repairs = planObsoleteCursorNormalizations({
    entries,
    migrationHashes,
    appliedMigrations,
  });

  await executeObsoleteCursorNormalizations(repairs, async (repair) => {
    const updated = await sql<Array<{ id: number }>>`
      UPDATE "drizzle"."__drizzle_migrations"
      SET "created_at" = ${repair.createdAt}
      WHERE "id" = ${repair.id}
        AND "hash" = ${repair.hash}
        AND "created_at" = ${repair.expectedCreatedAt}
      RETURNING "id"
    `;
    return updated;
  });
  for (const repair of repairs) {
    console.log(
      `🧩 Normalized obsolete migration ledger row ${repair.id} before ${entries.at(-1)?.tag}.`,
    );
  }

  return repairs.length > 0;
};

try {
  await withMigrationAdvisoryLock(
    async (statement, parameters) => {
      return (await sql.unsafe(statement, parameters)) as unknown as Array<
        Record<string, unknown>
      >;
    },
    async () => {
      // Keep pristine-state detection, validation, exact ledger baseline and
      // the normal append-only migration path inside one session
      // advisory-lock critical section. Self-hosted empty-database bootstrap
      // runs upstream of this script (see self-hosted-db-maintenance.ts); by
      // the time this script runs, a migration ledger is expected to exist.
      let appliedState = await loadAppliedHashes();
      if (
        await repairCompatibleMigrationHashes(
          appliedState.migrations,
          appliedState.hasMigrationsTable,
        )
      ) {
        appliedState = await loadAppliedHashes();
      }
      if (
        await normalizeObsoleteMigrationCursor(
          appliedState.migrations,
          appliedState.hasMigrationsTable,
        )
      ) {
        appliedState = await loadAppliedHashes();
      }
      const pendingEntries = getPendingEntries(appliedState.hashes);
      const initiallyPendingMigrations = pendingEntries.map((entry) => ({
        tag: entry.tag,
        hash: getMigrationHash(entry),
      }));

      if (pendingEntries.length === 0) {
        console.log("✅ No pending migrations. Database is up to date.\n");
        return;
      }

      console.log(`⏳ Pending: ${pendingEntries.length} migration(s) to apply:\n`);
      for (const entry of pendingEntries) {
        console.log(`   → ${entry.tag} (idx ${entry.idx})`);
      }
      console.log();

      await maybeRunBugFixAttemptPreflight({
        pendingMigrationTags: pendingEntries.map((entry) => entry.tag),
        executeInTransaction: async <T>(
          callback: (
            execute: (statement: string) => Promise<unknown>,
          ) => Promise<T>,
        ) =>
          (await sql.begin(async (tx) =>
            callback(
              (statement) => tx.unsafe(statement) as Promise<unknown>,
            ))) as T,
        log: (message) => console.log(message),
      });

      await maybeRunVectorExtensionPreflight({
        pendingMigrationTags: pendingEntries.map((entry) => entry.tag),
        execute: (statement) => sql.unsafe(statement) as Promise<unknown>,
        log: (message) => console.log(message),
      });

      // ── 3. Run migrations ─────────────────────────────────────────────────
      // WARNING: drizzle-orm's `migrate()` applies every pending migration in
      // this batch inside ONE database transaction. Never ship a deploy batch
      // that combines an enum `ADD VALUE` migration with a later
      // migration/DML in the SAME batch that consumes that new value —
      // Postgres forbids reading an enum value added earlier in the same
      // transaction (error 55P04). Split them across separate deploys.
      try {
        await migrate(db, { migrationsFolder });
      } catch (error) {
        console.error("\n❌ Migration failed:\n", error);
        throw error;
      }

      // ── 4. Verify what was applied ────────────────────────────────────────
      const afterApplied = (await sql`
        SELECT hash, created_at FROM "drizzle"."__drizzle_migrations" ORDER BY created_at ASC
      `) as Array<{ hash: string }>;
      const afterHashes = new Set(afterApplied.map((row) => row.hash));
      const newlyApplied = assertPendingMigrationsApplied(
        initiallyPendingMigrations,
        afterHashes,
      );

      console.log(
        `\n✅ Successfully applied ${newlyApplied.length} migration(s):`,
      );
      for (const entry of newlyApplied) {
        console.log(`   ✓ ${entry.tag}`);
      }

      console.log();
    },
    {
      timeoutMs: migrationLockTimeoutMs,
      onUnlockError: (error) => {
        console.error(
          "Failed to release migration advisory lock after migration error:",
          error,
        );
      },
    },
  );
} finally {
  await sql.end();
}
