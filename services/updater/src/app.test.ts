import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ─── Mock the spawn module BEFORE importing anything that depends on it ─────
// JobRunner → git-ops/compose-ops → spawn. We replace spawnCmd with a
// pattern-matching fake that returns canned successes for the argv shapes
// the runner produces. This lets us drive the full state machine
// (fetching → building → recreating → healthchecking → done) without
// hitting a real shell.
//
// Per the project memory note on Bun mock.module leak: capture the real
// module and re-register it in afterAll so subsequent test files don't
// inherit our fake.

import * as realSpawn from "./spawn";

const realSpawnCmd = realSpawn.spawnCmd;

let fakeShouldFail = false;
let fakeFailureCommand: string[] | null = null;
let fakeServicesStdout = "backend\nfrontend\nupdater\n";
let fakePsStdout =
  '{"Service":"backend","State":"running","Health":"healthy"}\n' +
  '{"Service":"frontend","State":"running","Health":"healthy"}\n';
let fakeMissingImages = new Set<string>();
let fakeCommands: string[][] = [];
let fakeRepoPath: string | null = null;
let fakeAgentContainersStdout = "";
const OLD_OPENCODE_SHIM_IMAGE = [
  "almirant-opencode-shim",
  "1.14.25",
].join(":");
const LEGACY_CLAUDE_SHIM_IMAGE = [
  "almirant-claude-shim",
  "latest",
].join(":");

const fakeSpawnCmd: typeof realSpawn.spawnCmd = async (argv, opts) => {
  fakeCommands.push([...argv]);

  // Simulate a tiny async delay so the runner state actually transitions
  // through `running` instead of completing synchronously.
  await new Promise((r) => setTimeout(r, 5));

  // Optional injected failure for fail-path tests.
  if (
    fakeFailureCommand &&
    argv.length >= fakeFailureCommand.length &&
    fakeFailureCommand.every((tok, i) => argv[i] === tok)
  ) {
    return { ok: false, exitCode: 1, stdout: "", stderr: "fake injected failure" };
  }
  if (fakeShouldFail) {
    return { ok: false, exitCode: 1, stdout: "", stderr: "fake failure" };
  }

  // git rev-parse HEAD → return a deterministic SHA
  if (argv[0] === "git" && argv[1] === "rev-parse" && argv[2] === "HEAD") {
    return {
      ok: true,
      exitCode: 0,
      stdout: "abc1234567890abcdef1234567890abcdef1234\n",
      stderr: "",
    };
  }

  // git fetch / git pull → ok with a log line
  if (argv[0] === "git" && (argv[1] === "fetch" || argv[1] === "pull")) {
    opts.onLog?.({
      timestamp: new Date().toISOString(),
      source: "stdout",
      text: `[fake] ${argv.slice(0, 3).join(" ")}`,
    });
    return { ok: true, exitCode: 0, stdout: "", stderr: "" };
  }

  // docker image inspect <image> → ok when the local image already exists.
  if (
    argv[0] === "docker" &&
    argv[1] === "image" &&
    argv[2] === "inspect" &&
    typeof argv[3] === "string"
  ) {
    if (fakeMissingImages.has(argv[3])) {
      return { ok: false, exitCode: 1, stdout: "", stderr: "No such image" };
    }

    return { ok: true, exitCode: 0, stdout: "[]", stderr: "" };
  }

  // docker compose config --services → list including updater (so the
  // exclude logic has something to filter)
  if (
    argv[0] === "docker" &&
    argv.includes("config") &&
    argv.includes("--services")
  ) {
    return {
      ok: true,
      exitCode: 0,
      stdout: fakeServicesStdout,
      stderr: "",
    };
  }

  // docker compose ps → all healthy
  if (argv[0] === "docker" && argv.includes("ps")) {
    if (argv.includes("--filter") && argv.includes("label=almirant-runner=true")) {
      return {
        ok: true,
        exitCode: 0,
        stdout: fakeAgentContainersStdout,
        stderr: "",
      };
    }

    return {
      ok: true,
      exitCode: 0,
      stdout: fakePsStdout,
      stderr: "",
    };
  }

  // docker compose exec tailscale-db tailscale status --json → online
  if (argv[0] === "docker" && argv.includes("exec")) {
    return {
      ok: true,
      exitCode: 0,
      stdout: JSON.stringify({
        Self: { Online: true, HostName: "almirant-db", TailscaleIPs: ["100.64.0.1"] },
        CurrentTailnet: { MagicDNSSuffix: "example.ts.net" },
      }),
      stderr: "",
    };
  }

  // docker compose build / up / restart / rm and docker volume rm → ok
  if (
    argv[0] === "docker" &&
    (
      argv.includes("build") ||
      argv.includes("up") ||
      argv.includes("restart") ||
      argv.includes("rm")
    )
  ) {
    opts.onLog?.({
      timestamp: new Date().toISOString(),
      source: "stdout",
      text: `[fake] docker ${
        argv.includes("build")
          ? "build"
          : argv.includes("restart")
            ? "restart"
            : argv.includes("rm")
              ? "rm"
              : "up"
      }`,
    });
    return { ok: true, exitCode: 0, stdout: "", stderr: "" };
  }

  return { ok: false, exitCode: 127, stdout: "", stderr: `unmocked: ${argv.join(" ")}` };
};

