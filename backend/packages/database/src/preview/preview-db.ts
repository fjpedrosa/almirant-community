/**
 * Preview database management CLI.
 *
 * Creates, destroys, resets, lists, and cleans up isolated preview databases
 * (one per branch) on the same PostgreSQL server defined by DATABASE_URL.
 *
 * Usage:
 *   bun run src/preview/preview-db.ts create  <branch-name>
 *   bun run src/preview/preview-db.ts destroy <branch-name>
 *   bun run src/preview/preview-db.ts reset   <branch-name>
 *   bun run src/preview/preview-db.ts list
 *   bun run src/preview/preview-db.ts cleanup-stale [--max-age-days=N]
 *   bun run src/preview/preview-db.ts stats
 */

import postgres from "postgres";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PREVIEW_PREFIX = "preview_";
const DEFAULT_MAX_AGE_DAYS = 7;

/** Metadata stored as a COMMENT ON DATABASE in JSON format. */
interface PreviewMetadata {
  createdAt: string;
  branch: string;
  prNumber?: string;
}

/** Sanitize a branch name into a valid Postgres database name. */
function sanitizeBranchName(branch: string): string {
  return (
    PREVIEW_PREFIX +
    branch
      .toLowerCase()
      .replace(/[/\-\.]/g, "_") // replace /, -, . with _
      .replace(/[^a-z0-9_]/g, "") // strip anything else
      .replace(/_+/g, "_") // collapse consecutive underscores
      .replace(/^_|_$/g, "") // trim leading/trailing underscores
      .slice(0, 63 - PREVIEW_PREFIX.length) // Postgres 63-char limit
  );
}

/** Build a connection URL pointing to a specific database on the same server. */
function connectionUrlForDb(baseUrl: string, dbName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${dbName}`;
  return url.toString();
}

/** Extract the maintenance "postgres" DB URL from DATABASE_URL. */
function maintenanceUrl(baseUrl: string): string {
  return connectionUrlForDb(baseUrl, "postgres");
}

/** Parse --max-age-days=N from CLI arguments. */
function parseMaxAgeDays(args: string[]): number {
  for (const arg of args) {
    const match = arg.match(/^--max-age-days=(\d+)$/);
    if (match) {
      return parseInt(match[1], 10);
    }
  }
  return DEFAULT_MAX_AGE_DAYS;
}

/** Parse --pr-number=N from CLI arguments. */
function parsePrNumber(args: string[]): string | undefined {
  for (const arg of args) {
    const match = arg.match(/^--pr-number=(.+)$/);
    if (match) {
      return match[1];
    }
  }
  return undefined;
}

/** Store metadata as a COMMENT ON DATABASE. */
async function setDatabaseMetadata(
  maintClient: postgres.Sql,
  dbName: string,
  metadata: PreviewMetadata
): Promise<void> {
  const comment = JSON.stringify(metadata);
  await maintClient.unsafe(`COMMENT ON DATABASE "${dbName}" IS '${comment.replace(/'/g, "''")}'`);
}

/** Read metadata from a database comment. Returns null if no metadata found. */
async function getDatabaseMetadata(
  maintClient: postgres.Sql,
  dbName: string
): Promise<PreviewMetadata | null> {
  const result = await maintClient`
    SELECT pg_catalog.shobj_description(oid, 'pg_database') as comment
    FROM pg_database
    WHERE datname = ${dbName}
  `;

  if (result.length === 0 || !result[0].comment) {
    return null;
  }

  try {
    return JSON.parse(result[0].comment) as PreviewMetadata;
  } catch {
    return null;
  }
}

