import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const apiDirectory = import.meta.dir;
const dockerfilePath = join(apiDirectory, "Dockerfile");
const entrypointPath = join(apiDirectory, "docker-entrypoint.sh");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function runEntrypoint(
  migrationExitCode: number,
  { includeDatabaseUrl = true }: { includeDatabaseUrl?: boolean } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "almirant-api-entrypoint-"));
  temporaryDirectories.push(directory);

  const binDirectory = join(directory, "bin");
  const migrationDirectory = join(directory, "database");
  const eventsPath = join(directory, "events.log");
  await Promise.all([
    mkdir(binDirectory, { recursive: true }),
    mkdir(migrationDirectory, { recursive: true }),
  ]);

  const bunStub = join(binDirectory, "bun");
  const apiStub = join(binDirectory, "api-server");
  await writeFile(
    bunStub,
    '#!/bin/sh\nprintf "migration:%s\\n" "$*" >> "$EVENTS_PATH"\nexit "$MIGRATION_EXIT_CODE"\n',
  );
  await writeFile(
    apiStub,
    '#!/bin/sh\nprintf "api:%s\\n" "$*" >> "$EVENTS_PATH"\n',
  );
  await Promise.all([chmod(bunStub, 0o755), chmod(apiStub, 0o755)]);

  const environment = {
    ...Bun.env,
    PATH: `${binDirectory}:${Bun.env.PATH}`,
    DATABASE_MIGRATIONS_DIR: migrationDirectory,
    EVENTS_PATH: eventsPath,
    MIGRATION_EXIT_CODE: String(migrationExitCode),
  };
  delete environment.DATABASE_URL;
  if (includeDatabaseUrl) {
    environment.DATABASE_URL =
      "postgresql://entrypoint-test:entrypoint-test@127.0.0.1:1/entrypoint-test";
  }

  const process = Bun.spawn(["sh", entrypointPath, "api-server", "--port", "3001"], {
    env: {
      ...environment,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const stderrPromise = new Response(process.stderr).text();
  const exitCode = await process.exited;
  const stderr = await stderrPromise;
  const events = await readFile(eventsPath, "utf8").catch(() => "");

  return { exitCode, events, stderr };
}

describe("API container startup", () => {
  test("Docker uses the migration-gated entrypoint", async () => {
    const dockerfile = await readFile(dockerfilePath, "utf8");

    expect(dockerfile).toContain(
      "COPY --chmod=755 backend/api/docker-entrypoint.sh /usr/local/bin/almirant-api-entrypoint",
    );
    expect(dockerfile).toContain('ENTRYPOINT ["almirant-api-entrypoint"]');
    expect(dockerfile).toContain('CMD ["bun", "run", "dist/index.js"]');
  });

  test("runs the validated migrator before execing the API", async () => {
    const result = await runEntrypoint(0);

    expect(result.exitCode).toBe(0);
    expect(result.events).toBe(
      "migration:run src/scripts/migrate-with-validation.ts\n" +
        "api:--port 3001\n",
    );
  });

  test("does not start the API when migration fails", async () => {
    const result = await runEntrypoint(42);

    expect(result.exitCode).toBe(42);
    expect(result.events).toBe(
      "migration:run src/scripts/migrate-with-validation.ts\n",
    );
  });

  test("fails before migration and API startup when DATABASE_URL is missing", async () => {
    const result = await runEntrypoint(0, { includeDatabaseUrl: false });

    expect(result.exitCode).toBe(1);
    expect(result.events).toBe("");
    expect(result.stderr).toContain("DATABASE_URL is required");
  });

  test("forwards TERM and INT to the migration child", async () => {
    const entrypoint = await readFile(entrypointPath, "utf8");

    expect(entrypoint).toContain("migration_pid=$!");
    expect(entrypoint).toContain("trap 'forward_signal TERM' TERM");
    expect(entrypoint).toContain("trap 'forward_signal INT' INT");
    expect(entrypoint).toContain('kill -"$signal" "$migration_pid"');
    expect(entrypoint).toContain('wait "$migration_pid"');
  });
});
