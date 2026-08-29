/**
 * Real-DB integration coverage for materializeCurrentSchemaImperativeObjects.
 *
 * Ported from almirant-cloud's cloud-database-bootstrap.db.test.ts, scoped
 * down to only the materialize primitive: community has no equivalent to
 * cloud's cloud-database-bootstrap.ts / migrate-with-validation.ts empty-db
 * bootstrap flow (self-hosted installs go through self-hosted-db-maintenance.ts
 * instead), so the concurrent-initializer and partial-schema scenarios from
 * cloud's suite are out of scope here. Builds a minimal fixture schema with
 * raw SQL instead of running drizzle-kit push against the full community
 * schema, since exercising the declarative schema end-to-end is unrelated to
 * what this primitive is responsible for.
 *
 * Destructive opt-in coverage, gated behind a dedicated, safety-checked local
 * database URL so `bun test` never touches the shared dev database. Auto-skips
 * when SELF_HOSTED_BOOTSTRAP_TEST_DATABASE_URL is unset.
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import { materializeCurrentSchemaImperativeObjects } from "./current-schema-bootstrap";

const databaseUrl = process.env.SELF_HOSTED_BOOTSTRAP_TEST_DATABASE_URL?.trim();
const parsedDatabaseUrl = databaseUrl ? new URL(databaseUrl) : null;
const databaseName = parsedDatabaseUrl?.pathname.slice(1) ?? "";
const isSafeDedicatedDatabase =
  parsedDatabaseUrl !== null &&
  ["127.0.0.1", "localhost"].includes(parsedDatabaseUrl.hostname) &&
  databaseName.startsWith("almirant_schema_bootstrap_test");
const integrationTest = isSafeDedicatedDatabase ? test : test.skip;

// The generated journal grows with every migration, so this hash must be bumped
// whenever drizzle-kit appends an entry.
const migrationJournal0234Hash =
  "a11bc9ef73270057629bdd9a300eacd2624bedf511c94091d1f05da21eb1eb84";

interface ImperativeObjectState {
  documentsFunction: boolean;
  documentsTrigger: boolean;
  documentsGinIndex: boolean;
  storageFunction: boolean;
  storageTrigger: boolean;
}

const requireTestDatabaseUrl = (): string => {
  if (!databaseUrl || !isSafeDedicatedDatabase) {
    throw new Error(
      "SELF_HOSTED_BOOTSTRAP_TEST_DATABASE_URL must target a dedicated local " +
        "database named almirant_schema_bootstrap_test*",
    );
  }
  return databaseUrl;
};

const withSql = async <T>(
  callback: (sql: postgres.Sql) => Promise<T>,
): Promise<T> => {
  const sql = postgres(requireTestDatabaseUrl(), {
    max: 1,
    onnotice: () => {},
  });
  try {
    return await callback(sql);
  } finally {
    await sql.end();
  }
};

const resetDatabase = async (): Promise<void> => {
  if (!isSafeDedicatedDatabase) {
    return;
  }

  await withSql(async (sql) => {
    await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE");
    await sql.unsafe("CREATE SCHEMA public");
  });
};

/**
 * Only the tables the materialize primitive's raw SQL touches. Community's
 * full declarative schema is irrelevant to this primitive-level test.
 */
const createFixtureSchema = async (): Promise<void> => {
  await withSql(async (sql) => {
    await sql.unsafe(`
      CREATE TABLE public.documents (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        title text NOT NULL,
        content text,
        search_vector tsvector
      )
    `);
    await sql.unsafe(`
      CREATE TABLE public.user_storage_deletions (
        object_key text PRIMARY KEY,
        owner_user_id text NOT NULL
      )
    `);
    await sql.unsafe(`
      CREATE TABLE public.user_storage_objects (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_user_id text NOT NULL,
        object_key text NOT NULL UNIQUE
      )
    `);
  });
};

