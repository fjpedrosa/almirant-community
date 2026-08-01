import postgres from "postgres";

import {
  createBackendTestEnvironment,
  findMissingRequiredDatabaseRelations,
  REQUIRED_TEST_DATABASE_RELATIONS,
  selectBackendTests,
} from "./backend-test-selector";

const apiRoot = new URL("..", import.meta.url).pathname;

const discoverTestFiles = async (): Promise<string[]> => {
  const files: string[] = [];
  for (const root of ["scripts", "src"]) {
    for (const pattern of ["**/*.test.ts", "**/*.test.tsx"]) {
      const glob = new Bun.Glob(pattern);
      for await (const file of glob.scan({ cwd: `${apiRoot}/${root}` })) {
        files.push(`${root}/${file}`);
      }
    }
  }
  return files;
};

const definedEnvironment = (
  environment: Readonly<Record<string, string | undefined>>,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );

const runTests = (
  label: string,
  files: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): number => {
  console.log(`\n[backend-tests] Running ${files.length} ${label} test files`);
  const result = Bun.spawnSync({
    cmd: [process.execPath, "test", "--pass-with-no-tests", ...files],
    cwd: apiRoot,
    env: definedEnvironment(environment),
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return result.exitCode;
};

const assertPreparedTestDatabase = async (databaseUrl: string): Promise<void> => {
  const sql = postgres(databaseUrl, {
    max: 1,
    connect_timeout: 5,
    idle_timeout: 1,
  });
  const presentRelations: string[] = [];

  try {
    for (const relation of REQUIRED_TEST_DATABASE_RELATIONS) {
      const [row] = await sql<{ relation: string | null }[]>`
        SELECT to_regclass(${relation})::text AS relation
      `;
      if (row?.relation) presentRelations.push(relation);
    }
  } catch (error) {
    throw new Error(
      "TEST_DATABASE_URL is unreachable or cannot inspect its schema",
      { cause: error },
    );
  } finally {
    await sql.end({ timeout: 1 });
  }

  const missing = findMissingRequiredDatabaseRelations(presentRelations);
  if (missing.length > 0) {
    throw new Error(
      `TEST_DATABASE_URL schema is not prepared; missing relations: ${missing.join(", ")}`,
    );
  }
};

const main = async (): Promise<number> => {
  const selection = selectBackendTests(
    await discoverTestFiles(),
    process.env.TEST_DATABASE_URL,
  );

  const unitExitCode = runTests(
    "unit",
    selection.unit,
    createBackendTestEnvironment(process.env, "unit"),
  );
  if (unitExitCode !== 0) return unitExitCode;

  if (selection.database.length === 0) {
    if (selection.skippedDatabase.length > 0) {
      console.log(
        `[backend-tests] Skipped ${selection.skippedDatabase.length} real-DB test files; set TEST_DATABASE_URL to a migrated disposable schema to include them`,
      );
    }
    return 0;
  }

  const databaseEnvironment = createBackendTestEnvironment(
    process.env,
    "database",
  );
  await assertPreparedTestDatabase(databaseEnvironment.DATABASE_URL!);
  return runTests("real-DB", selection.database, databaseEnvironment);
};

try {
  process.exitCode = await main();
} catch (error) {
  console.error(
    `[backend-tests] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
