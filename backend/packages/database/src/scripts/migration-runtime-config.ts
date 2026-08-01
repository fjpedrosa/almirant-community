const DEFAULT_MIGRATION_LOCK_TIMEOUT_MS = 60_000;

type MigrationEnvironment = Record<string, string | undefined>;

export function resolveMigrationDatabaseUrl(
  environment: MigrationEnvironment,
): string {
  const databaseUrl =
    environment.MIGRATION_DATABASE_URL?.trim() ||
    environment.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error(
      "MIGRATION_DATABASE_URL or DATABASE_URL is required to run migrations",
    );
  }

  return databaseUrl;
}

export function resolveMigrationLockTimeoutMs(
  environment: MigrationEnvironment,
): number {
  const configured = environment.MIGRATION_LOCK_TIMEOUT_MS?.trim();
  if (!configured) {
    return DEFAULT_MIGRATION_LOCK_TIMEOUT_MS;
  }

  const timeoutMs = Number(configured);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(
      "MIGRATION_LOCK_TIMEOUT_MS must be a positive integer in milliseconds",
    );
  }

  return timeoutMs;
}