/** Format a duration in days into a human-readable string. */
function formatAge(days: number): string {
  if (days < 1) return "< 1 day";
  if (days === 1) return "1 day";
  return `${Math.floor(days)} days`;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function createPreviewDb(branch: string, databaseUrl: string) {
  const dbName = sanitizeBranchName(branch);
  const prNumber = parsePrNumber(process.argv.slice(2));
  console.log(`[preview] Creating database: ${dbName}`);

  // Connect to maintenance DB to create the new database
  const maintClient = postgres(maintenanceUrl(databaseUrl), {
    max: 1,
    // CREATE DATABASE cannot run inside a transaction
    // postgres.js by default wraps in transactions for tagged template queries,
    // so we use unsafe() below
  });

  try {
    // Check if database already exists
    const existing = await maintClient`
      SELECT 1 FROM pg_database WHERE datname = ${dbName}
    `;
    if (existing.length > 0) {
      console.log(`[preview] Database ${dbName} already exists. Skipping creation.`);
    } else {
      // Terminate connections to staging template (required for TEMPLATE to work)
      await maintClient`
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = 'almirant_staging' AND pid <> pg_backend_pid()
      `;
      // Clone from almirant_staging (copies schema + seed data in one step)
      await maintClient.unsafe(`CREATE DATABASE "${dbName}" TEMPLATE "almirant_staging"`);
      console.log(`[preview] Database ${dbName} created from almirant_staging template.`);
    }

    // Store metadata as a database comment
    const metadata: PreviewMetadata = {
      createdAt: new Date().toISOString(),
      branch,
      ...(prNumber ? { prNumber } : {}),
    };
    await setDatabaseMetadata(maintClient, dbName, metadata);
    console.log(`[preview] Metadata stored: created at ${metadata.createdAt}`);
  } finally {
    await maintClient.end();
  }

  // TEMPLATE already copies schema + seed data from almirant_staging
  const previewDbUrl = connectionUrlForDb(databaseUrl, dbName);
  console.log(`[preview] Preview database ready: ${dbName}`);
  console.log(`[preview] Connection URL: ${previewDbUrl}`);
}

async function destroyPreviewDb(branch: string, databaseUrl: string) {
  const dbName = sanitizeBranchName(branch);
  console.log(`[preview] Destroying database: ${dbName}`);

  const maintClient = postgres(maintenanceUrl(databaseUrl), { max: 1 });

  try {
    // Check if database exists
    const existing = await maintClient`
      SELECT 1 FROM pg_database WHERE datname = ${dbName}
    `;
    if (existing.length === 0) {
      console.log(`[preview] Database ${dbName} does not exist. Nothing to destroy.`);
      return;
    }

    // Terminate active connections
    await maintClient`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = ${dbName} AND pid <> pg_backend_pid()
    `;

    // Drop database
    await maintClient.unsafe(`DROP DATABASE "${dbName}"`);
    console.log(`[preview] Database ${dbName} dropped.`);
  } finally {
    await maintClient.end();
  }
}

async function resetPreviewDb(branch: string, databaseUrl: string) {
  const dbName = sanitizeBranchName(branch);
  console.log(`[preview] Resetting database: ${dbName}`);

  const previewDbUrl = connectionUrlForDb(databaseUrl, dbName);
  const client = postgres(previewDbUrl, { max: 1 });

  try {
    // Check if database exists by attempting connection
    await client`SELECT 1`;
  } catch {
    console.error(`[preview] Database ${dbName} does not exist. Create it first with: preview:create ${branch}`);
    await client.end();
    process.exit(1);
  }

  try {
    // Truncate all tables in the public schema respecting FK order.
    // Using TRUNCATE ... CASCADE handles dependency ordering automatically.
    console.log(`[preview] Truncating all tables...`);
    const tables = await client`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `;

    if (tables.length > 0) {
      const tableNames = tables.map((t) => `"${t.tablename}"`).join(", ");
      await client.unsafe(`TRUNCATE TABLE ${tableNames} CASCADE`);
      console.log(`[preview] Truncated ${tables.length} tables.`);
    }
  } finally {
    await client.end();
  }

  // Re-seed: reset previously invoked a `seedPreviewData` helper that no
  // longer exists. Preview databases are seeded from the staging template
  // at CREATE time, so reset now expects the caller to recreate the DB
  // (destroy + create) when fresh data is needed. Leaving a warning so
  // anyone running `reset` notices.
  console.warn(
    `[preview] Reset completed without re-seeding. To get a fresh dataset run destroy + create for ${dbName}.`,
  );
  void previewDbUrl;

  console.log(`[preview] Database ${dbName} reset complete.`);
}

async function listPreviewDbs(databaseUrl: string) {
  const maintClient = postgres(maintenanceUrl(databaseUrl), { max: 1 });

  try {
    const dbs = await maintClient`
      SELECT
        d.datname,
        pg_database_size(d.datname) as size_bytes,
        pg_catalog.shobj_description(d.oid, 'pg_database') as comment
      FROM pg_database d
      WHERE d.datname LIKE 'preview_%'
      ORDER BY d.datname
    `;

    if (dbs.length === 0) {
      console.log("[preview] No preview databases found.");
      return;
    }

    console.log(`[preview] Found ${dbs.length} preview database(s):\n`);
    for (const db of dbs) {
      const sizeMb = (Number(db.size_bytes) / (1024 * 1024)).toFixed(2);
      let metaInfo = "";

      if (db.comment) {
        try {
          const meta = JSON.parse(db.comment) as PreviewMetadata;
          const createdAt = new Date(meta.createdAt);
          const ageDays = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
          metaInfo = ` | branch: ${meta.branch} | created: ${createdAt.toISOString().split("T")[0]} | age: ${formatAge(ageDays)}`;
          if (meta.prNumber) {
            metaInfo += ` | PR #${meta.prNumber}`;
          }
        } catch {
          // ignore malformed comments
        }
      }

      console.log(`  - ${db.datname} (${sizeMb} MB)${metaInfo}`);
    }
  } finally {
    await maintClient.end();
  }
}

async function cleanupStalePreviewDbs(databaseUrl: string, maxAgeDays: number) {
  console.log(`[preview] Cleaning up preview databases older than ${maxAgeDays} days...\n`);

  const maintClient = postgres(maintenanceUrl(databaseUrl), { max: 1 });

  try {
    const dbs = await maintClient`
      SELECT
        d.datname,
        pg_database_size(d.datname) as size_bytes,
        pg_catalog.shobj_description(d.oid, 'pg_database') as comment,
        s.stats_reset
      FROM pg_database d
      LEFT JOIN pg_stat_database s ON s.datname = d.datname
      WHERE d.datname LIKE 'preview_%'
      ORDER BY d.datname
    `;

    if (dbs.length === 0) {
      console.log("[preview] No preview databases found. Nothing to clean up.");
      return;
    }

    const now = Date.now();
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    let cleaned = 0;
    let kept = 0;

    for (const db of dbs) {
      const dbName = db.datname as string;
      let createdAt: Date | null = null;

      // Try to read creation time from metadata comment
      if (db.comment) {
        try {
          const meta = JSON.parse(db.comment) as PreviewMetadata;
          createdAt = new Date(meta.createdAt);
        } catch {
          // ignore malformed comments
        }
      }

      // If no metadata, fall back to stats_reset as a rough proxy,
      // or treat the DB as stale (no metadata = old/unknown)
      if (!createdAt) {
        if (db.stats_reset) {
          createdAt = new Date(db.stats_reset as string);
        } else {
          // No metadata and no stats — treat as stale
          console.log(`  [stale]   ${dbName} — no metadata, assuming stale`);
          await destroyPreviewDbByName(maintClient, dbName);
          cleaned++;
          continue;
        }
      }

      const ageMs = now - createdAt.getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);

      if (ageMs > maxAgeMs) {
        const sizeMb = (Number(db.size_bytes) / (1024 * 1024)).toFixed(2);
        console.log(`  [stale]   ${dbName} — age: ${formatAge(ageDays)}, size: ${sizeMb} MB — destroying`);
        await destroyPreviewDbByName(maintClient, dbName);
        cleaned++;
      } else {
        console.log(`  [active]  ${dbName} — age: ${formatAge(ageDays)} — keeping`);
        kept++;
      }
    }

    console.log(`\n[preview] Cleanup complete: ${cleaned} destroyed, ${kept} kept.`);
  } finally {
    await maintClient.end();
  }
}

