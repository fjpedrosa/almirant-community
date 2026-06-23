import { resolve } from "path";
import postgres from "postgres";
import { seedPreviewData } from "./preview-seed";

async function ensureVectorExtension(databaseUrl: string) {
  const sql = postgres(databaseUrl, { max: 1 });

  try {
    await sql`CREATE EXTENSION IF NOT EXISTS vector;`;
  } finally {
    await sql.end();
  }
}

async function applySchema(databaseUrl: string) {
  const packageRoot = resolve(import.meta.dir, "../..");

  const drizzlePush = Bun.spawn(
    ["bunx", "drizzle-kit", "push", "--force"],
    {
      cwd: packageRoot,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
      },
      stdout: "inherit",
      stderr: "inherit",
    }
  );

  const exitCode = await drizzlePush.exited;
  if (exitCode !== 0) {
    throw new Error(`drizzle-kit push failed with exit code ${exitCode}`);
  }
}

async function bootstrapLocalDatabase(databaseUrl: string) {
  console.log("[bootstrap-local] Ensuring pgvector extension...");
  await ensureVectorExtension(databaseUrl);

  console.log("[bootstrap-local] Applying current schema with drizzle-kit push...");
  await applySchema(databaseUrl);

  console.log("[bootstrap-local] Seeding local platform defaults...");
  await seedPreviewData(databaseUrl);

  console.log("[bootstrap-local] Local database bootstrap completed.");
}

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("[bootstrap-local] ERROR: DATABASE_URL environment variable is required.");
  process.exit(1);
}

bootstrapLocalDatabase(databaseUrl)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[bootstrap-local] Bootstrap failed:", error);
    process.exit(1);
  });
