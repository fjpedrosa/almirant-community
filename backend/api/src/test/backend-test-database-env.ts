export const UNIT_TEST_DATABASE_URL =
  "postgres://test:test@127.0.0.1:1/almirant_unit_tests";

type Environment = Readonly<Record<string, string | undefined>>;

export type BackendTestDatabaseEnv = {
  DATABASE_URL: string;
  ALMIRANT_RUN_DB_TESTS: "true" | "false";
};

const parseTestDatabaseUrl = (value: string): string => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("TEST_DATABASE_URL must be a valid PostgreSQL URL");
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("TEST_DATABASE_URL must use postgres:// or postgresql://");
  }

  return value;
};

/**
 * Separates normal backend tests from destructive real-DB integration tests.
 *
 * `DATABASE_URL` is required by the API config at module-load time, even when a
 * unit test never connects. Reusing an inherited runtime/production URL would
 * be unsafe, while inventing a localhost CI URL makes DB-gated suites run
 * against an absent or unmigrated database. A dedicated TEST_DATABASE_URL is
 * therefore the only opt-in that enables those suites.
 */
export const resolveBackendTestDatabaseEnv = (
  environment: Environment,
): BackendTestDatabaseEnv => {
  const testDatabaseUrl = environment.TEST_DATABASE_URL?.trim();

  if (!testDatabaseUrl) {
    return {
      DATABASE_URL: UNIT_TEST_DATABASE_URL,
      ALMIRANT_RUN_DB_TESTS: "false",
    };
  }

  return {
    DATABASE_URL: parseTestDatabaseUrl(testDatabaseUrl),
    ALMIRANT_RUN_DB_TESTS: "true",
  };
};