const readImperativeObjectState = async (): Promise<ImperativeObjectState> =>
  withSql(async (sql) => {
    const [state] = await sql<
      Array<{
        documents_function: boolean;
        documents_trigger: boolean;
        documents_gin_index: boolean;
        storage_function: boolean;
        storage_trigger: boolean;
      }>
    >`
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
            AND index_metadata.indisvalid
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

    return {
      documentsFunction: state?.documents_function === true,
      documentsTrigger: state?.documents_trigger === true,
      documentsGinIndex: state?.documents_gin_index === true,
      storageFunction: state?.storage_function === true,
      storageTrigger: state?.storage_trigger === true,
    };
  });

const assertRuntimeObjectBehavior = async (): Promise<void> => {
  await withSql(async (sql) => {
    const ownerUserId = "schema-bootstrap-runtime-owner";
    const objectKey = "schema-bootstrap/runtime-object.txt";

    await sql`
      INSERT INTO public.user_storage_objects (owner_user_id, object_key)
      VALUES (${ownerUserId}, ${objectKey})
    `;
    await sql`
      DELETE FROM public.user_storage_objects
      WHERE object_key = ${objectKey}
    `;

    const [queuedDeletion] = await sql<
      Array<{ object_key: string; owner_user_id: string }>
    >`
      SELECT object_key, owner_user_id
      FROM public.user_storage_deletions
      WHERE object_key = ${objectKey}
    `;
    expect(queuedDeletion).toEqual({
      object_key: objectKey,
      owner_user_id: ownerUserId,
    });

    const [document] = await sql<
      Array<{ has_search_vector: boolean; matches_search: boolean }>
    >`
      INSERT INTO public.documents (title, content)
      VALUES ('Arquitectura resiliente', 'Bootstrap fiable')
      RETURNING
        search_vector IS NOT NULL AS has_search_vector,
        search_vector @@ plainto_tsquery('spanish', 'arquitectura')
          AS matches_search
    `;
    expect(document).toEqual({
      has_search_vector: true,
      matches_search: true,
    });
  });
};

describe("materializeCurrentSchemaImperativeObjects (real DB)", () => {
  beforeEach(async () => {
    await resetDatabase();
    if (isSafeDedicatedDatabase) {
      await createFixtureSchema();
    }
  });
  afterAll(resetDatabase);

  integrationTest(
    "reconciles imperative runtime objects idempotently",
    async () => {
      await materializeCurrentSchemaImperativeObjects(
        requireTestDatabaseUrl(),
        "[self-hosted-db-test]",
      );
      await materializeCurrentSchemaImperativeObjects(
        requireTestDatabaseUrl(),
        "[self-hosted-db-test]",
      );

      expect(await readImperativeObjectState()).toEqual({
        documentsFunction: true,
        documentsTrigger: true,
        documentsGinIndex: true,
        storageFunction: true,
        storageTrigger: true,
      });
      await assertRuntimeObjectBehavior();
    },
    30_000,
  );

  integrationTest(
    "rolls back every imperative object when catalog validation fails",
    async () => {
      await materializeCurrentSchemaImperativeObjects(
        requireTestDatabaseUrl(),
        "[self-hosted-db-test]",
      );

      await withSql(async (sql) => {
        await sql.unsafe(`
          DROP TRIGGER documents_search_vector_trigger ON public.documents;
          DROP TRIGGER user_storage_objects_queue_deletion
            ON public.user_storage_objects;
          DROP FUNCTION public.documents_search_vector_update();
          DROP FUNCTION public.queue_user_storage_object_deletion();
          DROP INDEX public.documents_search_vector_gin_idx;
          CREATE INDEX documents_search_vector_gin_idx
            ON public.user_storage_deletions USING btree (object_key);
        `);
      });

      await expect(
        materializeCurrentSchemaImperativeObjects(
          requireTestDatabaseUrl(),
          "[self-hosted-db-test]",
        ),
      ).rejects.toThrow("public.documents_search_vector_gin_idx");

      expect(await readImperativeObjectState()).toEqual({
        documentsFunction: false,
        documentsTrigger: false,
        documentsGinIndex: false,
        storageFunction: false,
        storageTrigger: false,
      });
    },
    30_000,
  );
});

test("pins generated migration journal bytes through 0234", () => {
  const contents = readFileSync(
    resolve(import.meta.dir, "../..", "migrations/meta/_journal.json"),
    "utf8",
  );
  expect(createHash("sha256").update(contents).digest("hex")).toBe(
    migrationJournal0234Hash,
  );
});