/** Destroy a preview database by its exact name (no branch sanitization). */
async function destroyPreviewDbByName(
  maintClient: postgres.Sql,
  dbName: string
): Promise<void> {
  // Terminate active connections
  await maintClient`
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = ${dbName} AND pid <> pg_backend_pid()
  `;

  // Drop database
  await maintClient.unsafe(`DROP DATABASE "${dbName}"`);
  console.log(`  [dropped] ${dbName}`);
}

async function showStats(databaseUrl: string) {
  const maintClient = postgres(maintenanceUrl(databaseUrl), { max: 1 });

  try {
    const dbs = await maintClient`
      SELECT
        d.datname,
        pg_database_size(d.datname) as size_bytes,
        pg_catalog.shobj_description(d.oid, 'pg_database') as comment
      FROM pg_database d
      WHERE d.datname LIKE 'preview_%'
      ORDER BY d.datname
    `;

    if (dbs.length === 0) {
      console.log("[preview] No preview databases found.");
      return;
    }

    let totalSize = 0;
    let oldest: { name: string; date: Date } | null = null;
    let newest: { name: string; date: Date } | null = null;
    const stale: string[] = [];
    const now = Date.now();
    const staleThresholdMs = DEFAULT_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

    for (const db of dbs) {
      totalSize += Number(db.size_bytes);

      if (db.comment) {
        try {
          const meta = JSON.parse(db.comment) as PreviewMetadata;
          const createdAt = new Date(meta.createdAt);

          if (!oldest || createdAt < oldest.date) {
            oldest = { name: db.datname, date: createdAt };
          }
          if (!newest || createdAt > newest.date) {
            newest = { name: db.datname, date: createdAt };
          }

          if (now - createdAt.getTime() > staleThresholdMs) {
            stale.push(db.datname);
          }
        } catch {
          // No valid metadata — flag as stale
          stale.push(db.datname);
        }
      } else {
        // No metadata at all — flag as stale
        stale.push(db.datname);
      }
    }

    const totalMb = (totalSize / (1024 * 1024)).toFixed(2);

    console.log("[preview] === Preview Database Stats ===\n");
    console.log(`  Total databases:   ${dbs.length}`);
    console.log(`  Total disk usage:  ${totalMb} MB`);

    if (oldest) {
      const oldestAge = (now - oldest.date.getTime()) / (1000 * 60 * 60 * 24);
      console.log(`  Oldest:            ${oldest.name} (${formatAge(oldestAge)}, created ${oldest.date.toISOString().split("T")[0]})`);
    }

    if (newest) {
      const newestAge = (now - newest.date.getTime()) / (1000 * 60 * 60 * 24);
      console.log(`  Newest:            ${newest.name} (${formatAge(newestAge)}, created ${newest.date.toISOString().split("T")[0]})`);
    }

    if (stale.length > 0) {
      console.log(`\n  Stale (> ${DEFAULT_MAX_AGE_DAYS} days):  ${stale.length} database(s)`);
      for (const name of stale) {
        console.log(`    - ${name}`);
      }
      console.log(`\n  Run "preview:cleanup-stale" to remove stale databases.`);
    } else {
      console.log(`\n  No stale databases (all < ${DEFAULT_MAX_AGE_DAYS} days old).`);
    }
  } finally {
    await maintClient.end();
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const command = args[0];
const branch = args[1];

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("[preview] ERROR: DATABASE_URL environment variable is required.");
  console.error("[preview] Set it to your PostgreSQL connection string.");
  process.exit(1);
}

async function main() {
  switch (command) {
    case "create":
      if (!branch) {
        console.error("[preview] Usage: preview-db.ts create <branch-name> [--pr-number=N]");
        process.exit(1);
      }
      await createPreviewDb(branch, databaseUrl!);
      break;

    case "destroy":
      if (!branch) {
        console.error("[preview] Usage: preview-db.ts destroy <branch-name>");
        process.exit(1);
      }
      await destroyPreviewDb(branch, databaseUrl!);
      break;

    case "reset":
      if (!branch) {
        console.error("[preview] Usage: preview-db.ts reset <branch-name>");
        process.exit(1);
      }
      await resetPreviewDb(branch, databaseUrl!);
      break;

    case "list":
      await listPreviewDbs(databaseUrl!);
      break;

    case "cleanup-stale": {
      const maxAgeDays = parseMaxAgeDays(args);
      await cleanupStalePreviewDbs(databaseUrl!, maxAgeDays);
      break;
    }

    case "stats":
      await showStats(databaseUrl!);
      break;

    default:
      console.error(`[preview] Unknown command: ${command}`);
      console.error("[preview] Available commands: create, destroy, reset, list, cleanup-stale, stats");
      process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[preview] Command failed:", err);
    process.exit(1);
  });
