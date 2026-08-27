import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const read = (path: string): string =>
  readFileSync(resolve(root, path), "utf8");

type ParsedStep = {
  env?: Record<string, unknown>;
  id?: unknown;
  if?: unknown;
  name?: unknown;
  run?: unknown;
  uses?: unknown;
  with?: Record<string, unknown>;
};

type MatrixEntry = {
  context?: unknown;
  file?: unknown;
  image?: unknown;
  target?: unknown;
};

type ParsedJob = {
  if?: unknown;
  "runs-on"?: unknown;
  steps?: ParsedStep[];
  strategy?: {
    matrix?: {
      include?: MatrixEntry[];
    };
  };
};

type ParsedWorkflow = {
  jobs?: Record<string, ParsedJob>;
  on?: Record<string, unknown>;
};

const parseWorkflow = (source: string): ParsedWorkflow =>
  Bun.YAML.parse(source) as ParsedWorkflow;

const stepByName = (steps: ParsedStep[], name: string): ParsedStep => {
  const step = steps.find((candidate) => candidate.name === name);
  expect(step).toBeDefined();
  return step as ParsedStep;
};

const serialized = (value: unknown): string => JSON.stringify(value);
const disposablePaths: string[] = [];

const runPiPush = (
  run: string,
  firstDigest: string,
  secondDigest: string,
): { exitCode: number; output: string; stderr: string } => {
  const tempRoot = mkdtempSync(join(tmpdir(), "community-pi-push-contract-"));
  disposablePaths.push(tempRoot);
  const binDir = join(tempRoot, "bin");
  const stateDir = join(tempRoot, "state");
  const githubOutput = join(tempRoot, "github-output");
  mkdirSync(binDir);
  mkdirSync(stateDir);
  const fakeDocker = `#!/usr/bin/env bash
set -euo pipefail
case "\${1-}" in
  tag) exit 0 ;;
  push)
    count_file=\${FAKE_DOCKER_STATE_DIR:?}/push-count
    count=0
    if [ -f "$count_file" ]; then count=$(cat "$count_file"); fi
    count=$((count + 1))
    printf '%s\\n' "$count" > "$count_file"
    if [ "$count" -eq 1 ]; then digest=\${FAKE_FIRST_DIGEST:?}; else digest=\${FAKE_SECOND_DIGEST:?}; fi
    printf '%s: digest: %s size: 123\\n' "\${2-unknown}" "$digest"
    ;;
  *) exit 2 ;;
esac
`;
  const dockerPath = join(binDir, "docker");
  writeFileSync(dockerPath, fakeDocker, { mode: 0o755 });
  chmodSync(dockerPath, 0o755);
  writeFileSync(githubOutput, "");

  const result = Bun.spawnSync({
    cmd: ["bash", "-c", run],
    cwd: root,
    env: {
      PATH: `${binDir}:/usr/bin:/bin`,
      FAKE_DOCKER_STATE_DIR: stateDir,
      FAKE_FIRST_DIGEST: firstDigest,
      FAKE_SECOND_DIGEST: secondDigest,
      GITHUB_OUTPUT: githubOutput,
      PUBLISH_TAGS:
        "example.invalid/almirant-pi-shim:sha-test\n" +
        "example.invalid/almirant-pi-shim:latest",
    },
  });

  return {
    exitCode: result.exitCode,
    output: readFileSync(githubOutput, "utf8").trim(),
    stderr: new TextDecoder().decode(result.stderr),
  };
};

afterEach(() => {
  while (disposablePaths.length > 0) {
    const path = disposablePaths.pop();
    if (path) rmSync(path, { recursive: true, force: true });
  }
});

