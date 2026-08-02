import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Behavioral (not source-contract) pin for the 2026-08-02 dispatch-authority
// flip. background.scheduled-agent-dispatcher-gate.test.ts already pins the
// pure predicate and the source-level wiring of startScheduledAgentDispatcher
// inside startBackgroundJobs() -- deliberately without calling
// startBackgroundJobs() itself, since that function side-effects ~20
// sweepers wired to real timers/DB-backed imports (see that file's header
// comment for the full rationale, which still applies here).
//
// This file instead exercises the REAL composition
// (`isScheduledAgentDispatcherEnabled(env...) ? startScheduledAgentDispatcher(...) : null`)
// against the REAL Zod-parsed env default and the REAL dispatcher module, in
// an isolated child process per case (env.ts parses `process.env` once at
// import time and Bun caches modules per-process, so re-importing with a
// different env value in-process is not possible -- same isolation pattern
// as env.scheduled-agent-dispatcher-enabled.test.ts). This proves an actual
// timer gets registered (or not) under the real default, not just that the
// source text matches a pattern.
//
// The probe inlines isScheduledAgentDispatcherEnabled's one-line body
// (`flag === "true"`) instead of importing it from background.ts: importing
// background.ts pulls in its full sweeper graph as module-level side
// effects (e.g. the quota-service singleton) even without ever calling
// startBackgroundJobs(), which was confirmed to hang the probe process
// indefinitely. The predicate itself already has a dedicated exact-match
// unit test in background.scheduled-agent-dispatcher-gate.test.ts; this file
// only adds the "a timer is actually registered" behavioral claim on top.
//
// "The old path stays operational" (requirement 3 of the flip) is a
// cross-service claim -- backend dispatch vs. the runner's own scheduler are
// two different processes/services, and nothing in this repo boots both
// together for a single test. That claim is pinned by combining THIS file
// (backend: SCHEDULED_AGENT_DISPATCHER_ENABLED=false -> the backend does not
// start a dispatcher) with two runner-side tests that are the other half of
// the same guarantee:
//   - services/runner/src/shared/config.test.ts: "defaults
//     RUNNER_SCHEDULER_ENABLED to true when SCHEDULED_AGENT_DISPATCHER_ENABLED
//     is explicitly false" -- the runner's own env resolution keeps the old
//     default automatically, zero extra config needed.
//   - services/runner/src/orchestration/orchestrator.test.ts: "keeps
//     scheduling scheduled configs when schedulerEnabled defaults to true"
//     -- the orchestrator actually runs processScheduledConfigs()/
//     scheduleValidation() and registers its interval when the resolved flag
//     says so.
// ---------------------------------------------------------------------------

const dispatcherModulePath = join(
  import.meta.dir,
  "domains/agents/services/scheduled-agent-dispatcher",
);
// Imported by absolute path (not the "@almirant/config" package specifier)
// because the probe script lives in an mkdtemp() scratch directory outside
// the workspace tree -- Bun resolves bare specifiers relative to the
// IMPORTING file's own location, so a bare "@almirant/config" import from
// /tmp can never find the workspace's node_modules. The dispatcher module
// above doesn't have this problem: it lives inside the real project tree,
// so Bun resolves ITS OWN "@almirant/config" import by walking up from its
// real location. Same reasoning as
// env.scheduled-agent-dispatcher-enabled.test.ts's envModulePath.
const configEnvModulePath = join(
  import.meta.dir,
  "../../packages/config/src/env",
);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function probeDispatcherComposition(
  overrides: Record<string, string | undefined> = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const directory = await mkdtemp(join(tmpdir(), "almirant-dispatcher-e2e-probe-"));
  temporaryDirectories.push(directory);
  const probePath = join(directory, "probe.ts");
  await writeFile(
    probePath,
    [
      `import { env } from ${JSON.stringify(configEnvModulePath)};`,
      `import { startScheduledAgentDispatcher } from ${JSON.stringify(dispatcherModulePath)};`,
      ``,
      `// Same gate expression as backend/api/src/background.ts's`,
      `// startBackgroundJobs() (isScheduledAgentDispatcherEnabled's body`,
      `// inlined -- see this file's header comment for why it is not`,
      `// imported). This probe never touches the other ~20 sweepers.`,
      `const stop = env.SCHEDULED_AGENT_DISPATCHER_ENABLED === "true"`,
      `  ? startScheduledAgentDispatcher({ intervalMs: env.SCHEDULED_AGENT_DISPATCHER_INTERVAL_MS })`,
      `  : null;`,
      ``,
      `console.log(JSON.stringify({ started: stop !== null, flag: env.SCHEDULED_AGENT_DISPATCHER_ENABLED }));`,
      ``,
      `// Clean up before the 5s startup timer / interval ever fires -- this`,
      `// probe only asserts that a timer WAS registered, never that a tick`,
      `// ran (that would need a real database).`,
      `if (stop) stop();`,
    ].join("\n"),
  );

  const environment: Record<string, string> = {
    ...(Bun.env as Record<string, string>),
    // Unreachable on purpose -- @almirant/database's postgres client is lazy
    // (connects on first query, not on import), and startScheduledAgentDispatcher
    // never queries synchronously at start() time. Same stub used by
    // backend/api/src/test/backend-test-database-env.ts.
    DATABASE_URL: "postgres://test:test@127.0.0.1:1/almirant_unit_tests",
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

describe("scheduled-agent dispatch authority: end-to-end default pin", () => {
  test("env default (unset) -> the backend actually starts the dispatcher", async () => {
    const result = await probeDispatcherComposition({
      SCHEDULED_AGENT_DISPATCHER_ENABLED: undefined,
    });

    expect(result.exitCode).toBe(0);
    const lastLine = result.stdout.trim().split("\n").pop() ?? "";
    expect(JSON.parse(lastLine)).toEqual({ started: true, flag: "true" });
  });

  test("SCHEDULED_AGENT_DISPATCHER_ENABLED=false -> the backend does not start a dispatcher (old path stays the only authority)", async () => {
    const result = await probeDispatcherComposition({
      SCHEDULED_AGENT_DISPATCHER_ENABLED: "false",
    });

    expect(result.exitCode).toBe(0);
    const lastLine = result.stdout.trim().split("\n").pop() ?? "";
    expect(JSON.parse(lastLine)).toEqual({ started: false, flag: "false" });
  });

  test("SCHEDULED_AGENT_DISPATCHER_ENABLED=true (explicit) -> the backend starts the dispatcher", async () => {
    const result = await probeDispatcherComposition({
      SCHEDULED_AGENT_DISPATCHER_ENABLED: "true",
    });

    expect(result.exitCode).toBe(0);
    const lastLine = result.stdout.trim().split("\n").pop() ?? "";
    expect(JSON.parse(lastLine)).toEqual({ started: true, flag: "true" });
  });
});
