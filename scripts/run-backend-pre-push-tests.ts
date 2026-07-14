import { resolve } from "node:path";
import { resolveBackendTestDatabaseEnv } from "../backend/api/src/test/backend-test-database-env";

const databaseEnv = resolveBackendTestDatabaseEnv(process.env);
const runsDatabaseTests = databaseEnv.ALMIRANT_RUN_DB_TESTS === "true";

console.log(
  runsDatabaseTests
    ? "[pre-push] Running backend tests with the explicit TEST_DATABASE_URL."
    : "[pre-push] TEST_DATABASE_URL is unset; real PostgreSQL suites are skipped.",
);

const child = Bun.spawn([process.execPath, "test", ...process.argv.slice(2)], {
  cwd: resolve(import.meta.dir, "../backend/api"),
  env: {
    ...process.env,
    ...databaseEnv,
  },
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

process.exit(await child.exited);