beforeAll(() => {
  mock.module("./spawn", () => ({ spawnCmd: fakeSpawnCmd }));
});

beforeEach(() => {
  fakeShouldFail = false;
  fakeFailureCommand = null;
  fakeServicesStdout = "backend\nfrontend\nupdater\n";
  fakePsStdout =
    '{"Service":"backend","State":"running","Health":"healthy"}\n' +
    '{"Service":"frontend","State":"running","Health":"healthy"}\n';
  fakeMissingImages = new Set();
  fakeCommands = [];
  fakeAgentContainersStdout = "";
  fakeRepoPath = mkdtempSync(join(tmpdir(), "almirant-updater-test-"));
  mkdirSync(join(fakeRepoPath, "config"), { recursive: true });
  writeFileSync(
    join(fakeRepoPath, "config", "shim-images.json"),
    JSON.stringify({
      opencode: {
        repository: "almirant-opencode-shim",
        tag: "1.14.31",
      },
      claude: {
        repository: "almirant-claude-shim",
        tag: "2.1.126",
      },
      codex: {
        repository: "almirant-codex-shim",
        tag: "0.128.0",
      },
    }),
  );
  writeFileSync(
    join(fakeRepoPath, ".env.production"),
    [
      "OPENCODE_IMAGE=almirant-opencode-shim:1.14.31",
      "CLAUDE_SHIM_IMAGE=almirant-claude-shim:2.1.126",
      "CODEX_SHIM_IMAGE=almirant-codex-shim:0.128.0",
      "",
    ].join("\n"),
  );
});

afterEach(() => {
  if (fakeRepoPath) {
    rmSync(fakeRepoPath, { recursive: true, force: true });
    fakeRepoPath = null;
  }
});

afterAll(() => {
  mock.module("./spawn", () => ({ spawnCmd: realSpawnCmd }));
});

// ─── Imports that depend on the mocked module ────────────────────────────────

const { JobRunner } = await import("./job-runner");
const { InfraRunner } = await import("./infra-runner");
const { ServiceOpsRunner } = await import("./service-ops-runner");
const { createApp } = await import("./app");

const TEST_TOKEN = "test-token-xyz";

const makeApp = () => {
  if (!fakeRepoPath) throw new Error("test repo path not initialised");

  const runner = new JobRunner({
    repoPath: fakeRepoPath,
    composeFile: "docker-compose.prod.yml",
    envFile: ".env.production",
    branch: "main",
    excludeServices: ["updater"],
  });
  const infraRunner = new InfraRunner({
    repoPath: fakeRepoPath,
    composeFile: "docker-compose.prod.yml",
    envFile: ".env.production",
  });
  const serviceOpsRunner = new ServiceOpsRunner({
    repoPath: fakeRepoPath,
    composeFile: "docker-compose.prod.yml",
    envFile: ".env.production",
  });
  const app = createApp({
    runner,
    infraRunner,
    serviceOpsRunner,
    token: TEST_TOKEN,
  });
  return { runner, infraRunner, serviceOpsRunner, app };
};

const json = async (response: Response) => ({
  status: response.status,
  body: (await response.json()) as Record<string, unknown>,
});

