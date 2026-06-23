/**
 * Baseline all migrations as applied without running their SQL.
 *
 * Use this when the DB schema is already in sync (e.g. after `db:push`) but
 * `__drizzle_migrations` is empty, so `db:migrate` would try to re-run everything.
 *
 * Reads `meta/_journal.json`, hashes each migration SQL file, and inserts into
 * `drizzle.__drizzle_migrations` only the rows that don't already exist.
 *
 * Usage:
 *   bun run --env-file .env.local src/scripts/baseline-all-migrations.ts
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { createHash } from "crypto";
import postgres from "postgres";

const migrationsFolder = resolve(import.meta.dir, "../../migrations");
const journalPath = resolve(migrationsFolder, "meta/_journal.json");

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

const journal: { entries: JournalEntry[] } = JSON.parse(
  readFileSync(journalPath, "utf-8"),
);

const databaseUrl = process.env.DATABASE_URL!;
const urlParts = new URL(databaseUrl);
console.log(`🔌 ${urlParts.hostname}:${urlParts.port}${urlParts.pathname}`);
console.log(`📓 ${journal.entries.length} entries in _journal.json\n`);

const sql = postgres(databaseUrl, { max: 1 });

// Ensure migrations schema/table exist (no-op if already there)
await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
await sql.unsafe(`
  CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at bigint
  )
`);

const existing = await sql<{ hash: string }[]>`
  SELECT hash FROM "drizzle"."__drizzle_migrations"
`;
const existingHashes = new Set(existing.map((r) => r.hash));
console.log(`📋 ${existingHashes.size} migration(s) already recorded.`);

let inserted = 0;
let skipped = 0;
for (const entry of journal.entries) {
  const sqlPath = resolve(migrationsFolder, `${entry.tag}.sql`);
  const content = readFileSync(sqlPath, "utf-8");
  const hash = createHash("sha256").update(content).digest("hex");

  if (existingHashes.has(hash)) {
    skipped++;
    continue;
  }

  await sql`
    INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at)
    VALUES (${hash}, ${entry.when})
  `;
  inserted++;
}

console.log(`\n✅ Baseline complete.`);
console.log(`   Inserted: ${inserted}`);
console.log(`   Already present: ${skipped}`);

await sql.end();
