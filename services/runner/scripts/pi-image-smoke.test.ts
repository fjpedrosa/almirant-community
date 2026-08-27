import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve(import.meta.dir, "pi-image-smoke.sh");
const disposablePaths: string[] = [];
const fakeCredential = "FAKE_ZAI_API_KEY_FOR_PI_SMOKE_CONTRACT_81B37A";
const defaultSentinel =
  "ALMIRANT_PI_SMOKE_FAKE_KEY_SENTINEL_NOT_A_CREDENTIAL_7F31C2";
const rawDiagnostic = "RAW_PRIVATE_AUTH_DIAGNOSTIC_MUST_NOT_ESCAPE_6ECA51";

const fakeDocker = `#!/usr/bin/env bash
set -euo pipefail
set +x

state_dir=\${FAKE_DOCKER_STATE_DIR:?}
mkdir -p "$state_dir"
{
  printf 'CALL'
  for argument in "$@"; do printf '\\t%s' "$argument"; done
  printf '\\n'
} >> "$state_dir/argv.log"
if [[ "\${ALMIRANT_PI_SMOKE_POINT_OPERATION:-0}" == "1" ]]; then
  printf 'BOUNDED\\n' >> "$state_dir/modes.log"
else
  printf 'UNBOUNDED\\n' >> "$state_dir/modes.log"
fi

command=\${1-}
if [[ $# -gt 0 ]]; then shift; fi
case "$command" in
  run)
    printf 'running\\n' > "$state_dir/state"
    printf 'fake-container-id\\n'
    ;;
  inspect)
    [[ "$(cat "$state_dir/state" 2>/dev/null || true)" == "running" ]]
    printf 'true\\n'
    ;;
  exec)
    container=\${1-}
    if [[ $# -gt 0 ]]; then shift; fi
    case "\${1-}" in
      id)
        printf '%s\\n' "\${FAKE_DOCKER_UID:-1000}"
        ;;
      find)
        if [[ "\${FAKE_DOCKER_LEFTOVER_TMP:-0}" == "1" ]]; then
          printf '/tmp/almirant-pi-leftover\\n'
        fi
        ;;
      /bin/sh)
        ;;
      curl)
        method=GET
        data=''
        url=''
        while [[ $# -gt 0 ]]; do
          case "$1" in
            --request) method=$2; shift 2 ;;
            --data) data=$2; shift 2 ;;
            http://*) url=$1; shift ;;
            *) shift ;;
          esac
        done
        path=\${url#http://127.0.0.1:4096}
        if [[ "$path" == "/event" ]]; then
          cat <<'CONNECTED'
event: message
data: {"type":"server.connected","properties":{"timestamp":"2026-01-01T00:00:00.000Z"}}

CONNECTED
          emit_legacy_error() {
            printf '%s\\n\\n' 'event: message' 'data: {"type":"session.error"}'
          }
          emit_canonical_error() {
            printf '%s\\n\\n' 'event: message' 'data: {"type":"session.error","properties":{"kind":"session.error","message":"Runtime authentication failed.","errorCode":"PI_RPC_AUTH_ERROR","errorCategory":"config","recoverable":false,"runtimeFailure":{"schemaVersion":"runtime-failure-v1","code":"RUNTIME_AUTH_FAILURE","category":"auth","retryable":false,"message":"Runtime authentication failed.","causeCode":"PI_RPC_AUTH_ERROR"}}}'
          }
          emit_idle() {
            printf '%s\\n\\n' 'event: message' 'data: {"type":"session.idle"}'
            printf '%s\\n\\n' 'event: message' 'data: {"type":"session.idle","properties":{"kind":"session.idle"}}'
          }
          emit_success() {
            observed=$1
            printf '%s\\n\\n' 'event: message' 'data: {"type":"agent.text","properties":{"kind":"agent.text","content":"ALMIRANT_PI_SMOKE_READ_SENTINEL_V1"}}'
            printf '%s\\n\\n' 'event: message' 'data: {"type":"agent.tool_call.start","properties":{"kind":"agent.tool_call.start","toolCallId":"rti_sha256_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","toolName":"Read"}}'
            printf '%s\\n\\n' 'event: message' 'data: {"type":"agent.tool_call.result","properties":{"kind":"agent.tool_call.result","toolCallId":"rti_sha256_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","success":true}}'
            printf 'event: message\\ndata: {"type":"session.idle","properties":{"kind":"session.idle","metadata":{"runtimeEvidence":{"usage":{"status":"unavailable","reason":"not_reported"},"observed":%s}}}}\\n\\n' "$observed"
          }
          scenario=\${FAKE_DOCKER_SCENARIO:-success}
          case "$scenario" in
            success)
              emit_success '{"codingAgent":"pi","aiProvider":"zai","model":"glm-5.3"}'
              ;;
            reasoning-*)
              level=\${scenario#reasoning-}
              emit_success "{\\"codingAgent\\":\\"pi\\",\\"aiProvider\\":\\"zai\\",\\"model\\":\\"glm-5.3\\",\\"reasoningLevel\\":\\"$level\\"}"
              ;;
            wrong-tuple)
              emit_success '{"codingAgent":"pi","aiProvider":"zai","model":"glm-wrong"}'
              ;;
            extra-selection)
              emit_success '{"codingAgent":"pi","aiProvider":"zai","model":"glm-5.3","runtime":"pi"}'
              ;;
            auth)
              emit_legacy_error
              emit_canonical_error
              emit_idle
              ;;
            auth-leak)
              emit_legacy_error
              emit_canonical_error
              printf 'event: message\\ndata: {"type":"agent.text","properties":{"kind":"agent.text","content":"%s"}}\\n\\n' "\${ZAI_API_KEY}"
              emit_idle
              ;;
            diagnostic)
              printf 'event: message\\ndata: {"type":"session.error","properties":{"kind":"session.error","errorCode":"PI_RPC_PROTOCOL_ERROR","message":"%s","endpointUrl":"https://private.invalid/%s"}}\\n\\n' '${rawDiagnostic}' '${rawDiagnostic}'
              emit_idle
              ;;
            *) exit 2 ;;
          esac
          : > "$state_dir/sse-running"
          trap ': > "$state_dir/sse-stopped"; exit 0' HUP INT TERM
          while :; do sleep 1; done
        fi
        case "$method:$path" in
          GET:/health/ready) printf '{"ready":true}\\n200\\n' ;;
          GET:/health/live) printf '{"ok":true}\\n%s\\n' "\${FAKE_DOCKER_LIVE_STATUS:-200}" ;;
          POST:/session)
            printf '{"id":"session-1","provider":"%s","model":"%s","status":"idle"}\\n200\\n' \\
              "\${FAKE_DOCKER_PROVIDER:-zai}" "\${FAKE_DOCKER_MODEL:-glm-5.3}"
            ;;
          POST:/session/session-1/prompt_async) printf '\\n204\\n' ;;
          DELETE:/session/session-1) printf '\\n204\\n' ;;
          GET:/session) printf '[]\\n200\\n' ;;
          *) printf '{"error":"unexpected"}\\n500\\n' ;;
        esac
        ;;
      *) exit 2 ;;
    esac
    ;;
  stop)
    if [[ "\${FAKE_DOCKER_STOP_HANG_ONCE:-0}" == "1" && ! -f "$state_dir/hung-once" ]]; then
      : > "$state_dir/hung-once"
      trap '' TERM
      /bin/bash -c 'trap "" TERM; while :; do sleep 1; done' &
      child=$!
      printf '%s\\n' "$child" > "$state_dir/hanging-child.pid"
      wait "$child"
    fi
    printf 'stopped\\n' > "$state_dir/state"
    : > "$state_dir/stopped"
    ;;
  logs)
    if [[ "\${FAKE_DOCKER_LOG_LEAK:-0}" == "1" ]]; then
      printf '%s\\n' "\${ZAI_API_KEY}"
    else
      printf '[shim-server] stopped\\n'
    fi
    ;;
  rm)
    : > "$state_dir/removed"
    ;;
  *) exit 2 ;;
esac
`;

