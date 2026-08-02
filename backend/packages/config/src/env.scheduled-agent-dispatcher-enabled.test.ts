import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// SCHEDULED_AGENT_DISPATCHER_ENABLED gates backend/api/src/background.ts's
// startScheduledAgentDispatcher call — see the comment on the field in
// ./env.ts. As of 2026-08-02 the default is "true": the backend is the
// authoritative dispatcher for fresh self-hosted installs, while
// RUNNER_SCHEDULER_ENABLED (services/runner/src/shared/config.ts) defaults
// OFF so the runner's own scheduler tick does not double-dispatch alongside
// it. An existing self-hoster who explicitly set this to "false" keeps the
// pre-2026-08-02 runner-only behavior unchanged (see
// RUNNER_SCHEDULER_ENABLED's own default-inversion logic).
//
// Nothing in the repo pinned this default or the schema's rejection of
// invalid values, so a future edit to the `.default(...)` call (e.g.
// accidentally flipping it back to "false") would silently change
// production behavior with no test failing.
//
// ./env.ts parses `process.env` at MODULE LOAD TIME and calls
// `process.exit(1)` on a failed parse, so the schema cannot be exercised
// safely in-process (a failing case would either poison this test file's own
// process env, or get skipped entirely by Bun's module cache after the first
// import). Each case below runs the real module in its own child process
// instead — the same isolation pattern already used by
// backend/api/docker-entrypoint.test.ts for this exact
// "parses env, exits non-zero on failure" shape.
// ---------------------------------------------------------------------------

const envModulePath = join(import.meta.dir, "env");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function readScheduledAgentDispatcherEnabled(
  overrides: Record<string, string | undefined> = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const directory = await mkdtemp(join(tmpdir(), "almirant-config-env-probe-"));
  temporaryDirectories.push(directory);
  const probePath = join(directory, "probe.ts");
  await writeFile(
    probePath,
    `import { env } from ${JSON.stringify(envModulePath)};\n` +
      `console.log(JSON.stringify({ v: env.SCHEDULED_AGENT_DISPATCHER_ENABLED }));\n`,
  );

  const environment: Record<string, string> = {
    ...(Bun.env as Record<string, string>),
    // Only truly required field in the schema (z.string().min(1), no
    // default). Everything else the probe needs already has a schema
    // default.
    DATABASE_URL: "postgresql://scheduled-agent-dispatcher-probe:x@127.0.0.1:1/x",
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete environment[key];
    else environment[key] = value;
  }

  const proc = Bun.spawn(["bun", "run", probePath], {
    env: environment,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("env: SCHEDULED_AGENT_DISPATCHER_ENABLED", () => {
  test('defaults to "true" when unset — the backend is the authoritative dispatcher for fresh installs', async () => {
    const result = await readScheduledAgentDispatcherEnabled({
      SCHEDULED_AGENT_DISPATCHER_ENABLED: undefined,
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({ v: "true" });
  });

  test('accepts an explicit "true"', async () => {
    const result = await readScheduledAgentDispatcherEnabled({
      SCHEDULED_AGENT_DISPATCHER_ENABLED: "true",
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({ v: "true" });
  });

  test('accepts an explicit "false" — the opt-out existing self-hosters use to keep the runner-only dispatch path', async () => {
    const result = await readScheduledAgentDispatcherEnabled({
      SCHEDULED_AGENT_DISPATCHER_ENABLED: "false",
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({ v: "false" });
  });

  test("rejects an invalid value and exits non-zero instead of silently falling back", async () => {
    const result = await readScheduledAgentDispatcherEnabled({
      SCHEDULED_AGENT_DISPATCHER_ENABLED: "yes",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("SCHEDULED_AGENT_DISPATCHER_ENABLED");
    expect(result.stdout).toBe("");
  });
});