describe("Community Pi delivery contracts", () => {
  test("preserves the Community publication surface and adds exactly one pinned Pi target", () => {
    const workflowSource = read(".github/workflows/publish-docker.yml");
    const workflow = parseWorkflow(workflowSource);
    const publish = workflow.jobs?.publish;
    const matrix = publish?.strategy?.matrix?.include ?? [];
    const piEntries = matrix.filter((entry) => entry.image === "almirant-pi-shim");

    expect(Object.keys(workflow.jobs ?? {})).toEqual(["publish"]);
    expect(Object.prototype.hasOwnProperty.call(workflow.on ?? {}, "release"))
      .toBe(true);
    expect(
      Object.prototype.hasOwnProperty.call(workflow.on ?? {}, "workflow_dispatch"),
    ).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(workflow.on ?? {}, "pull_request"))
      .toBe(false);
    expect(publish?.if).toBe(
      "github.repository == 'fjpedrosa/almirant-community'",
    );
    expect(publish?.["runs-on"]).toBe("ubuntu-latest");
    expect(piEntries).toEqual([
      {
        image: "almirant-pi-shim",
        context: ".",
        file: "services/runner/docker/Dockerfile.pi",
        target: "",
      },
    ]);

    // All pre-existing Community images remain in the one existing publish job.
    expect(matrix.map((entry) => entry.image)).toEqual([
      "almirant-backend",
      "almirant-db-init",
      "almirant-frontend",
      "almirant-runner",
      "almirant-web-bridge",
      "almirant-discord-bridge",
      "almirant-updater",
      "almirant-claude-shim",
      "almirant-codex-shim",
      "almirant-pi-shim",
      "almirant-opencode-shim",
    ]);
    expect(workflowSource).not.toMatch(
      /cloud-publish|cloud\/static-runner|services\/scaler/,
    );
  });

  test("builds a Node-loadable canonical-events package before either shim install", () => {
    const dockerfile = read("services/runner/docker/Dockerfile.pi");
    const canonicalRoot = dockerfile.indexOf(
      "cd /app/backend/packages/canonical-events",
    );
    const canonicalInstall = dockerfile.indexOf(
      "npm install --ignore-scripts --include=dev",
      canonicalRoot,
    );
    const canonicalBuild = dockerfile.indexOf(
      "./node_modules/.bin/tsc -p tsconfig.json",
      canonicalInstall,
    );
    const manifestRewrite = dockerfile.indexOf(
      'packageJson.main = "./dist/index.js";',
      canonicalBuild,
    );
    const shimRoot = dockerfile.indexOf(
      "cd /app/services/runner/docker/shim-server",
      manifestRewrite,
    );
    const shimInstall = dockerfile.indexOf(
      "npm install --ignore-scripts --include=dev",
      shimRoot,
    );
    const shimBuild = dockerfile.indexOf("npm run build", shimInstall);
    const piRoot = dockerfile.indexOf(
      "cd /app/services/runner/docker/pi-shim",
      shimBuild,
    );
    const piInstall = dockerfile.indexOf(
      "npm install --ignore-scripts --include=dev",
      piRoot,
    );
    const piBuild = dockerfile.indexOf("npm run build", piInstall);

    expect(canonicalRoot).toBeGreaterThanOrEqual(0);
    expect(canonicalInstall).toBeGreaterThan(canonicalRoot);
    expect(canonicalBuild).toBeGreaterThan(canonicalInstall);
    expect(manifestRewrite).toBeGreaterThan(canonicalBuild);
    expect(shimRoot).toBeGreaterThan(manifestRewrite);
    expect(shimInstall).toBeGreaterThan(shimRoot);
    expect(shimBuild).toBeGreaterThan(shimInstall);
    expect(piRoot).toBeGreaterThan(shimBuild);
    expect(piInstall).toBeGreaterThan(piRoot);
    expect(piBuild).toBeGreaterThan(piInstall);

    expect(dockerfile).toContain(
      "COPY backend/tsconfig.base.json ./backend/tsconfig.base.json",
    );
    expect(dockerfile).toContain("RUN node --input-type=module <<'NODE'");
    expect(dockerfile).toContain('packageJson.types = "./dist/index.d.ts";');
    expect(dockerfile).toContain('types: "./dist/index.d.ts"');
    expect(dockerfile).toContain('default: "./dist/index.js"');
    expect(dockerfile).toContain('"dist/wave-marker.js"');
    expect(dockerfile).toContain('"dist/projection.js"');
    expect(dockerfile).not.toContain("npm install --global typescript");
  });

  test("builds one X64 Pi image, runs credential-free and expected-auth-failure gates, then pushes that image", () => {
    const workflow = parseWorkflow(read(".github/workflows/publish-docker.yml"));
    const steps = workflow.jobs?.publish?.steps ?? [];
    const genericPush = stepByName(steps, "Build and push Docker image");
    const piBuild = stepByName(steps, "Build pinned Pi image for runtime smoke");
    const credentialFree = stepByName(steps, "Smoke test Pi without credentials");
    const authFailure = stepByName(
      steps,
      "Smoke test Pi expected authentication failure",
    );
    const piPush = stepByName(steps, "Push the smoke-tested Pi image");
    const cleanup = stepByName(steps, "Drop the local Pi smoke image");
    const piCondition = "matrix.image == 'almirant-pi-shim'";
    const localTag = "local/almirant-pi-shim:runtime-smoke";

    expect(genericPush.if).toBe("matrix.image != 'almirant-pi-shim'");
    expect(genericPush.with?.push).toBe(true);
    expect(piBuild.if).toBe(piCondition);
    expect(piBuild.uses).toBe("docker/build-push-action@v6");
    expect(piBuild.with?.load).toBe(true);
    expect(piBuild.with?.push).toBeUndefined();
    expect(piBuild.with?.platforms).toBe("linux/amd64");
    expect(piBuild.with?.tags).toBe(localTag);

    expect(credentialFree.if).toBe(piCondition);
    expect(credentialFree.run).toBe(
      `bash services/runner/scripts/pi-image-smoke.sh --image ${localTag}`,
    );
    expect(credentialFree.env).toBeUndefined();
    expect(serialized(credentialFree)).not.toContain("secrets.");
    expect(serialized(credentialFree)).not.toMatch(/--env(?:-file)?/);

    expect(authFailure.if).toBe(piCondition);
    expect(typeof authFailure.run).toBe("string");
    expect(authFailure.env).toBeUndefined();
    expect(authFailure.run).toContain("set -euo pipefail");
    expect(authFailure.run).toContain("umask 077");
    expect(authFailure.run).toContain("chmod 0600");
    expect(authFailure.run).toContain(
      "ZAI_API_KEY=ALMIRANT_PI_SMOKE_INVALID_AUTH_SENTINEL_4C27B1",
    );
    expect(authFailure.run).toContain(`--image ${localTag}`);
    expect(authFailure.run).toContain("--env-file \"$credential_file\"");
    expect(authFailure.run).toContain("--env ZAI_API_KEY");
    expect(authFailure.run).toContain("--expect-auth-failure");
    expect(serialized(authFailure)).not.toContain("secrets.");

    expect(piPush.id).toBe("push-pi");
    expect(piPush.if).toBe(piCondition);
    expect(piPush.uses).toBeUndefined();
    expect(piPush.env).toEqual({
      PUBLISH_TAGS: "${{ steps.meta.outputs.tags }}",
    });
    expect(piPush.run).toContain(`local_tag=${localTag}`);
    expect(piPush.run).toContain('docker tag "$local_tag" "$tag"');
    expect(piPush.run).toContain('docker push "$tag"');
    expect(piPush.run).not.toContain("docker build");

    expect(steps.indexOf(piBuild)).toBeLessThan(steps.indexOf(credentialFree));
    expect(steps.indexOf(credentialFree)).toBeLessThan(steps.indexOf(authFailure));
    expect(steps.indexOf(authFailure)).toBeLessThan(steps.indexOf(piPush));
    expect(cleanup.if).toBe("always() && matrix.image == 'almirant-pi-shim'");
    expect(steps.indexOf(cleanup)).toBeGreaterThan(steps.indexOf(piPush));
  });

  test("validates and exports one immutable Pi deployment digest for attestation", () => {
    const workflow = parseWorkflow(read(".github/workflows/publish-docker.yml"));
    const steps = workflow.jobs?.publish?.steps ?? [];
    const piPush = stepByName(steps, "Push the smoke-tested Pi image");
    const attestation = stepByName(steps, "Generate artifact attestation");

    expect(piPush.run).toContain("^sha256:[0-9a-f]{64}$");
    expect(piPush.run).toContain(
      '[ "$published_digest" != "$digest" ]',
    );
    expect(piPush.run).toContain(
      'printf \'digest=%s\\n\' "$published_digest" >> "$GITHUB_OUTPUT"',
    );
    expect(piPush.run).toContain(
      "Pi tags resolved to different immutable digests",
    );
    expect(piPush.run).toContain("No Pi publication tags were produced");
    expect(attestation.with?.["subject-digest"]).toBe(
      "${{ matrix.image == 'almirant-pi-shim' && steps.push-pi.outputs.digest || steps.push.outputs.digest }}",
    );
    expect(steps.indexOf(attestation)).toBeGreaterThan(steps.indexOf(piPush));

    const digest = `sha256:${"a".repeat(64)}`;
    const success = runPiPush(piPush.run as string, digest, digest);
    expect(success.exitCode, success.stderr).toBe(0);
    expect(success.output).toBe(`digest=${digest}`);

    const mismatch = runPiPush(
      piPush.run as string,
      digest,
      `sha256:${"b".repeat(64)}`,
    );
    expect(mismatch.exitCode).not.toBe(0);
    expect(mismatch.stderr).toContain(
      "Pi tags resolved to different immutable digests",
    );

    const malformed = runPiPush(piPush.run as string, "mutable-tag", "mutable-tag");
    expect(malformed.exitCode).not.toBe(0);
    expect(malformed.stderr).toContain(
      "Pi push did not return an immutable digest",
    );
  });

  test("keeps legacy shim package boundaries explicit and Pi selection out of duplicate adapters", () => {
    const dockerfile = read("services/runner-claude/Dockerfile");
    const packageJson = JSON.parse(
      read("services/runner-claude/shim/package.json"),
    ) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    const lock = read("services/runner-claude/shim/bun.lock");

    expect(packageJson.dependencies["@almirant/shim-server"]).toBe(
      "file:../../runner/docker/shim-server",
    );
    expect(packageJson.scripts["build:deps"]).toBe(
      "cd ../../runner/docker/shim-server && bun run build",
    );
    expect(packageJson.devDependencies["@types/bun"]).toBe("^1.2.14");
    expect(lock).toContain(
      '"@almirant/shim-server": "file:../../runner/docker/shim-server"',
    );
    expect(lock).toContain(
      '"@almirant/canonical-events": "file:../../../../backend/packages/canonical-events"',
    );
    expect(dockerfile).toContain(
      "COPY services/runner/docker/shim-server ./services/runner/docker/shim-server",
    );
    expect(dockerfile).toContain(
      "COPY services/runner-claude/shim ./services/runner-claude/shim",
    );
    expect(dockerfile).toContain(
      "ENV SHIM_ENTRY=/app/services/runner-claude/shim/dist/index.js",
    );

    for (const adapter of [
      "services/runner-claude/shim/src/claude-adapter.ts",
      "services/runner/docker/codex-shim/src/codex-adapter.ts",
    ]) {
      expect(read(adapter)).not.toMatch(/\bPI_PROVIDER\b|\bPI_MODEL\b/);
    }
  });

  test("keeps pull-request delivery concerns out of the X64 publication workflow", () => {
    const workflowSource = read(".github/workflows/publish-docker.yml");
    const workflow = parseWorkflow(workflowSource);

    expect(Object.prototype.hasOwnProperty.call(workflow.on ?? {}, "pull_request"))
      .toBe(false);
    expect(workflowSource).not.toContain("ci-pr");
    expect(workflowSource).not.toContain("ARM64");
    expect(workflowSource.match(/platforms: linux\/amd64/g)).toHaveLength(1);
    expect(workflowSource).toContain(
      "platforms: ${{ vars.DOCKER_PLATFORMS || 'linux/amd64' }}",
    );
  });
});
