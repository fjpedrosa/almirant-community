/**
 * Force-apply a migration that Drizzle skipped because later migrations were already applied.
 *
 * Usage:
 *   NODE_ENV=production bun run --env-file .env src/scripts/force-apply-migration.ts 0156_email_delivery_tracking
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { createHash } from "crypto";
import postgres from "postgres";

const tag = process.argv[2];
if (!tag) {
  console.error("Usage: bun run src/scripts/force-apply-migration.ts <migration-tag>");
  console.error("Example: bun run src/scripts/force-apply-migration.ts 0156_email_delivery_tracking");
  process.exit(1);
}

const migrationsFolder = resolve(import.meta.dir, "../../migrations");
const sqlPath = resolve(migrationsFolder, `${tag}.sql`);

let sqlContent: string;
try {
  sqlContent = readFileSync(sqlPath, "utf-8");
} catch {
  console.error(`❌ Migration file not found: ${sqlPath}`);
  process.exit(1);
}

const hash = createHash("sha256").update(sqlContent).digest("hex");
const databaseUrl = process.env.DATABASE_URL!;
const urlParts = new URL(databaseUrl);

console.log(`🔌 Database: ${urlParts.hostname}:${urlParts.port}${urlParts.pathname}`);
console.log(`   Environment: ${process.env.NODE_ENV || "development"}\n`);
console.log(`📄 Migration: ${tag}`);
console.log(`   Hash: ${hash}\n`);

const sql = postgres(databaseUrl, { max: 1 });

// Check if already applied
const existing = await sql`
  SELECT hash FROM "drizzle"."__drizzle_migrations" WHERE hash = ${hash}
`;

if (existing.length > 0) {
  console.log("✅ Migration already recorded in DB. Nothing to do.");
  await sql.end();
  process.exit(0);
}

// Parse SQL statements (split by breakpoint markers)
const statements = sqlContent
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

console.log(`⏳ Applying ${statements.length} statement(s)...\n`);

try {
  await sql.begin(async (tx) => {
    for (const stmt of statements) {
      await tx.unsafe(stmt);
    }
    // Record the migration
    await tx.unsafe(
      `INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES ($1, $2)`,
      [hash, Date.now()],
    );
  });

  console.log(`✅ Migration ${tag} applied and recorded successfully.`);
} catch (err) {
  console.error("❌ Migration failed:\n", err);
  await sql.end();
  process.exit(1);
}

await sql.end();
