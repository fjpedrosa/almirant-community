export const MIGRATION_ADVISORY_LOCK_NAME = "almirant:schema-migrations";

type LockQuery = (
  statement: string,
  parameters: Array<string | number>,
) => Promise<readonly Record<string, unknown>[]>;

interface MigrationAdvisoryLockOptions {
  timeoutMs: number;
  pollIntervalMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  onUnlockError?: (error: Error) => void;
}

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

export async function withMigrationAdvisoryLock<T>(
  query: LockQuery,
  migrate: () => Promise<T>,
  options: MigrationAdvisoryLockOptions,
): Promise<T> {
  const { timeoutMs } = options;
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((milliseconds) => Bun.sleep(milliseconds));

  if (timeoutMs <= 0 || pollIntervalMs <= 0) {
    throw new Error("Migration advisory lock timeout and poll interval must be positive");
  }

  const startedAt = now();
  while (true) {
    const rows = await query(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
      [MIGRATION_ADVISORY_LOCK_NAME],
    );
    if (rows[0]?.acquired === true) {
      break;
    }

    const elapsedMs = now() - startedAt;
    if (elapsedMs >= timeoutMs) {
      throw new Error(
        `Timed out after ${timeoutMs}ms waiting for the database migration advisory lock`,
      );
    }

    await sleep(Math.min(pollIntervalMs, timeoutMs - elapsedMs));
  }

  let migrationFailed = false;
  try {
    return await migrate();
  } catch (error) {
    migrationFailed = true;
    throw error;
  } finally {
    try {
      const rows = await query(
        "SELECT pg_advisory_unlock(hashtext($1)) AS released",
        [MIGRATION_ADVISORY_LOCK_NAME],
      );
      if (rows[0]?.released !== true) {
        throw new Error(
          "PostgreSQL did not release the database migration advisory lock",
        );
      }
    } catch (error) {
      const unlockError = toError(error);
      if (!migrationFailed) {
        throw unlockError;
      }

      if (options.onUnlockError) {
        options.onUnlockError(unlockError);
      } else {
        console.error(
          "Failed to release migration advisory lock after migration error:",
          unlockError,
        );
      }
    }
  }
}