const waitForStatus = async (
  runner: { getJob: (id: string) => { status: string } | null },
  jobId: string,
  predicate: (status: string) => boolean,
  timeoutMs = 1_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = runner.getJob(jobId);
    if (job && predicate(job.status)) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`Timed out waiting for job ${jobId}`);
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("updater HTTP server", () => {
  test("/health is reachable without a token", async () => {
    const { app } = makeApp();
    const res = await app.handle(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  test("protected routes return 401 without a token", async () => {
    const { app } = makeApp();
    const res = await app.handle(new Request("http://localhost/jobs/active"));
    expect(res.status).toBe(401);
  });

  test("protected routes return 401 with a wrong token", async () => {
    const { app } = makeApp();
    const res = await app.handle(
      new Request("http://localhost/jobs/active", {
        headers: { "X-Updater-Token": "nope" },
      }),
    );
    expect(res.status).toBe(401);
  });

  test("authenticated /jobs/active returns null when idle", async () => {
    const { app } = makeApp();
    const res = await app.handle(
      new Request("http://localhost/jobs/active", {
        headers: { "X-Updater-Token": TEST_TOKEN },
      }),
    );
    const { status, body } = await json(res);
    expect(status).toBe(200);
    expect(body.job).toBeNull();
  });

  test("GET /jobs/:unknown returns 404", async () => {
    const { app } = makeApp();
    const res = await app.handle(
      new Request("http://localhost/jobs/does-not-exist", {
        headers: { "X-Updater-Token": TEST_TOKEN },
      }),
    );
    expect(res.status).toBe(404);
  });

  test("POST /jobs starts a job and returns 202 with jobId", async () => {
    const { runner, app } = makeApp();
    const res = await app.handle(
      new Request("http://localhost/jobs", {
        method: "POST",
        headers: { "X-Updater-Token": TEST_TOKEN },
      }),
    );
    const { status, body } = await json(res);
    expect(status).toBe(202);
    expect(typeof body.jobId).toBe("string");
    expect(body.startedAt).toBeDefined();

    // Wait for the job to drain so we don't leak the active mutex into
    // sibling tests.
    await waitForStatus(runner, body.jobId as string, (s) => s === "success");
  });

  test("a second POST /jobs while the first is active returns 409", async () => {
    const { runner, app } = makeApp();

    const first = await app.handle(
      new Request("http://localhost/jobs", {
        method: "POST",
        headers: { "X-Updater-Token": TEST_TOKEN },
      }),
    );
    expect(first.status).toBe(202);
    const firstBody = (await first.json()) as { jobId: string };

    // Don't await first completion — fire second immediately.
    const second = await app.handle(
      new Request("http://localhost/jobs", {
        method: "POST",
        headers: { "X-Updater-Token": TEST_TOKEN },
      }),
    );
    const { status, body } = await json(second);
    expect(status).toBe(409);
    expect(body.error).toBe("active_job_exists");
    expect((body.activeJob as { id: string }).id).toBe(firstBody.jobId);

    await waitForStatus(runner, firstBody.jobId, (s) => s === "success");
  });

  test("job state machine reaches success and excludes the updater service", async () => {
    const { runner, app } = makeApp();

    const res = await app.handle(
      new Request("http://localhost/jobs", {
        method: "POST",
        headers: { "X-Updater-Token": TEST_TOKEN },
      }),
    );
    const { jobId } = (await res.json()) as { jobId: string };

    await waitForStatus(runner, jobId, (s) => s === "success");

    const final = runner.getJob(jobId);
    expect(final?.status).toBe("success");
    expect(final?.step).toBe("done");
    expect(final?.exitCode).toBe(0);
    expect(final?.toSha).toBe("abc1234");
    // log tail must contain a line listing the services to recreate, and
    // that line must NOT contain the updater (suicide protection).
    const recreateLog = final?.logTail.find((l) =>
      l.text.startsWith("Recreating services:"),
    );
    expect(recreateLog).toBeDefined();
    expect(recreateLog?.text).not.toContain("updater");
    expect(recreateLog?.text).toContain("backend");
    expect(recreateLog?.text).toContain("frontend");
  });

  test("builds missing shim images before recreating the runner", async () => {
    fakeMissingImages = new Set([
      "almirant-claude-shim:2.1.126",
      "almirant-codex-shim:0.128.0",
    ]);

    const { runner, app } = makeApp();

    const res = await app.handle(
      new Request("http://localhost/jobs", {
        method: "POST",
        headers: { "X-Updater-Token": TEST_TOKEN },
      }),
    );
    const { jobId } = (await res.json()) as { jobId: string };

    await waitForStatus(runner, jobId, (s) => s === "success");

    const shimBuild = fakeCommands.find((argv) =>
      argv[0] === "docker" &&
      argv.includes("--profile") &&
      argv.includes("shims") &&
      argv.includes("build") &&
      argv.includes("claude-shim") &&
      argv.includes("codex-shim")
    );
    expect(shimBuild).toBeDefined();
    expect(shimBuild).not.toContain("opencode-shim");

    const normalUp = fakeCommands.find((argv) =>
      argv[0] === "docker" &&
      argv.includes("up") &&
      argv.includes("--force-recreate")
    );
    expect(normalUp).toBeDefined();
    expect(normalUp).not.toContain("claude-shim");
    expect(normalUp).not.toContain("codex-shim");
  });

  test("updates managed shim env values before building shim images", async () => {
    if (!fakeRepoPath) throw new Error("test repo path not initialised");

    writeFileSync(
      join(fakeRepoPath, ".env.production"),
      [
        `OPENCODE_IMAGE=${OLD_OPENCODE_SHIM_IMAGE}`,
        `CLAUDE_SHIM_IMAGE=${LEGACY_CLAUDE_SHIM_IMAGE}`,
        "CODEX_SHIM_IMAGE=ghcr.io/example/custom-codex-shim:edge",
        "",
      ].join("\n"),
    );

    const { runner, app } = makeApp();

    const res = await app.handle(
      new Request("http://localhost/jobs", {
        method: "POST",
        headers: { "X-Updater-Token": TEST_TOKEN },
      }),
    );
    const { jobId } = (await res.json()) as { jobId: string };

    await waitForStatus(runner, jobId, (s) => s === "success");

    const env = readFileSync(join(fakeRepoPath, ".env.production"), "utf8");
    expect(env).toContain("OPENCODE_IMAGE=almirant-opencode-shim:1.14.31");
    expect(env).toContain("CLAUDE_SHIM_IMAGE=almirant-claude-shim:2.1.126");
    expect(env).toContain("CODEX_SHIM_IMAGE=ghcr.io/example/custom-codex-shim:edge");

    const final = runner.getJob(jobId);
    expect(final?.logTail.some((line) =>
      line.text.includes("Keeping custom CODEX_SHIM_IMAGE"),
    )).toBe(true);
  });

  test("skips shim build when configured shim tags already exist locally", async () => {
    const { runner, app } = makeApp();

    const res = await app.handle(
      new Request("http://localhost/jobs", {
        method: "POST",
        headers: { "X-Updater-Token": TEST_TOKEN },
      }),
    );
    const { jobId } = (await res.json()) as { jobId: string };

    await waitForStatus(runner, jobId, (s) => s === "success");

    const shimBuild = fakeCommands.find((argv) =>
      argv[0] === "docker" &&
      argv.includes("--profile") &&
      argv.includes("shims") &&
      argv.includes("build")
    );
    expect(shimBuild).toBeUndefined();
  });


  test("POST /infra/tailscale-db/apply starts a redacted infra job", async () => {
    const { infraRunner, app } = makeApp();
    const previousPs = fakePsStdout;
    fakePsStdout =
      '{"Service":"tailscale-db","State":"running"}\n' +
      '{"Service":"postgres-tailnet-proxy","State":"running"}\n';

    try {
      const res = await app.handle(
        new Request("http://localhost/infra/tailscale-db/apply", {
          method: "POST",
          headers: {
            "X-Updater-Token": TEST_TOKEN,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            hostname: "almirant-db",
            tag: "tag:almirant-db",
            auth: { method: "auth_key", authKey: "tskey-auth-redacted-example" },
          }),
        }),
      );
      const { status, body } = await json(res);
      expect(status).toBe(202);
      expect(typeof body.jobId).toBe("string");

      await waitForStatus(
        { getJob: (id: string) => infraRunner.getJob(id) },
        body.jobId as string,
        (s) => s === "success",
      );

      const final = infraRunner.getJob(body.jobId as string);
      expect(final?.status).toBe("success");
      expect(JSON.stringify(final?.logTail)).not.toContain("tskey-auth-redacted-example");
    } finally {
      fakePsStdout = previousPs;
    }
  });

  test("GET /infra/tailscale-db/status returns tailnet runtime state", async () => {
    const { app } = makeApp();
    const previousPs = fakePsStdout;
    fakePsStdout =
      '{"Service":"tailscale-db","State":"running"}\n' +
      '{"Service":"postgres-tailnet-proxy","State":"running"}\n';

    try {
      const res = await app.handle(
        new Request("http://localhost/infra/tailscale-db/status", {
          headers: { "X-Updater-Token": TEST_TOKEN },
        }),
      );
      const { status, body } = await json(res);
      expect(status).toBe(200);
      expect(body.online).toBe(true);
      expect(body.tailscaleIp).toBe("100.64.0.1");
      expect(body.proxyServiceState).toBe("running");
    } finally {
      fakePsStdout = previousPs;
    }
  });

  test("GET /services/status returns allowlisted services and stopped agent containers", async () => {
    const { app } = makeApp();
    fakePsStdout =
      '{"Service":"runner","State":"running","Health":"healthy"}\n' +
      '{"Service":"web-bridge","State":"running","Health":"healthy"}\n' +
      '{"Service":"backend","State":"running","Health":"healthy"}\n';
    fakeAgentContainersStdout = [
      "abc123abc123\tagent-running\trunning\tUp 2 minutes\tjob-running\tworker-1",
      "def456def456\tagent-exited\texited\tExited (143) 30 minutes ago\tjob-exited\tworker-1",
      "",
    ].join("\n");

    const res = await app.handle(
      new Request("http://localhost/services/status", {
        headers: { "X-Updater-Token": TEST_TOKEN },
      }),
    );
    const { status, body } = await json(res);

    expect(status).toBe(200);
    expect((body.services as Array<{ service: string }>).map((s) => s.service)).toContain("runner");
    expect((body.services as Array<{ service: string }>).map((s) => s.service)).not.toContain("updater");
    expect((body.agentContainers as { exited: number }).exited).toBe(1);
    expect((body.agentContainers as { running: number }).running).toBe(1);
  });

  test("POST /services/runner/restart starts a service operation job", async () => {
    const { serviceOpsRunner, app } = makeApp();
    fakePsStdout = '{"Service":"runner","State":"running","Health":"healthy"}\n';

    const res = await app.handle(
      new Request("http://localhost/services/runner/restart", {
        method: "POST",
        headers: { "X-Updater-Token": TEST_TOKEN },
      }),
    );
    const { status, body } = await json(res);

    expect(status).toBe(202);
    expect(typeof body.jobId).toBe("string");

    await waitForStatus(
      { getJob: (id: string) => serviceOpsRunner.getJob(id) },
      body.jobId as string,
      (s) => s === "success",
    );

    const restart = fakeCommands.find((argv) =>
      argv[0] === "docker" &&
      argv.includes("compose") &&
      argv.includes("restart") &&
      argv.includes("runner")
    );
    expect(restart).toBeDefined();
    expect(restart).not.toContain("updater");
  });

  test("POST /services/updater/restart rejects non-allowlisted services", async () => {
    const { app } = makeApp();

    const res = await app.handle(
      new Request("http://localhost/services/updater/restart", {
        method: "POST",
        headers: { "X-Updater-Token": TEST_TOKEN },
      }),
    );
    const { status, body } = await json(res);

    expect(status).toBe(400);
    expect(body.error).toBe("service_not_controllable");
  });

  test("POST /services/agent-containers/cleanup-exited removes only stopped agent containers", async () => {
    const { serviceOpsRunner, app } = makeApp();
    fakeAgentContainersStdout = [
      "abc123abc123\tagent-running\trunning\tUp 2 minutes\tjob-running\tworker-1",
      "def456def456\tagent-exited\texited\tExited (143) 30 minutes ago\tjob-exited\tworker-1",
      "",
    ].join("\n");

    const res = await app.handle(
      new Request("http://localhost/services/agent-containers/cleanup-exited", {
        method: "POST",
        headers: { "X-Updater-Token": TEST_TOKEN },
      }),
    );
    const { status, body } = await json(res);

    expect(status).toBe(202);

    await waitForStatus(
      { getJob: (id: string) => serviceOpsRunner.getJob(id) },
      body.jobId as string,
      (s) => s === "success",
    );

    const rm = fakeCommands.find((argv) =>
      argv[0] === "docker" &&
      argv[1] === "rm" &&
      argv.includes("def456def456")
    );
    expect(rm).toBeDefined();
    expect(fakeCommands.some((argv) => argv.includes("abc123abc123"))).toBe(false);
  });

  test("a build failure surfaces as status=failed with stderr captured", async () => {
    const { runner, app } = makeApp();
    fakeFailureCommand = ["docker", "compose"];

    try {
      const res = await app.handle(
        new Request("http://localhost/jobs", {
          method: "POST",
          headers: { "X-Updater-Token": TEST_TOKEN },
        }),
      );
      const { jobId } = (await res.json()) as { jobId: string };

      await waitForStatus(runner, jobId, (s) => s === "failed");

      const final = runner.getJob(jobId);
      expect(final?.status).toBe("failed");
      expect(final?.errorMessage).toContain("fake injected failure");
    } finally {
      fakeFailureCommand = null;
    }
  });
});

describe("git-ops validation", () => {
  test("rejects an invalid branch name", async () => {
    const { fetchOrigin } = await import("./git-ops");
    await expect(
      fetchOrigin({ repoPath: "/tmp", branch: "bad branch with spaces" }),
    ).rejects.toThrow(/Invalid branch name/);
  });
});

describe("compose-ops validation", () => {
  test("rejects invalid service names", async () => {
    const { build } = await import("./compose-ops");
    await expect(
      build(["bad service!"], {
        repoPath: "/tmp",
        composeFile: "docker-compose.prod.yml",
        envFile: ".env.production",
        buildSha: "abc1234",
      }),
    ).rejects.toThrow(/Invalid service name/);
  });


  test("waitHealthy treats one-shot db-init exit 0 as ready", async () => {
    const { waitHealthy } = await import("./compose-ops");
    fakePsStdout =
      '{"Service":"backend","State":"running","Health":"healthy"}\n' +
      '{"Service":"db-init","State":"exited","ExitCode":0}\n';

    try {
      const result = await waitHealthy(
        ["backend", "db-init"],
        {
          repoPath: "/tmp",
          composeFile: "docker-compose.prod.yml",
          envFile: ".env.production",
          buildSha: "abc1234",
        },
        50,
        1,
      );

      expect(result.allHealthy).toBe(true);
      expect(
        result.statuses.find((s) => s.service === "db-init")?.exitCode,
      ).toBe(0);
    } finally {
      fakePsStdout =
        '{"Service":"backend","State":"running","Health":"healthy"}\n' +
        '{"Service":"frontend","State":"running","Health":"healthy"}\n';
    }
  });

  test("waitHealthy rejects one-shot db-init exit failures", async () => {
    const { waitHealthy } = await import("./compose-ops");
    fakePsStdout =
      '{"Service":"backend","State":"running","Health":"healthy"}\n' +
      '{"Service":"db-init","State":"exited","ExitCode":1}\n';

    try {
      const result = await waitHealthy(
        ["backend", "db-init"],
        {
          repoPath: "/tmp",
          composeFile: "docker-compose.prod.yml",
          envFile: ".env.production",
          buildSha: "abc1234",
        },
        10,
        1,
      );

      expect(result.allHealthy).toBe(false);
      expect(
        result.statuses.find((s) => s.service === "db-init")?.exitCode,
      ).toBe(1);
    } finally {
      fakePsStdout =
        '{"Service":"backend","State":"running","Health":"healthy"}\n' +
        '{"Service":"frontend","State":"running","Health":"healthy"}\n';
    }
  });

  test("upForceRecreate with an empty service list returns a soft error", async () => {
    const { upForceRecreate } = await import("./compose-ops");
    const result = await upForceRecreate([], {
      repoPath: "/tmp",
      composeFile: "docker-compose.prod.yml",
      envFile: ".env.production",
      buildSha: "abc1234",
    });
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("no services to recreate");
  });
});
