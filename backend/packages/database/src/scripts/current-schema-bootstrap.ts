import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import postgres from "postgres";

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

interface ImperativeObjectStateRow {
  documents_function: boolean;
  documents_trigger: boolean;
  documents_gin_index: boolean;
  storage_function: boolean;
  storage_trigger: boolean;
}

const DEFAULT_MIGRATIONS_FOLDER = resolve(import.meta.dir, "../../migrations");
const DEFAULT_JOURNAL_PATH = resolve(
  DEFAULT_MIGRATIONS_FOLDER,
  "meta/_journal.json",
);
const packageRoot = resolve(import.meta.dir, "../..");

// drizzle-kit push can only materialize objects represented by the declarative
// Drizzle schema. Keep the current runtime definitions for historical raw-SQL
// objects here so a fresh schema is equivalent to one that ran migrations 0083
// and 0218. Historical migration files remain immutable ledger inputs.
const DOCUMENTS_SEARCH_VECTOR_FUNCTION_BODY = `BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('spanish', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('spanish', coalesce(NEW.content, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.content, '')), 'B');
  RETURN NEW;
END;`;

const QUEUE_STORAGE_DELETION_FUNCTION_BODY = `BEGIN
  INSERT INTO public.user_storage_deletions (object_key, owner_user_id)
  VALUES (OLD.object_key, OLD.owner_user_id)
  ON CONFLICT (object_key) DO NOTHING;
  RETURN OLD;
END;`;

const IMPERATIVE_OBJECT_VALIDATION_QUERY = `
  SELECT
    EXISTS (
      SELECT 1
      FROM pg_proc AS procedure
      JOIN pg_language AS language ON language.oid = procedure.prolang
      WHERE procedure.oid = to_regprocedure(
        'public.documents_search_vector_update()'
      )
        AND procedure.prorettype = 'trigger'::regtype
        AND procedure.pronargs = 0
        AND btrim(procedure.prosrc, E' \n\r\t') = btrim($1, E' \n\r\t')
        AND language.lanname = 'plpgsql'
    ) AS documents_function,
    EXISTS (
      SELECT 1
      FROM pg_trigger AS trigger
      JOIN pg_class AS relation ON relation.oid = trigger.tgrelid
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relname = 'documents'
        AND trigger.tgname = 'documents_search_vector_trigger'
        AND trigger.tgfoid = to_regprocedure(
          'public.documents_search_vector_update()'
        )
        AND trigger.tgtype = 23
        AND trigger.tgenabled = 'O'
        AND NOT trigger.tgisinternal
        AND (
          SELECT array_agg(attribute.attname::text ORDER BY attribute.attname)
          FROM unnest(trigger.tgattr::smallint[]) AS trigger_column(attnum)
          JOIN pg_attribute AS attribute
            ON attribute.attrelid = relation.oid
           AND attribute.attnum = trigger_column.attnum
        ) = ARRAY['content', 'title']::text[]
    ) AS documents_trigger,
    EXISTS (
      SELECT 1
      FROM pg_class AS index_relation
      JOIN pg_namespace AS namespace
        ON namespace.oid = index_relation.relnamespace
      JOIN pg_index AS index_metadata
        ON index_metadata.indexrelid = index_relation.oid
      JOIN pg_class AS table_relation
        ON table_relation.oid = index_metadata.indrelid
      JOIN pg_am AS access_method
        ON access_method.oid = index_relation.relam
      WHERE namespace.nspname = 'public'
        AND index_relation.relname = 'documents_search_vector_gin_idx'
        AND table_relation.relname = 'documents'
        AND access_method.amname = 'gin'
        AND index_metadata.indisready
        AND index_metadata.indisvalid
        AND index_metadata.indpred IS NULL
        AND index_metadata.indexprs IS NULL
        AND index_metadata.indnkeyatts = 1
        AND (
          SELECT array_agg(attribute.attname::text ORDER BY index_column.ordinality)
          FROM unnest(index_metadata.indkey::smallint[])
            WITH ORDINALITY AS index_column(attnum, ordinality)
          JOIN pg_attribute AS attribute
            ON attribute.attrelid = table_relation.oid
           AND attribute.attnum = index_column.attnum
          WHERE index_column.ordinality <= index_metadata.indnkeyatts
        ) = ARRAY['search_vector']::text[]
    ) AS documents_gin_index,
    EXISTS (
      SELECT 1
      FROM pg_proc AS procedure
      JOIN pg_language AS language ON language.oid = procedure.prolang
      WHERE procedure.oid = to_regprocedure(
        'public.queue_user_storage_object_deletion()'
      )
        AND procedure.prorettype = 'trigger'::regtype
        AND procedure.pronargs = 0
        AND btrim(procedure.prosrc, E' \n\r\t') = btrim($2, E' \n\r\t')
        AND language.lanname = 'plpgsql'
    ) AS storage_function,
    EXISTS (
      SELECT 1
      FROM pg_trigger AS trigger
      JOIN pg_class AS relation ON relation.oid = trigger.tgrelid
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relname = 'user_storage_objects'
        AND trigger.tgname = 'user_storage_objects_queue_deletion'
        AND trigger.tgfoid = to_regprocedure(
          'public.queue_user_storage_object_deletion()'
        )
        AND trigger.tgtype = 9
        AND trigger.tgenabled = 'O'
        AND NOT trigger.tgisinternal
    ) AS storage_trigger
`;

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

