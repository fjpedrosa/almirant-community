/**
 * Repair script for partially applied migration 0135 (rename openai_compatible to zai).
 *
 * The programmatic migrate() recorded 0135 as applied but the SQL failed midway.
 * This script checks each change and applies what's missing, skipping tables
 * that don't exist in the target database.
 *
 * Usage:
 *   bun run --env-file .env src/scripts/repair-0135-zai-rename.ts
 */
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

console.log("🔧 Repairing partially applied migration 0135 (openai_compatible → zai)\n");

// Helper: check if a table exists
const tableExists = async (table: string): Promise<boolean> => {
  const result = await sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${table}
    ) as exists
  `;
  return result[0].exists;
};

// ── Step 1: Update ai_provider enum tables (openai-compatible → zai) ────────
console.log("Step 1: Updating ai_provider enum values...");
const aiProviderTables = [
  "ai_sessions",
  "provider_quotas",
  "quota_usage_periods",
  "oauth_states",
];

for (const table of aiProviderTables) {
  if (!(await tableExists(table))) {
    console.log(`  ⏭️  ${table}: table does not exist, skipping`);
    continue;
  }
  const rows = await sql`
    SELECT count(*)::int as n FROM ${sql(table)} WHERE provider = 'openai-compatible'
  `;
  if (rows[0].n > 0) {
    await sql`UPDATE ${sql(table)} SET provider = 'zai' WHERE provider = 'openai-compatible'`;
    console.log(`  ✅ ${table}: updated ${rows[0].n} rows`);
  } else {
    console.log(`  ⏭️  ${table}: already clean`);
  }
}

// ── Step 2: Add 'zai' to provider_type enum if missing ──────────────────────
console.log("\nStep 2: Checking provider_type enum...");
const enumCheck = await sql`
  SELECT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'provider_type' AND e.enumlabel = 'zai'
  ) as has_zai
`;

if (!enumCheck[0].has_zai) {
  await sql.unsafe(`ALTER TYPE "provider_type" ADD VALUE IF NOT EXISTS 'zai'`);
  console.log(`  ✅ Added 'zai' to provider_type enum`);
} else {
  console.log(`  ⏭️  'zai' already exists in provider_type enum`);
}

// ── Step 3: Update provider_connections (openai_compatible → zai) ────────────
console.log("\nStep 3: Updating provider_connections...");
if (await tableExists("provider_connections")) {
  const connRows = await sql`
    SELECT count(*)::int as n FROM provider_connections WHERE provider = 'openai_compatible'
  `;
  if (connRows[0].n > 0) {
    await sql`UPDATE provider_connections SET provider = 'zai' WHERE provider = 'openai_compatible'`;
    console.log(`  ✅ Updated ${connRows[0].n} rows`);
  } else {
    console.log(`  ⏭️  Already clean`);
  }
} else {
  console.log(`  ⏭️  provider_connections table does not exist, skipping`);
}

console.log("\n✅ Repair complete.\n");
await sql.end();
