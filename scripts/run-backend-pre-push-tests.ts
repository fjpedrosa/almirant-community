import { resolve } from "node:path";
import { resolveBackendTestDatabaseEnv } from "../backend/api/src/test/backend-test-database-env";

const databaseEnv = resolveBackendTestDatabaseEnv(process.env);
const runsDatabaseTests = databaseEnv.ALMIRANT_RUN_DB_TESTS === "true";

console.log(
  runsDatabaseTests
    ? "[pre-push] Running backend tests with the explicit TEST_DATABASE_URL."
    : "[pre-push] TEST_DATABASE_URL is unset; real PostgreSQL suites are skipped.",
);

// Delegate file discovery and prepared-schema verification to the stricter
// selector while retaining the explicit database environment contract above.
// This keeps real-DB suites opt-in and prevents ambient production URLs from
// reaching either the ALMIRANT_RUN_DB_TESTS gate or *.db.test suites.
const child = Bun.spawn(
  [process.execPath, "run", "scripts/run-backend-tests.ts", ...process.argv.slice(2)],
  {
    cwd: resolve(import.meta.dir, "../backend/api"),
    env: {
      ...process.env,
      ...databaseEnv,
    },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  },
);

process.exit(await child.exited);
