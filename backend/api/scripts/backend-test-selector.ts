export const UNIT_TEST_DATABASE_URL =
  "postgresql://unit:unit@127.0.0.1:1/almirant_unit_tests";

export const REQUIRED_TEST_DATABASE_RELATIONS = [
  "agent_job_logs",
  "agent_jobs",
  "boards",
  "bug_fix_attempts",
  "effort_estimation_requests",
  "feedback_items",
  "projects",
  "work_items",
  "workspace",
] as const;

export type BackendTestKind = "unit" | "database";

export type BackendTestSelection = {
  unit: string[];
  database: string[];
  skippedDatabase: string[];
};

const normalizedTestDatabaseUrl = (
  testDatabaseUrl: string | undefined,
): string | undefined => {
  const value = testDatabaseUrl?.trim();
  return value ? value : undefined;
};

const validateTestDatabaseUrl = (value: string): string => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("TEST_DATABASE_URL must be a valid PostgreSQL URL");
  }

  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname) {
    throw new Error("TEST_DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (value === UNIT_TEST_DATABASE_URL) {
    throw new Error(
      "TEST_DATABASE_URL cannot use the isolated unit-test DATABASE_URL",
    );
  }
  return value;
};

const normalizeTestFile = (file: string): string =>
  file.replaceAll("\\", "/").replace(/^\.\//, "");

export const isDatabaseTestFile = (file: string): boolean =>
  /\.db\.test\.[cm]?[jt]sx?$/.test(normalizeTestFile(file));

export const selectBackendTests = (
  files: readonly string[],
  testDatabaseUrl: string | undefined,
): BackendTestSelection => {
  const normalizedFiles = [...new Set(files.map(normalizeTestFile))].sort();
  const unit = normalizedFiles.filter((file) => !isDatabaseTestFile(file));
  const databaseCandidates = normalizedFiles.filter(isDatabaseTestFile);

  if (normalizedTestDatabaseUrl(testDatabaseUrl)) {
    return {
      unit,
      database: databaseCandidates,
      skippedDatabase: [],
    };
  }

  return {
    unit,
    database: [],
    skippedDatabase: databaseCandidates,
  };
};

export const createBackendTestEnvironment = (
  environment: Readonly<Record<string, string | undefined>>,
  kind: BackendTestKind,
): Record<string, string | undefined> => {
  const result = { ...environment };

  if (kind === "unit") {
    result.DATABASE_URL = UNIT_TEST_DATABASE_URL;
    delete result.TEST_DATABASE_URL;
    return result;
  }

  const testDatabaseUrl = normalizedTestDatabaseUrl(
    environment.TEST_DATABASE_URL,
  );
  if (!testDatabaseUrl) {
    throw new Error(
      "TEST_DATABASE_URL must be set explicitly to run real-DB test suites",
    );
  }

  const validatedTestDatabaseUrl = validateTestDatabaseUrl(testDatabaseUrl);
  result.DATABASE_URL = validatedTestDatabaseUrl;
  result.TEST_DATABASE_URL = validatedTestDatabaseUrl;
  return result;
};

export const findMissingRequiredDatabaseRelations = (
  presentRelations: readonly string[],
): string[] => {
  const present = new Set(presentRelations);
  return REQUIRED_TEST_DATABASE_RELATIONS.filter(
    (relation) => !present.has(relation),
  );
};
