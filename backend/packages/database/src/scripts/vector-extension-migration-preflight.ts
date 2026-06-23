const VECTOR_EXTENSION_MIGRATION_TAGS = [
  "0134_slim_nico_minoru",
  "0172_cute_hellfire_club",
  "0174_overconfident_nehzno",
  "0199_quick_famine",
] as const;

interface RowLike {
  [key: string]: unknown;
}

interface QueryResultLike<T extends RowLike> {
  rows?: T[];
}

export type QueryExecutor = (statement: string) => Promise<unknown>;

const getRows = <T extends RowLike>(result: unknown): T[] => {
  if (Array.isArray(result)) {
    return result as T[];
  }

  if (
    result &&
    typeof result === "object" &&
    "rows" in result &&
    Array.isArray((result as QueryResultLike<T>).rows)
  ) {
    return (result as QueryResultLike<T>).rows ?? [];
  }

  return [];
};

const isTruthy = (value: unknown): boolean => value === true || value === "t" || value === "true" || value === 1;

export const shouldRunVectorExtensionPreflight = (pendingMigrationTags: string[]): boolean =>
  pendingMigrationTags.some((tag) =>
    VECTOR_EXTENSION_MIGRATION_TAGS.includes(
      tag as (typeof VECTOR_EXTENSION_MIGRATION_TAGS)[number]
    )
  );

export const maybeRunVectorExtensionPreflight = async (args: {
  pendingMigrationTags: string[];
  execute: QueryExecutor;
  log?: (message: string) => void;
}): Promise<boolean> => {
  if (!shouldRunVectorExtensionPreflight(args.pendingMigrationTags)) {
    return false;
  }

  const log = args.log ?? (() => undefined);
  log("🧩 Checking pgvector extension before vector-based migrations...");

  const [availability] = getRows<{
    available: unknown;
    installed: unknown;
  }>(
    await args.execute(`
      SELECT
        EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') AS "available",
        EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS "installed";
    `)
  );

  const available = isTruthy(availability?.available);
  const installed = isTruthy(availability?.installed);

  if (!available) {
    throw new Error(
      "pgvector extension is not available on this PostgreSQL instance. Use a pgvector-enabled Postgres image (for example `pgvector/pgvector:pg17`) or install the extension before running migrations."
    );
  }

  if (installed) {
    log("   ↪️ pgvector is already installed.");
    return true;
  }

  await args.execute(`CREATE EXTENSION IF NOT EXISTS vector;`);
  log("   ↪️ pgvector extension created.");
  return true;
};