export async function ensureVectorExtension(databaseUrl: string): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await sql`CREATE EXTENSION IF NOT EXISTS vector;`;
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

export async function validateCurrentSchema(
  databaseUrl: string,
  baselineEntry: JournalEntry,
  logPrefix: string,
): Promise<void> {
  const snapshotPath = getSnapshotPathForEntry(baselineEntry);
  const expected = loadExpectedSchemaColumns(snapshotPath);
  const actual = await readActualColumns(databaseUrl);
  const missing = findMissingExpectedColumns(expected, actual);

  if (missing.length === 0) {
    console.log(
      `${logPrefix} Current schema validation passed (${expected.length} columns checked).`,
    );
    return;
  }

  const sample = missing
    .slice(0, 20)
    .map((column) => `${column.schema}.${column.table}.${column.column}`)
    .join("\n  - ");
  const suffix = missing.length > 20 ? `\n  ...and ${missing.length - 20} more` : "";

  throw new Error(
    `Cannot baseline migrations because the database schema is missing ${missing.length} expected column(s):\n  - ${sample}${suffix}`,
  );
}

/**
 * Reconciles raw-SQL objects that drizzle-kit push cannot express, validates
 * their exact runtime contract, and commits them atomically. A validation
 * failure rolls the whole reconciliation back and the caller must not baseline.
 */
export async function materializeCurrentSchemaImperativeObjects(
  databaseUrl: string,
  logPrefix: string,
): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(`
        CREATE OR REPLACE FUNCTION public.documents_search_vector_update()
        RETURNS trigger
        LANGUAGE plpgsql
        SET search_path = pg_catalog, public
        AS $function$
${DOCUMENTS_SEARCH_VECTOR_FUNCTION_BODY}
        $function$
      `);
      await tx.unsafe(`
        DROP TRIGGER IF EXISTS documents_search_vector_trigger
        ON public.documents
      `);
      await tx.unsafe(`
        CREATE TRIGGER documents_search_vector_trigger
        BEFORE INSERT OR UPDATE OF title, content ON public.documents
        FOR EACH ROW
        EXECUTE FUNCTION public.documents_search_vector_update()
      `);
      await tx.unsafe(`
        CREATE INDEX IF NOT EXISTS documents_search_vector_gin_idx
        ON public.documents USING gin (search_vector)
      `);

      await tx.unsafe(`
        CREATE OR REPLACE FUNCTION public.queue_user_storage_object_deletion()
        RETURNS trigger
        LANGUAGE plpgsql
        SET search_path = pg_catalog, public
        AS $function$
${QUEUE_STORAGE_DELETION_FUNCTION_BODY}
        $function$
      `);
      await tx.unsafe(`
        DROP TRIGGER IF EXISTS user_storage_objects_queue_deletion
        ON public.user_storage_objects
      `);
      await tx.unsafe(`
        CREATE TRIGGER user_storage_objects_queue_deletion
        AFTER DELETE ON public.user_storage_objects
        FOR EACH ROW
        EXECUTE FUNCTION public.queue_user_storage_object_deletion()
      `);

      const [state] = (await tx.unsafe(IMPERATIVE_OBJECT_VALIDATION_QUERY, [
        DOCUMENTS_SEARCH_VECTOR_FUNCTION_BODY,
        QUEUE_STORAGE_DELETION_FUNCTION_BODY,
      ])) as unknown as ImperativeObjectStateRow[];
      if (!state) {
        throw new Error(
          "Cannot baseline migrations because imperative object validation returned no state",
        );
      }

      const missing = [
        ["public.documents_search_vector_update()", state.documents_function],
        ["public.documents_search_vector_trigger", state.documents_trigger],
        ["public.documents_search_vector_gin_idx", state.documents_gin_index],
        [
          "public.queue_user_storage_object_deletion()",
          state.storage_function,
        ],
        ["public.user_storage_objects_queue_deletion", state.storage_trigger],
      ]
        .filter(([, valid]) => valid !== true)
        .map(([name]) => name);

      if (missing.length > 0) {
        throw new Error(
          "Cannot baseline migrations because the current schema is missing or " +
            `misconfigured imperative runtime object(s): ${missing.join(", ")}`,
        );
      }
    });

    console.log(
      `${logPrefix} Imperative runtime object validation passed (5 objects checked).`,
    );
  } finally {
    await sql.end();
  }
}

export async function baselineMigrationLedger(
  databaseUrl: string,
  records: MigrationRecord[],
  logPrefix: string,
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
      `${logPrefix} Baseline ledger contains ${records.length} migration record(s).`,
    );
  } finally {
    await sql.end();
  }
}

export async function applyCurrentSchema(
  databaseUrl: string,
  logPrefix: string,
): Promise<void> {
  console.log(`${logPrefix} Applying current schema with drizzle-kit push...`);
  const child = Bun.spawn(["bunx", "drizzle-kit", "push", "--force"], {
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
    throw new Error(
      `Applying current schema with drizzle-kit push failed with exit code ${exitCode}`,
    );
  }
}
