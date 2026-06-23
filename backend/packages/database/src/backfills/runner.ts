import postgres, { type Sql } from "postgres";

export type DataBackfillStatus = "running" | "succeeded" | "failed";
export type DataBackfillRunStatus = DataBackfillStatus | "skipped";

export type DataBackfillRecord = {
  key: string;
  description: string;
  checksum: string;
  status: DataBackfillStatus;
  attemptCount: number;
  processedCount: number | null;
  metadata: Record<string, unknown> | null;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
};

export type DataBackfillResult = {
  processedCount?: number;
  metadata?: Record<string, unknown>;
};

export type DataBackfillDefinition = {
  key: string;
  description: string;
  checksum: string;
  /**
   * Fatal backfills block startup on failure. Historical/replay repairs should
   * normally be non-fatal so upgrades remain safe even if observability repair
   * fails and can be retried on the next upgrade.
   */
  fatalOnFailure?: boolean;
  run: (context: DataBackfillExecutionContext) => Promise<DataBackfillResult>;
};

export type DataBackfillExecutionContext = {
  now: () => Date;
  log: (level: "info" | "warn" | "error", message: string, meta?: Record<string, unknown>) => void;
};

export type DataBackfillLedger = {
  withGlobalLock: <T>(run: () => Promise<T>) => Promise<T>;
  get: (key: string) => Promise<DataBackfillRecord | null>;
  markRunning: (definition: DataBackfillDefinition, now: Date) => Promise<DataBackfillRecord>;
  markSucceeded: (key: string, result: DataBackfillResult, now: Date) => Promise<void>;
  markFailed: (key: string, error: unknown, now: Date) => Promise<void>;
};

export type DataBackfillRunResult = {
  key: string;
  status: DataBackfillRunStatus;
  processedCount?: number | null;
  metadata?: Record<string, unknown> | null;
  errorMessage?: string;
};

type PostgresJsonValue = Parameters<Sql["json"]>[0];

const toSqlJson = (value: Record<string, unknown>): PostgresJsonValue =>
  value as unknown as PostgresJsonValue;

export type RunDataBackfillsOptions = {
  now?: () => Date;
  log?: DataBackfillExecutionContext["log"];
};

export class DataBackfillError extends Error {
  constructor(
    public readonly key: string,
    public readonly causeError: unknown,
  ) {
    const message = causeError instanceof Error ? causeError.message : String(causeError);
    super(`Data backfill '${key}' failed: ${message}`);
    this.name = "DataBackfillError";
  }
}

