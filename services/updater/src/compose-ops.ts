import type { JobLogLine, SpawnResult } from "./types";
import { spawnCmd } from "./spawn";

const SERVICE_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const FILENAME_RE = /^[a-zA-Z0-9._/-]{1,200}$/;
const IMAGE_NAME_RE = /^[a-zA-Z0-9._:/-]{1,300}$/;

const validateServices = (services: string[]): void => {
  for (const s of services) {
    if (!SERVICE_NAME_RE.test(s)) {
      throw new Error(`Invalid service name: ${s}`);
    }
  }
};

const validatePath = (p: string, label: string): void => {
  if (!FILENAME_RE.test(p)) {
    throw new Error(`Invalid ${label}: ${p}`);
  }
};

const validateImage = (image: string): void => {
  if (!IMAGE_NAME_RE.test(image)) {
    throw new Error(`Invalid image name: ${image}`);
  }
};

export interface ComposeContext {
  repoPath: string;
  composeFile: string;
  envFile: string;
  buildSha: string | null;
  profiles?: string[];
  onLog?: (line: JobLogLine) => void;
}

const composeBaseArgs = (ctx: ComposeContext): string[] => {
  validatePath(ctx.composeFile, "compose file");
  validatePath(ctx.envFile, "env file");
  const profiles = ctx.profiles ?? [];
  validateServices(profiles);
  return [
    "compose",
    "-f",
    ctx.composeFile,
    "--env-file",
    ctx.envFile,
    ...profiles.flatMap((profile) => ["--profile", profile]),
  ];
};

const composeEnv = (ctx: ComposeContext): Record<string, string> => {
  const env: Record<string, string> = {};
  if (ctx.buildSha) env.ALMIRANT_BUILD_SHA = ctx.buildSha;
  return env;
};

const runDocker = (
  args: string[],
  ctx: ComposeContext,
  timeoutMs: number,
): Promise<SpawnResult> =>
  spawnCmd(["docker", ...args], {
    cwd: ctx.repoPath,
    env: composeEnv(ctx),
    onLog: ctx.onLog,
    timeoutMs,
  });

/**
 * Returns the ordered list of service names defined in the compose project.
 * Used by the recreate step to exclude the updater service itself from
 * --force-recreate (avoiding the suicide problem).
 */
export const listServices = async (
  ctx: ComposeContext,
): Promise<string[]> => {
  const result = await runDocker(
    [...composeBaseArgs(ctx), "config", "--services"],
    ctx,
    30_000,
  );
  if (!result.ok) {
    throw new Error(
      `docker compose config --services failed (exit ${result.exitCode}): ${result.stderr}`,
    );
  }
  return result.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
};

export const build = async (
  services: string[],
  ctx: ComposeContext,
): Promise<SpawnResult> => {
  validateServices(services);
  const args = [...composeBaseArgs(ctx), "build", ...services];
  return runDocker(args, ctx, 30 * 60_000);
};

export const imageExists = async (
  image: string,
  ctx: ComposeContext,
): Promise<boolean> => {
  validateImage(image);
  const result = await runDocker(["image", "inspect", image], ctx, 15_000);
  return result.ok;
};

export const upForceRecreate = async (
  services: string[],
  ctx: ComposeContext,
): Promise<SpawnResult> => {
  validateServices(services);
  if (services.length === 0) {
    return {
      ok: false,
      exitCode: 1,
      stdout: "",
      stderr: "no services to recreate",
    };
  }
  const args = [
    ...composeBaseArgs(ctx),
    "up",
    "-d",
    "--force-recreate",
    ...services,
  ];
  return runDocker(args, ctx, 10 * 60_000);
};

export const restartServices = async (
  services: string[],
  ctx: ComposeContext,
): Promise<SpawnResult> => {
  validateServices(services);
  if (services.length === 0) {
    return {
      ok: false,
      exitCode: 1,
      stdout: "",
      stderr: "no services to restart",
    };
  }

  const args = [...composeBaseArgs(ctx), "restart", ...services];
  return runDocker(args, ctx, 2 * 60_000);
};

export interface ServiceHealth {
  service: string;
  state: string;
  health: string | null;
  exitCode: number | null;
}

interface ComposePsRow {
  Service?: string;
  State?: string;
  Health?: string | null;
  ExitCode?: number | string | null;
}

/**
 * Returns the parsed `docker compose ps --format json` output. Compose v2
 * emits NDJSON (one object per line); we tolerate both NDJSON and a single
 * JSON array for forward-compat.
 */
export const ps = async (ctx: ComposeContext): Promise<ServiceHealth[]> => {
  const result = await runDocker(
    [...composeBaseArgs(ctx), "ps", "--format", "json"],
    ctx,
    15_000,
  );
  if (!result.ok) return [];
  const trimmed = result.stdout.trim();
  if (!trimmed) return [];

  const rows: ComposePsRow[] = [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) rows.push(...(parsed as ComposePsRow[]));
    } catch {
      // fall through to NDJSON
    }
  }
  if (rows.length === 0) {
    for (const line of trimmed.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        rows.push(JSON.parse(t) as ComposePsRow);
      } catch {
        // skip malformed line
      }
    }
  }

  return rows.map((r) => {
    const parsedExitCode =
      r.ExitCode === undefined || r.ExitCode === null || r.ExitCode === ""
        ? null
        : Number(r.ExitCode);

    return {
      service: r.Service ?? "",
      state: r.State ?? "unknown",
      health: r.Health ?? null,
      exitCode:
        typeof parsedExitCode === "number" && Number.isFinite(parsedExitCode)
          ? parsedExitCode
          : null,
    };
  });
};

const isServiceReady = (service: ServiceHealth): boolean => {
  if (service.health) return service.health === "healthy";
  if (service.state === "running") return true;

  // One-shot compose services such as db-init are successful when they exit
  // cleanly. Treating them as requiring State=running makes updates hang or
  // fail after a correct database maintenance run.
  return service.state === "exited" && service.exitCode === 0;
};

/**
 * Polls compose ps until every service in `services` reports a non-empty
 * Health that equals "healthy", services with no healthcheck reach
 * State=running, or one-shot services exit with code 0. Times out after
 * `timeoutMs`.
 */
export const waitHealthy = async (
  services: string[],
  ctx: ComposeContext,
  timeoutMs: number,
  pollIntervalMs = 5_000,
): Promise<{ allHealthy: boolean; statuses: ServiceHealth[] }> => {
  const deadline = Date.now() + timeoutMs;
  let statuses: ServiceHealth[] = [];
  const want = new Set(services);

  while (Date.now() < deadline) {
    statuses = await ps(ctx);
    const relevant = statuses.filter((s) => want.has(s.service));
    if (relevant.length === want.size) {
      const allOk = relevant.every(isServiceReady);
      if (allOk) return { allHealthy: true, statuses: relevant };
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await new Promise((r) =>
      setTimeout(r, Math.min(pollIntervalMs, remainingMs)),
    );
  }

  return { allHealthy: false, statuses };
};