type RunResult = {
  exitCode: number;
  stderr: string;
  stdout: string;
};

type Harness = {
  root: string;
  stateDir: string;
  run: (args: string[], env?: Record<string, string>) => RunResult;
};

const createHarness = (): Harness => {
  const root = mkdtempSync(join(tmpdir(), "pi-image-smoke-contract-"));
  disposablePaths.push(root);
  const binDir = join(root, "bin");
  const stateDir = join(root, "state");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(binDir, "docker"), fakeDocker, { mode: 0o755 });
  chmodSync(join(binDir, "docker"), 0o755);

  return {
    root,
    stateDir,
    run(args, env = {}) {
      const result = Bun.spawnSync({
        cmd: ["/bin/bash", script, ...args],
        env: {
          PATH:
            `${binDir}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
          FAKE_DOCKER_STATE_DIR: stateDir,
          ...env,
        },
      });
      return {
        exitCode: result.exitCode,
        stderr: new TextDecoder().decode(result.stderr),
        stdout: new TextDecoder().decode(result.stdout),
      };
    },
  };
};

const lines = (path: string): string[] =>
  existsSync(path) ? readFileSync(path, "utf8").trimEnd().split("\n") : [];

const dockerCalls = (harness: Harness): string[] =>
  lines(join(harness.stateDir, "argv.log"));

const privateCredentialFile = (suffix: string): string => {
  const path = `/tmp/almirant-pi-smoke.${suffix}.env`;
  if (existsSync(path)) throw new Error("Refusing to replace credential fixture");
  disposablePaths.push(path);
  writeFileSync(path, `ZAI_API_KEY=${fakeCredential}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
};

const credentialArgs = (path: string, expectAuthFailure = false): string[] => [
  "--image",
  "local/almirant-pi:smoke",
  "--env-file",
  path,
  "--env",
  "ZAI_API_KEY",
  ...(expectAuthFailure ? ["--expect-auth-failure"] : []),
];

afterEach(() => {
  while (disposablePaths.length > 0) {
    const path = disposablePaths.pop();
    if (path) rmSync(path, { recursive: true, force: true });
  }
});

describe("pi-image-smoke.sh", () => {
  test("is executable and rejects unbounded image arguments before Docker", () => {
    const harness = createHarness();
    const missing = harness.run([]);
    const optionLike = harness.run(["--image", "--privileged"]);

    expect(statSync(script).mode & 0o111).not.toBe(0);
    expect(missing.exitCode).not.toBe(0);
    expect(optionLike.exitCode).not.toBe(0);
    expect(dockerCalls(harness)).toEqual([]);
    expect(missing.stdout + missing.stderr + optionLike.stdout + optionLike.stderr)
      .not.toContain(defaultSentinel);
  });

  test("runs credential-free with exact Pi/Z.AI/GLM selection and hardened bounded cleanup", () => {
    const harness = createHarness();
    const source = readFileSync(script, "utf8");
    const result = harness.run(["--image", "local/almirant-pi:smoke"]);
    const calls = dockerCalls(harness);
    const runCall = calls.find((call) => call.startsWith("CALL\trun\t"));

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toBe("Pi image smoke passed (credential-free mode).\n");
    expect(result.stderr).toBe("");
    expect(runCall).toContain("\t--user\t1000:1000");
    expect(runCall).toContain("\t--read-only");
    expect(runCall).toContain("\t--cap-drop\tALL");
    expect(runCall).toContain("\t--security-opt\tno-new-privileges:true");
    expect(runCall).toContain("\t--network\tnone");
    expect(runCall).toContain("\t--env\tPI_PROVIDER=zai");
    expect(runCall).toContain("\t--env\tPI_MODEL=glm-5.3");
    expect(runCall).toMatch(/\t--name\talmirant-pi-smoke-[0-9a-f]{12}\t/);
    expect(calls.join("\n")).not.toContain(defaultSentinel);
    expect(result.stdout + result.stderr).not.toContain(defaultSentinel);
    expect(lines(join(harness.stateDir, "modes.log")).every((mode) =>
      mode === "BOUNDED"
    )).toBe(true);
    expect(existsSync(join(harness.stateDir, "stopped"))).toBe(true);
    expect(existsSync(join(harness.stateDir, "removed"))).toBe(true);
    expect(source).toContain("TIMEOUT_SECONDS = 15");
    expect(source).toContain("KILL_AFTER_SECONDS = 2");
    expect(source).toContain("start_new_session=True");
    expect(source).toContain("os.killpg(process.pid, signal.SIGKILL)");
    expect(source).toContain('chmod 600 "$private_log"');
  });

  for (const level of [
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ]) {
    test(`accepts exactly documented observed reasoning level ${level}`, () => {
      const harness = createHarness();
      const credentialFile = privateCredentialFile(
        `reasoning-${level}-${process.pid}`.slice(0, 32),
      );
      const result = harness.run(credentialArgs(credentialFile), {
        FAKE_DOCKER_SCENARIO: `reasoning-${level}`,
      });

      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).toBe("Pi image smoke passed (credentialed mode).\n");
      expect(result.stderr).toBe("");
      expect(existsSync(credentialFile)).toBe(false);
    });
  }

  for (const [name, scenario] of [
    ["wrong core tuple", "wrong-tuple"],
    ["unknown selection field", "extra-selection"],
    ["undocumented reasoning level", "reasoning-arbitrary"],
  ] as const) {
    test(`rejects ${name} without raw selection output`, () => {
      const harness = createHarness();
      const credentialFile = privateCredentialFile(
        `reject-${process.pid}-${Date.now()}`.slice(0, 32),
      );
      const result = harness.run(credentialArgs(credentialFile), {
        FAKE_DOCKER_SCENARIO: scenario,
      });

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("observed.exact_selection=0");
      expect(result.stdout + result.stderr).not.toContain("glm-wrong");
      expect(result.stdout + result.stderr).not.toContain(fakeCredential);
      expect(existsSync(credentialFile)).toBe(false);
      expect(existsSync(join(harness.stateDir, "removed"))).toBe(true);
    });
  }

  test("expected-auth-failure mode validates the sanitized terminal contract", () => {
    const harness = createHarness();
    const credentialFile = privateCredentialFile(
      `auth-${process.pid}-${Date.now()}`.slice(0, 32),
    );
    const result = harness.run(credentialArgs(credentialFile, true), {
      FAKE_DOCKER_SCENARIO: "auth",
    });
    const serializedCalls = dockerCalls(harness).join("\n");

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toBe(
      "Pi image smoke passed (expected auth failure mode).\n",
    );
    expect(result.stderr).toBe("");
    expect(serializedCalls).toContain("\t--network\tbridge");
    expect(serializedCalls).toContain("\t--env\tZAI_API_KEY");
    expect(serializedCalls).not.toContain("\t--env-file\t");
    expect(serializedCalls).not.toContain(fakeCredential);
    expect(result.stdout + result.stderr).not.toContain(fakeCredential);
    expect(existsSync(credentialFile)).toBe(false);
    expect(existsSync(join(harness.stateDir, "sse-stopped"))).toBe(true);
    expect(existsSync(join(harness.stateDir, "removed"))).toBe(true);
  });

  test("rejects secret-bearing auth events without echoing full, prefix, or suffix material", () => {
    const harness = createHarness();
    const credentialFile = privateCredentialFile(
      `leak-${process.pid}-${Date.now()}`.slice(0, 32),
    );
    const result = harness.run(credentialArgs(credentialFile, true), {
      FAKE_DOCKER_SCENARIO: "auth-leak",
    });
    const combined = result.stdout + result.stderr;

    expect(result.exitCode).not.toBe(0);
    expect(combined).not.toContain(fakeCredential);
    expect(combined).not.toContain(fakeCredential.slice(0, 20));
    expect(combined).not.toContain(fakeCredential.slice(-20));
    expect(existsSync(credentialFile)).toBe(false);
    expect(existsSync(join(harness.stateDir, "removed"))).toBe(true);
  });

  test("emits only a bounded fixed-schema diagnostic for raw auth failures", () => {
    const harness = createHarness();
    const credentialFile = privateCredentialFile(
      `diagnostic-${process.pid}`.slice(0, 32),
    );
    const result = harness.run(credentialArgs(credentialFile, true), {
      FAKE_DOCKER_SCENARIO: "diagnostic",
    });
    const combined = result.stdout + result.stderr;
    const diagnostic = result.stderr.split("\n").find((line) =>
      line.startsWith("pi image smoke auth diagnostic:")
    );

    expect(result.exitCode).not.toBe(0);
    expect(diagnostic).toBeDefined();
    expect(diagnostic!.length).toBeLessThanOrEqual(640);
    expect(combined).not.toContain(rawDiagnostic);
    expect(combined).not.toContain("https://private.invalid");
    expect(combined).not.toContain(fakeCredential);
  });

  test("accepts only a private mode-0600 name-only credential file", () => {
    const harness = createHarness();
    const wrongPath = join(harness.root, "credential.env");
    writeFileSync(wrongPath, `ZAI_API_KEY=${fakeCredential}\n`, { mode: 0o600 });
    const wrongMode = privateCredentialFile(
      `mode-${process.pid}-${Date.now()}`.slice(0, 32),
    );
    chmodSync(wrongMode, 0o640);

    const missing = harness.run([
      "--image",
      "local/almirant-pi:smoke",
      "--expect-auth-failure",
    ]);
    const outsideTmp = harness.run(credentialArgs(wrongPath));
    const permissive = harness.run(credentialArgs(wrongMode));
    const valuedName = harness.run([
      "--image",
      "local/almirant-pi:smoke",
      "--env-file",
      wrongMode,
      "--env",
      `ZAI_API_KEY=${fakeCredential}`,
      "--expect-auth-failure",
    ]);

    expect(missing.exitCode).not.toBe(0);
    expect(outsideTmp.exitCode).not.toBe(0);
    expect(permissive.exitCode).not.toBe(0);
    expect(valuedName.exitCode).not.toBe(0);
    expect(dockerCalls(harness)).toEqual([]);
    expect(
      missing.stdout + missing.stderr + outsideTmp.stdout + outsideTmp.stderr +
        permissive.stdout + permissive.stderr + valuedName.stdout + valuedName.stderr,
    ).not.toContain(fakeCredential);
  });

  test("kills and reaps a hung Docker process group within the hard bound", async () => {
    const harness = createHarness();
    const startedAt = performance.now();
    const result = harness.run(["--image", "local/almirant-pi:smoke"], {
      FAKE_DOCKER_STOP_HANG_ONCE: "1",
    });
    const elapsed = performance.now() - startedAt;
    const childPid = Number(
      readFileSync(join(harness.stateDir, "hanging-child.pid"), "utf8").trim(),
    );
    const alive = (): boolean => {
      try {
        process.kill(childPid, 0);
        return true;
      } catch {
        return false;
      }
    };
    for (let attempt = 0; attempt < 20 && alive(); attempt += 1) {
      await Bun.sleep(50);
    }

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(
      "pi image smoke: container did not stop within the cleanup bound",
    );
    expect(elapsed).toBeLessThan(25_000);
    expect(alive()).toBe(false);
    expect(existsSync(join(harness.stateDir, "stopped"))).toBe(true);
    expect(existsSync(join(harness.stateDir, "removed"))).toBe(true);
  }, 30_000);
});