const defaultLog: DataBackfillExecutionContext["log"] = (level, message, meta) => {
  const suffix = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
  console[level](`[data-backfills] ${message}${suffix}`);
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const runDataBackfills = async (
  definitions: DataBackfillDefinition[],
  ledger: DataBackfillLedger,
  options: RunDataBackfillsOptions = {},
): Promise<DataBackfillRunResult[]> => {
  const now = options.now ?? (() => new Date());
  const log = options.log ?? defaultLog;
  const context: DataBackfillExecutionContext = { now, log };

  return ledger.withGlobalLock(async () => {
    const results: DataBackfillRunResult[] = [];

    for (const definition of definitions) {
      const existing = await ledger.get(definition.key);
      if (existing?.status === "succeeded" && existing.checksum === definition.checksum) {
        log("info", `Skipping already applied backfill '${definition.key}'`, {
          checksum: definition.checksum,
        });
        results.push({
          key: definition.key,
          status: "skipped",
          processedCount: existing.processedCount,
          metadata: existing.metadata,
        });
        continue;
      }

      await ledger.markRunning(definition, now());
      log("info", `Running backfill '${definition.key}'`, {
        checksum: definition.checksum,
        fatal: definition.fatalOnFailure === true,
      });

      try {
        const result = await definition.run(context);
        await ledger.markSucceeded(definition.key, result, now());
        results.push({
          key: definition.key,
          status: "succeeded",
          processedCount: result.processedCount,
          metadata: result.metadata,
        });
        log("info", `Backfill '${definition.key}' completed`, {
          processedCount: result.processedCount ?? null,
        });
      } catch (error) {
        await ledger.markFailed(definition.key, error, now());
        results.push({
          key: definition.key,
          status: "failed",
          errorMessage: errorMessage(error),
        });
        log("error", `Backfill '${definition.key}' failed`, {
          errorMessage: errorMessage(error),
        });

        if (definition.fatalOnFailure === true) {
          throw new DataBackfillError(definition.key, error);
        }
      }
    }

    return results;
  });
};

const mapRow = (row: {
  key: string;
  description: string;
  checksum: string;
  status: DataBackfillStatus;
  attempt_count: number;
  processed_count: number | null;
  metadata: Record<string, unknown> | null;
  error_message: string | null;
  started_at: Date | null;
  completed_at: Date | null;
}): DataBackfillRecord => ({
  key: row.key,
  description: row.description,
  checksum: row.checksum,
  status: row.status,
  attemptCount: row.attempt_count,
  processedCount: row.processed_count,
  metadata: row.metadata,
  errorMessage: row.error_message,
  startedAt: row.started_at,
  completedAt: row.completed_at,
});

export const createPostgresDataBackfillLedger = (sql: Sql): DataBackfillLedger => ({
  async withGlobalLock(run) {
    await sql`SELECT pg_advisory_lock(hashtext('almirant:data-backfills'))`;
    try {
      return await run();
    } finally {
      await sql`SELECT pg_advisory_unlock(hashtext('almirant:data-backfills'))`;
    }
  },

  async get(key) {
    const rows = await sql<Array<Parameters<typeof mapRow>[0]>>`
      SELECT
        key,
        description,
        checksum,
        status,
        attempt_count,
        processed_count,
        metadata,
        error_message,
        started_at,
        completed_at
      FROM data_backfills
      WHERE key = ${key}
      LIMIT 1
    `;
    const row = rows[0];
    return row ? mapRow(row) : null;
  },

  async markRunning(definition, now) {
    const [row] = await sql<Array<Parameters<typeof mapRow>[0]>>`
      INSERT INTO data_backfills (
        key,
        description,
        checksum,
        status,
        attempt_count,
        processed_count,
        metadata,
        error_message,
        started_at,
        completed_at,
        updated_at
      ) VALUES (
        ${definition.key},
        ${definition.description},
        ${definition.checksum},
        'running',
        1,
        NULL,
        ${sql.json(toSqlJson({}))},
        NULL,
        ${now},
        NULL,
        ${now}
      )
      ON CONFLICT (key) DO UPDATE SET
        description = EXCLUDED.description,
        checksum = EXCLUDED.checksum,
        status = 'running',
        attempt_count = data_backfills.attempt_count + 1,
        error_message = NULL,
        started_at = EXCLUDED.started_at,
        completed_at = NULL,
        updated_at = EXCLUDED.updated_at
      RETURNING
        key,
        description,
        checksum,
        status,
        attempt_count,
        processed_count,
        metadata,
        error_message,
        started_at,
        completed_at
    `;
    return mapRow(row!);
  },

  async markSucceeded(key, result, now) {
    await sql`
      UPDATE data_backfills
      SET
        status = 'succeeded',
        processed_count = ${result.processedCount ?? null},
        metadata = ${sql.json(toSqlJson(result.metadata ?? {}))},
        error_message = NULL,
        completed_at = ${now},
        updated_at = ${now}
      WHERE key = ${key}
    `;
  },

  async markFailed(key, error, now) {
    await sql`
      UPDATE data_backfills
      SET
        status = 'failed',
        error_message = ${errorMessage(error)},
        completed_at = ${now},
        updated_at = ${now}
      WHERE key = ${key}
    `;
  },
});

export const runDataBackfillsWithPostgres = async (
  databaseUrl: string,
  definitions: (sql: Sql) => DataBackfillDefinition[],
  options: RunDataBackfillsOptions = {},
): Promise<DataBackfillRunResult[]> => {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    return await runDataBackfills(
      definitions(sql),
      createPostgresDataBackfillLedger(sql),
      options,
    );
  } finally {
    await sql.end();
  }
};
