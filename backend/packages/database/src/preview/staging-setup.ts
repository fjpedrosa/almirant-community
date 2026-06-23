/**
 * Staging database setup.
 *
 * Creates (or resets) the persistent `almirant_staging` database on the
 * preview PostgreSQL server.  Unlike preview databases, staging is NOT
 * prefixed with `preview_` so the daily cleanup job leaves it alone.
 *
 * Schema is cloned from production via pg_dump (schema-only) to avoid
 * drizzle-kit migration ordering issues when applying 100+ migrations
 * from scratch.
 *
 * Usage:
 *   DATABASE_URL=<preview-pg-url> PRODUCTION_DATABASE_URL=<prod-pg-url> bun run src/preview/staging-setup.ts [--reset]
 */

import postgres from "postgres";
import { seedPreviewData } from "./preview-seed";

const STAGING_DB_NAME = "almirant_staging";

function connectionUrlForDb(baseUrl: string, dbName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${dbName}`;
  return url.toString();
}

function maintenanceUrl(baseUrl: string): string {
  return connectionUrlForDb(baseUrl, "postgres");
}

async function setupStagingDb(databaseUrl: string, productionUrl: string, reset: boolean) {
  const maintClient = postgres(maintenanceUrl(databaseUrl), { max: 1 });

  try {
    const existing = await maintClient`
      SELECT 1 FROM pg_database WHERE datname = ${STAGING_DB_NAME}
    `;

    if (existing.length > 0 && reset) {
      console.log(`[staging] Dropping existing ${STAGING_DB_NAME}...`);
      await maintClient`
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = ${STAGING_DB_NAME} AND pid <> pg_backend_pid()
      `;
      await maintClient.unsafe(`DROP DATABASE "${STAGING_DB_NAME}"`);
      console.log(`[staging] Dropped.`);
    } else if (existing.length > 0) {
      console.log(`[staging] Database ${STAGING_DB_NAME} already exists. Use --reset to recreate.`);
      return;
    }

    console.log(`[staging] Creating database: ${STAGING_DB_NAME}`);
    await maintClient.unsafe(`CREATE DATABASE "${STAGING_DB_NAME}"`);
    console.log(`[staging] Database created.`);
  } finally {
    await maintClient.end();
  }

  // Clone schema from production via pg_dump | psql
  const stagingDbUrl = connectionUrlForDb(databaseUrl, STAGING_DB_NAME);
  console.log(`[staging] Cloning schema from production...`);

  const dumpResult = Bun.spawnSync(
    ["sh", "-c", `pg_dump --schema-only "${productionUrl}" | psql "${stagingDbUrl}"`],
    { stdout: "pipe", stderr: "pipe" }
  );

  if (dumpResult.exitCode !== 0) {
    const stderr = dumpResult.stderr.toString();
    // Ignore role ownership errors (production user doesn't exist on preview server)
    const fatalErrors = stderr.split("\n").filter(
      (line) => line.startsWith("ERROR:") && !line.includes("role") && !line.includes("does not exist")
    );
    if (fatalErrors.length > 0) {
      console.error(`[staging] Schema clone failed:\n${fatalErrors.join("\n")}`);
      process.exit(1);
    }
  }

  console.log(`[staging] Schema cloned successfully.`);

  // Seed with demo data
  console.log(`[staging] Seeding...`);
  await seedPreviewData(stagingDbUrl);

  console.log(`\n[staging] Staging database ready!`);
  console.log(`[staging] Connection URL: ${stagingDbUrl}`);
}

// CLI
const args = process.argv.slice(2);
const reset = args.includes("--reset");

const databaseUrl = process.env.DATABASE_URL;
const productionUrl = process.env.PRODUCTION_DATABASE_URL;

if (!databaseUrl) {
  console.error("[staging] ERROR: DATABASE_URL is required (preview PostgreSQL server).");
  process.exit(1);
}
if (!productionUrl) {
  console.error("[staging] ERROR: PRODUCTION_DATABASE_URL is required (source for schema).");
  process.exit(1);
}

setupStagingDb(databaseUrl, productionUrl, reset)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[staging] Setup failed:", err);
    process.exit(1);
  });
