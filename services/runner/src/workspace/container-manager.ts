import { PassThrough } from "node:stream";
import { readdir, rm, stat, access } from "node:fs/promises";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFileCb);
import Docker from "dockerode";
import type { ContainerStats, ManagedContainerInfo, RunnerContainerSpec } from "../shared/types";
import type { ContainerDriver, DriverCapabilities } from "./container-driver";


export type ContainerCleanupIssue = {
  containerId: string;
  jobId?: string;
  action: "stop" | "kill" | "remove" | "inspect" | "top";
  message: string;
  zombieSuspected: boolean;
};

export type ContainerCleanupResult = {
  removed: number;
  failed: number;
  zombieSuspected: number;
  issues: ContainerCleanupIssue[];
};

export type ContainerHealthAnomaly = {
  containerId: string;
  jobId?: string;
  state?: string;
  dead: boolean;
  zombieProcessCount: number;
  zombieSuspected: boolean;
  message: string;
};

type DockerTopResult = {
  Titles?: string[];
  Processes?: Array<Array<string | number>>;
};

const DOCKER_OPERATION_TIMEOUT_MS = 15_000;
const ZOMBIE_ERROR_PATTERN = /zombie|can not be killed|cannot be killed/i;
const ALREADY_STOPPED_ERROR_PATTERN =
  /not running|is not running|already stopped|container.*stopped/i;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isZombieLikeError = (error: unknown): boolean =>
  ZOMBIE_ERROR_PATTERN.test(errorMessage(error));

const isAlreadyStoppedError = (error: unknown): boolean =>
  ALREADY_STOPPED_ERROR_PATTERN.test(errorMessage(error));

const withOperationTimeout = async <T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};


const topContainer = (
  container: unknown,
  options: Record<string, string>,
): Promise<DockerTopResult> => {
  return new Promise((resolve, reject) => {
    const top = (container as {
      top: (
        options: Record<string, string>,
        callback?: (error: unknown, result?: DockerTopResult) => void,
      ) => Promise<DockerTopResult> | void;
    }).top;

    const maybePromise = top.call(container, options, (error, result) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(result ?? {});
    });

    if (maybePromise && typeof (maybePromise as Promise<DockerTopResult>).then === "function") {
      void (maybePromise as Promise<DockerTopResult>).then(resolve, reject);
    }
  });
};

const countZombieProcesses = (topResult: DockerTopResult): number => {
  const titles = topResult.Titles ?? [];
  const statIndex = titles.findIndex((title) => title.toUpperCase() === "STAT");
  const statusIndex = statIndex >= 0
    ? statIndex
    : titles.findIndex((title) => ["S", "STATE", "STATUS"].includes(title.toUpperCase()));

  if (statusIndex < 0) return 0;

  return (topResult.Processes ?? []).filter((process) => {
    const state = String(process[statusIndex] ?? "");
    return /Z/.test(state);
  }).length;
};

type ContainerManagerConfig = {
  dockerSocketPath: string;
  workerId: string;
  managedLabelKey?: string;
  managedLabelValue?: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  docker?: Docker;
  /** GHCR credentials for pulling private images. */
  registryAuth?: { username: string; password: string; serveraddress: string };
  /**
   * Direct Docker socket path for archive/exec operations that don't work
   * through the Docker socket proxy (which blocks PUT/exec-hijack).
   * Falls back to the main docker client if not provided.
   */
  directSocketPath?: string;
};

const DEFAULT_MANAGED_LABEL_KEY = "almirant-runner";
const DEFAULT_MANAGED_LABEL_VALUE = "true";

/**
 * Check if a directory is a git repo with unpushed commits.
 * Returns the list of unpushed commit summaries, or an empty array if
 * the directory is not a git repo or has no unpushed commits.
 */
async function getUnpushedCommits(dirPath: string): Promise<string[]> {
  try {
    await access(`${dirPath}/.git`);
  } catch {
    return []; // Not a git repo
  }

  try {
    // Get the current branch name
    const { stdout: branchName } = await execFileAsync(
      "git",
      ["-C", dirPath, "branch", "--show-current"],
      { timeout: 5_000 },
    );
    const branch = branchName.trim() || "main";

    // Check for commits ahead of the remote tracking branch
    const { stdout } = await execFileAsync(
      "git",
      ["-C", dirPath, "log", "--oneline", `origin/${branch}..HEAD`],
      { timeout: 5_000 },
    );

    const lines = stdout.trim().split("\n").filter(Boolean);
    return lines;
  } catch {
    // If origin doesn't exist or any git error, treat as no unpushed commits
    return [];
  }
}

const wait = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const toIso = (epochSeconds?: number): string | undefined => {
  if (typeof epochSeconds !== "number") return undefined;
  return new Date(epochSeconds * 1000).toISOString();
};

export class ContainerManager implements ContainerDriver {
  /** Docker mounts host dirs into containers and uses bridge networks. */
  public readonly capabilities: DriverCapabilities = {
    workspace: "host-bind",
    networking: "bridge",
  };

  private readonly docker: Docker;
  /** Direct socket client for archive/exec ops that fail through the proxy. */
  private readonly directDocker: Docker;
  private readonly workerId: string;
  private readonly managedLabelKey: string;
  private readonly managedLabelValue: string;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly registryAuth?: { username: string; password: string; serveraddress: string };

  /**
   * Build a Docker client from either a socket path or a TCP URL.
   * Supports `tcp://host:port` and `http://host:port` for Docker socket proxies,
   * or a local socket path like `/var/run/docker.sock`.
   */
  private static buildDockerClient(dockerPath: string): Docker {
    if (dockerPath.startsWith("tcp://") || dockerPath.startsWith("http://")) {
      const url = new URL(dockerPath.replace(/^tcp:\/\//, "http://"));
      return new Docker({
        host: url.hostname,
        port: Number(url.port) || 2375,
      });
    }
    return new Docker({ socketPath: dockerPath });
  }

  constructor(config: ContainerManagerConfig) {
    this.docker = config.docker ?? ContainerManager.buildDockerClient(config.dockerSocketPath);
    this.directDocker = config.directSocketPath
      ? new Docker({ socketPath: config.directSocketPath })
      : this.docker;
    this.workerId = config.workerId;
    this.managedLabelKey = config.managedLabelKey ?? DEFAULT_MANAGED_LABEL_KEY;
    this.managedLabelValue = config.managedLabelValue ?? DEFAULT_MANAGED_LABEL_VALUE;
    this.now = config.now ?? (() => Date.now());
    this.sleep = config.sleep ?? wait;
    this.registryAuth = config.registryAuth;
  }

  public async ping(): Promise<boolean> {
    try {
      await this.docker.ping();
      return true;
    } catch {
      return false;
    }
  }

  private async hasLocalImage(image: string): Promise<boolean> {
    try {
      await this.docker.getImage(image).inspect();
      return true;
    } catch {
      return false;
    }
  }

  public async pullImage(image: string): Promise<void> {
    const localImageExists = await this.hasLocalImage(image);

    try {
      const needsAuth = this.registryAuth && image.includes(this.registryAuth.serveraddress);
      const stream = await this.docker.pull(image, needsAuth ? { authconfig: this.registryAuth } : {});
      await new Promise<void>((resolve, reject) => {
        this.docker.modem.followProgress(
          stream,
          (error: unknown) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          },
          () => undefined
        );
      });
    } catch (error) {
      // Some deployments pin a locally built image name (for example
      // "almirant-opencode:latest"). Docker still tries to resolve that name
      // against a registry during pull; if the local image exists we can keep
      // using it instead of failing the whole job before Discord handoff.
      if (localImageExists) {
        return;
      }

      throw error;
    }
  }

  /**
   * Security model for agent containers:
   *
   * - seccomp: Docker's default profile (blocks ~44 dangerous syscalls).
   *   Enforced by stripping any "seccomp=unconfined" overrides below.
   * - no-new-privileges: Prevents privilege escalation via setuid/setgid binaries.
   *   Always injected as a baseline even if the caller omits it.
   * - CapDrop ALL: Drops every Linux capability (NET_RAW, SYS_ADMIN, etc.).
   *   Always injected as a baseline even if the caller omits it.
   * - ReadonlyRootfs: Root filesystem is read-only; writable paths are tmpfs mounts
   *   (/workspace, /tmp, /home/opencode) with size limits and nosuid/nodev.
   * - Non-root user: Containers run as uid/gid 1001:1001.
   * - Resource limits: CPU (NanoCpus) and memory (Memory) caps per container.
   * - Network: Containers are attached to an internal agent-network with egress
   *   routed exclusively through a Squid allowlist proxy.
   */
  public async createContainer(jobId: string, spec: RunnerContainerSpec): Promise<string> {
    const labels = {
      [this.managedLabelKey]: this.managedLabelValue,
      "worker-id": this.workerId,
      "job-id": jobId,
      ...(spec.labels ?? {}),
    };

    const env = Object.entries(spec.env)
      .filter(([, value]) => typeof value === "string")
      .map(([key, value]) => `${key}=${value}`);

    const binds = (spec.volumes ?? []).map((mount) => {
      return `${mount.source}:${mount.target}${mount.readOnly ? ":ro" : ""}`;
    });

    // -- Security baseline (defense-in-depth) ---------------------------------
    // Ensure no-new-privileges is always present and seccomp=unconfined is never
    // allowed, regardless of what the caller passes in spec.securityOpt.
    const callerSecOpts = (spec.securityOpt ?? []).filter(
      (opt) => !opt.startsWith("seccomp=")
    );
    const securityOpt = callerSecOpts.includes("no-new-privileges:true")
      ? callerSecOpts
      : ["no-new-privileges:true", ...callerSecOpts];

    // Ensure ALL capabilities are dropped even if the caller forgets.
    const capDrop =
      spec.capDrop && spec.capDrop.length > 0 ? spec.capDrop : ["ALL"];

    const container = await this.docker.createContainer({
      Image: spec.image,
      Env: env,
      Cmd: spec.command,
      Entrypoint: spec.entrypoint,
      WorkingDir: spec.workingDir,
      User: spec.user,
      Tty: spec.tty ?? true,
      Labels: labels,
      ExposedPorts: spec.portBindings
        ? Object.fromEntries(Object.keys(spec.portBindings).map((port) => [port, {}]))
        : undefined,
      HostConfig: {
        // Enable Docker's tiny init process so orphaned child processes are
        // reaped instead of accumulating as zombies inside agent containers.
        Init: true,
        Binds: binds,
        PortBindings: spec.portBindings,
        Tmpfs: spec.tmpfs,
        SecurityOpt: securityOpt,
        CapDrop: capDrop,
        ReadonlyRootfs: spec.readOnlyRootFs ?? false,
        NanoCpus:
          typeof spec.cpuLimit === "number" && spec.cpuLimit > 0
            ? Math.round(spec.cpuLimit * 1_000_000_000)
            : undefined,
        Memory:
          typeof spec.memoryLimitMb === "number" && spec.memoryLimitMb > 0
            ? spec.memoryLimitMb * 1024 * 1024
            : undefined,
      },
    });

    return container.id;
  }

  public async startContainer(containerId: string): Promise<void> {
    const container = this.docker.getContainer(containerId);
    await container.start();
  }

  public async streamContainerLogs(containerId: string): Promise<NodeJS.ReadableStream> {
    const container = this.docker.getContainer(containerId);
    const stream = await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
      timestamps: false,
    });

    return stream;
  }

  public async waitContainer(containerId: string): Promise<number> {
    const container = this.docker.getContainer(containerId);
    const result = (await container.wait()) as { StatusCode?: number };
    return result.StatusCode ?? 0;
  }

  public async getContainerIp(containerId: string, preferNetwork?: string): Promise<string> {
    const container = this.docker.getContainer(containerId);
    const info = (await container.inspect()) as {
      NetworkSettings?: {
        Networks?: Record<string, { IPAddress?: string } | undefined>;
        IPAddress?: string;
      };
    };

    const networks = info.NetworkSettings?.Networks ?? {};

    // Prefer the specified network (e.g. "runner_default" for sibling containers)
    if (preferNetwork) {
      const preferred = networks[preferNetwork];
      if (preferred?.IPAddress) {
        return preferred.IPAddress;
      }
    }

    // Fall back to any network with an IP
    for (const net of Object.values(networks)) {
      if (net?.IPAddress) {
        return net.IPAddress;
      }
    }

    // Fall back to top-level IPAddress
    if (info.NetworkSettings?.IPAddress) {
      return info.NetworkSettings.IPAddress;
    }

    throw new Error(`No IP address found for container ${containerId}`);
  }

  public async connectToNetwork(containerId: string, networkName: string): Promise<void> {
    const network = this.docker.getNetwork(networkName);
    await network.connect({ Container: containerId });
  }

  public async createNetwork(name: string): Promise<string> {
    const network = await this.docker.createNetwork({
      Name: name,
      Driver: "bridge",
      Labels: {
        [this.managedLabelKey]: this.managedLabelValue,
        "worker-id": this.workerId,
      },
    });
    return network.id;
  }

  public async removeNetwork(name: string): Promise<void> {
    try {
      const network = this.docker.getNetwork(name);
      await network.remove();
    } catch {
      // Ignore if already removed or doesn't exist.
    }
  }

  public async getRunnerNetworkName(): Promise<string | null> {
    // Detect which custom network this runner container is on.
    // Tries multiple strategies:
    //   1. By container ID (docker-compose sets hostname = container ID)
    //   2. By hostname as container name (if hostname matches --name)
    //   3. By well-known container name "almirant-runner" (systemd/cloud-init)
    try {
      const hostname = (await import("node:os")).hostname();

      const candidates = [hostname, "almirant-runner"];
      let containers: Awaited<ReturnType<typeof this.docker.listContainers>> = [];

      // Try by container ID first
      containers = await this.docker.listContainers({
        all: false,
        filters: { id: [hostname] },
      });

      // Then try by name with each candidate
      for (const name of candidates) {
        if (containers.length > 0) break;
        containers = await this.docker.listContainers({
          all: false,
          filters: { name: [name] },
        });
      }

      if (containers.length === 0) return null;

      const container = this.docker.getContainer(containers[0].Id);
      const info = (await container.inspect()) as {
        NetworkSettings?: {
          Networks?: Record<string, unknown>;
        };
      };

      const networks = Object.keys(info.NetworkSettings?.Networks ?? {});
      // Return the first non-default network (docker-compose creates custom networks)
      return networks.find((n) => n !== "bridge" && n !== "host" && n !== "none") ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Inspect a container to get its detailed state (running, OOM-killed, exit code).
   * Returns a summary of the container's current state for error classification.
   */
  public async inspectContainer(containerId: string): Promise<{
    running: boolean;
    oomKilled: boolean;
    exitCode: number | null;
  }> {
    try {
      const container = this.docker.getContainer(containerId);
      const info = await container.inspect();
      return {
        running: info.State?.Running === true,
        oomKilled: info.State?.OOMKilled === true,
        exitCode: typeof info.State?.ExitCode === "number" ? info.State.ExitCode : null,
      };
    } catch {
      return { running: false, oomKilled: false, exitCode: null };
    }
  }

  /**
   * Check if a container is in a running state.
   * Returns false if the container doesn't exist or has exited.
   */
  public async isContainerRunning(containerId: string): Promise<boolean> {
    try {
      const container = this.docker.getContainer(containerId);
      const info = await container.inspect();
      return info.State?.Running === true;
    } catch {
      return false;
    }
  }

  private async stopContainerStrict(
    containerId: string,
    gracefulTimeoutMs = 10_000,
    operationTimeoutMs = DOCKER_OPERATION_TIMEOUT_MS,
  ): Promise<void> {
    const container = this.docker.getContainer(containerId);

    try {
      await withOperationTimeout(
        container.stop({
          t: Math.max(1, Math.floor(gracefulTimeoutMs / 1000)),
        }),
        operationTimeoutMs,
        `docker stop ${containerId.slice(0, 12)}`,
      );
      return;
    } catch (stopError) {
      if (isZombieLikeError(stopError)) throw stopError;
    }

    await withOperationTimeout(
      container.kill(),
      operationTimeoutMs,
      `docker kill ${containerId.slice(0, 12)}`,
    );
  }

  private async removeContainerStrict(
    containerId: string,
    force = true,
    operationTimeoutMs = DOCKER_OPERATION_TIMEOUT_MS,
  ): Promise<void> {
    const container = this.docker.getContainer(containerId);
    await withOperationTimeout(
      container.remove({ force }),
      operationTimeoutMs,
      `docker rm ${containerId.slice(0, 12)}`,
    );
  }

  public async stopContainer(containerId: string, gracefulTimeoutMs = 10_000): Promise<void> {
    try {
      await this.stopContainerStrict(containerId, gracefulTimeoutMs);
    } catch {
      // Keep legacy behavior for callers that treat cleanup as best-effort.
    }
  }

  public async removeContainer(containerId: string, force = true): Promise<void> {
    try {
      await this.removeContainerStrict(containerId, force);
    } catch {
      // Keep legacy behavior for callers that treat cleanup as best-effort.
    }
  }

  public async detectManagedContainerAnomalies(): Promise<ContainerHealthAnomaly[]> {
    const managed = await this.listManagedContainers();
    const anomalies: ContainerHealthAnomaly[] = [];

    for (const info of managed) {
      const container = this.docker.getContainer(info.id);
      const jobId = info.labels["job-id"];
      let dead = info.state === "dead";
      let state = info.state;
      let zombieProcessCount = 0;
      const messages: string[] = [];

      try {
        const inspect = await withOperationTimeout(
          container.inspect(),
          DOCKER_OPERATION_TIMEOUT_MS,
          `docker inspect ${info.id.slice(0, 12)}`,
        ) as { State?: { Dead?: boolean; Status?: string; Running?: boolean } };
        dead = dead || inspect.State?.Dead === true;
        state = inspect.State?.Status ?? state;
      } catch (error) {
        messages.push(`inspect failed: ${errorMessage(error)}`);
      }

      try {
        const top = await withOperationTimeout(
          topContainer(container, { ps_args: "-eo pid,stat,comm" }),
          DOCKER_OPERATION_TIMEOUT_MS,
          `docker top ${info.id.slice(0, 12)}`,
        );
        zombieProcessCount = countZombieProcesses(top);
      } catch (error) {
        const message = errorMessage(error);
        // docker top can fail for exited containers; keep it as diagnostic only.
        if (info.state === "running") messages.push(`top failed: ${message}`);
      }

      if (dead) messages.push("Docker reports container as dead");
      if (zombieProcessCount > 0) messages.push(`${zombieProcessCount} zombie process(es) detected`);

      if (messages.length > 0 && (dead || zombieProcessCount > 0)) {
        anomalies.push({
          containerId: info.id,
          jobId,
          state,
          dead,
          zombieProcessCount,
          zombieSuspected: dead || zombieProcessCount > 0,
          message: messages.join("; "),
        });
      }
    }

    return anomalies;
  }

  public async execInContainer(
    containerId: string,
    cmd: string[],
    workingDir = "/workspace/repo"
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const container = this.directDocker.getContainer(containerId);
    const exec = await container.exec({
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
      User: "1001:1001",
      WorkingDir: workingDir,
    });

    const stream = await exec.start({});

    return new Promise((resolve, reject) => {
      const stdoutPass = new PassThrough();
      const stderrPass = new PassThrough();
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      stdoutPass.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
      stderrPass.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

      this.directDocker.modem.demuxStream(stream, stdoutPass, stderrPass);

      stream.on("end", () => {
        exec.inspect()
          .then((inspectResult) => {
            const result = inspectResult as { ExitCode?: number };
            resolve({
              exitCode: result.ExitCode ?? 0,
              stdout: Buffer.concat(stdoutChunks).toString("utf8"),
              stderr: Buffer.concat(stderrChunks).toString("utf8"),
            });
          })
          .catch(reject);
      });

      stream.on("error", reject);
    });
  }

  /**
   * Write a small file inside a running container via exec.
   *
   * Safety: content is base64-encoded (alphabet `[A-Za-z0-9+/=]`) so the
   * single-quoted `echo` is safe. `filePath` must not contain double-quotes.
   */
  public async writeFileViaExec(
    containerId: string,
    filePath: string,
    content: string,
  ): Promise<void> {
    const encoded = Buffer.from(content).toString("base64");
    const result = await this.execInContainer(
      containerId,
      ["sh", "-c", `echo '${encoded}' | base64 -d > "${filePath}" && chmod 755 "${filePath}"`],
      "/"
    );
    if (result.exitCode !== 0) {
      throw new Error(`writeFileViaExec failed (exit ${result.exitCode}): ${result.stderr}`);
    }
  }

  /**
   * Write a Buffer to a file inside a running container via exec.
   * Handles large files by chunking the base64-encoded content.
   */
  public async writeFileBufferViaExec(
    containerId: string,
    filePath: string,
    content: Buffer,
    mode = "0644",
  ): Promise<void> {
    const encoded = content.toString("base64");
    const dir = filePath.substring(0, filePath.lastIndexOf("/"));

    // ARG_MAX is typically ~2MB on Linux; stay well under with 500KB chunks
    const CHUNK_SIZE = 500_000;

    if (encoded.length <= CHUNK_SIZE) {
      const result = await this.execInContainer(
        containerId,
        ["sh", "-c", `mkdir -p "${dir}" && echo '${encoded}' | base64 -d > "${filePath}" && chmod ${mode} "${filePath}"`],
        "/",
      );
      if (result.exitCode !== 0) {
        throw new Error(`writeFileBufferViaExec failed (exit ${result.exitCode}): ${result.stderr}`);
      }
    } else {
      const tmpFile = `${filePath}.b64tmp`;

      const mkdirResult = await this.execInContainer(
        containerId,
        ["sh", "-c", `mkdir -p "${dir}"`],
        "/",
      );
      if (mkdirResult.exitCode !== 0) {
        throw new Error(`writeFileBufferViaExec mkdir failed (exit ${mkdirResult.exitCode}): ${mkdirResult.stderr}`);
      }

      for (let i = 0; i < encoded.length; i += CHUNK_SIZE) {
        const chunk = encoded.slice(i, i + CHUNK_SIZE);
        const op = i === 0 ? ">" : ">>";
        const result = await this.execInContainer(
          containerId,
          ["sh", "-c", `printf '%s' '${chunk}' ${op} "${tmpFile}"`],
          "/",
        );
        if (result.exitCode !== 0) {
          throw new Error(`writeFileBufferViaExec chunk write failed (exit ${result.exitCode}): ${result.stderr}`);
        }
      }

      const decodeResult = await this.execInContainer(
        containerId,
        ["sh", "-c", `base64 -d "${tmpFile}" > "${filePath}" && chmod ${mode} "${filePath}" && rm -f "${tmpFile}"`],
        "/",
      );
      if (decodeResult.exitCode !== 0) {
        throw new Error(`writeFileBufferViaExec decode failed (exit ${decodeResult.exitCode}): ${decodeResult.stderr}`);
      }
    }
  }

  /**
   * Restore a tar archive inside a running container by writing it as a temp
   * file via exec, then extracting. Handles large archives via chunked writes.
   */
  public async restoreArchiveViaExec(
    containerId: string,
    tarBuffer: Buffer,
    extractPath: string,
  ): Promise<void> {
    const tmpTar = `/tmp/restore-${Date.now()}.tar`;
    await this.writeFileBufferViaExec(containerId, tmpTar, tarBuffer);
    const result = await this.execInContainer(
      containerId,
      ["sh", "-c", `tar xf "${tmpTar}" -C "${extractPath}" && rm -f "${tmpTar}"`],
      "/",
    );
    if (result.exitCode !== 0) {
      throw new Error(`restoreArchiveViaExec: extract failed (exit ${result.exitCode}): ${result.stderr}`);
    }
  }

  public async getArchiveFromContainer(
    containerId: string,
    path: string
  ): Promise<NodeJS.ReadableStream> {
    const container = this.directDocker.getContainer(containerId);
    return container.getArchive({ path }) as Promise<NodeJS.ReadableStream>;
  }

  /**
   * Extract the workspace archive from a running container.
   *
   * Uses Docker's HTTP-based getArchive API which works reliably through
   * TCP proxies (no exec/hijack required). Returns the raw tar buffer.
   */
  public async extractWorkspaceArchive(
    containerId: string,
    path = "/workspace/repo",
    timeoutMs = 60_000,
  ): Promise<Buffer> {
    const archiveStream = await this.getArchiveFromContainer(containerId, path);
    const chunks: Buffer[] = [];
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      if (typeof (archiveStream as NodeJS.ReadableStream & { destroy?: (error?: Error) => void }).destroy === "function") {
        (archiveStream as NodeJS.ReadableStream & { destroy?: (error?: Error) => void }).destroy?.(
          new Error(`Timed out extracting archive from ${path} after ${timeoutMs}ms`),
        );
      }
    }, timeoutMs);

    try {
      for await (const chunk of archiveStream as AsyncIterable<Buffer>) {
        chunks.push(chunk);
      }
    } catch (error) {
      if (timedOut) {
        throw new Error(`Timed out extracting archive from ${path} after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    return Buffer.concat(chunks);
  }

  public async putArchiveToContainer(
    containerId: string,
    tarBuffer: Buffer,
    path: string
  ): Promise<void> {
    const container = this.directDocker.getContainer(containerId);
    await container.putArchive(tarBuffer, { path });
  }

  /**
   * Collect per-container CPU & memory stats for all running managed containers.
   */
  public async getContainerStats(): Promise<ContainerStats[]> {
    const managed = await this.listManagedContainers();
    const running = managed.filter((c) => c.state === "running");

    const results: ContainerStats[] = [];

    for (const info of running) {
      try {
        const container = this.docker.getContainer(info.id);
        const stats = (await container.stats({ stream: false })) as {
          cpu_stats: {
            cpu_usage: { total_usage: number };
            system_cpu_usage: number;
            online_cpus?: number;
          };
          precpu_stats: {
            cpu_usage: { total_usage: number };
            system_cpu_usage: number;
          };
          memory_stats: {
            usage: number;
            limit: number;
          };
        };

        const cpuDelta =
          stats.cpu_stats.cpu_usage.total_usage -
          stats.precpu_stats.cpu_usage.total_usage;
        const systemDelta =
          stats.cpu_stats.system_cpu_usage -
          stats.precpu_stats.system_cpu_usage;
        const numCpus = stats.cpu_stats.online_cpus ?? 1;

        const cpuPercent =
          systemDelta > 0 ? (cpuDelta / systemDelta) * numCpus * 100 : 0;

        const memUsageMb = stats.memory_stats.usage / (1024 * 1024);
        const memLimitMb = stats.memory_stats.limit / (1024 * 1024);
        const memPercent =
          stats.memory_stats.limit > 0
            ? (stats.memory_stats.usage / stats.memory_stats.limit) * 100
            : 0;

        results.push({
          containerId: info.id,
          jobId: info.labels["job-id"] ?? "",
          cpuPercent: Math.round(cpuPercent * 100) / 100,
          memoryUsageMb: Math.round(memUsageMb),
          memoryLimitMb: Math.round(memLimitMb),
          memoryPercent: Math.round(memPercent * 100) / 100,
        });
      } catch {
        // Container may have exited between list and stats — skip it.
      }
    }

    return results;
  }

  public async listManagedContainers(): Promise<ManagedContainerInfo[]> {
    const items = await this.docker.listContainers({
      all: true,
      filters: {
        label: [`${this.managedLabelKey}=${this.managedLabelValue}`],
      },
    });

    return items.map((item) => ({
      id: item.Id,
      image: item.Image,
      labels: item.Labels ?? {},
      state: item.State,
      createdAt: toIso(item.Created),
    }));
  }

  public async cleanupOrphanedContainers(args: {
    activeJobIds: string[];
    olderThanMs?: number;
    /** Runner-local path to workspace directories (e.g. "/app/repos"). */
    repositoryPath?: string;
  }): Promise<ContainerCleanupResult> {
    const olderThanMs = args.olderThanMs ?? 30 * 60 * 1000;
    const active = new Set(args.activeJobIds);
    const managed = await this.listManagedContainers();

    const result: ContainerCleanupResult = {
      removed: 0,
      failed: 0,
      zombieSuspected: 0,
      issues: [],
    };

    const recordIssue = (issue: ContainerCleanupIssue): void => {
      result.failed += 1;
      if (issue.zombieSuspected) result.zombieSuspected += 1;
      result.issues.push(issue);
    };

    for (const container of managed) {
      const jobId = container.labels["job-id"];
      if (!jobId || active.has(jobId)) {
        continue;
      }

      const createdAt = container.createdAt
        ? new Date(container.createdAt).getTime()
        : this.now();
      if (this.now() - createdAt < olderThanMs) {
        continue;
      }

      if (container.state === "running") {
        try {
          await this.stopContainerStrict(container.id, 3000);
        } catch (error) {
          const message = errorMessage(error);
          const zombieSuspected = isZombieLikeError(error);
          if (!zombieSuspected && !isAlreadyStoppedError(error)) {
            recordIssue({
              containerId: container.id,
              jobId,
              action: "stop",
              message,
              zombieSuspected,
            });
            console.warn(
              `[container-cleanup] Failed to stop orphaned container ${container.id.slice(0, 12)} ` +
              `(job=${jobId}): ${message}`
            );
            continue;
          }

          if (zombieSuspected) {
            recordIssue({
              containerId: container.id,
              jobId,
              action: "kill",
              message,
              zombieSuspected,
            });
            console.warn(
              `[container-cleanup] Failed to stop orphaned container ${container.id.slice(0, 12)} ` +
              `(job=${jobId}): ${message}`
            );
            continue;
          }

          console.warn(
            `[container-cleanup] Orphaned container ${container.id.slice(0, 12)} ` +
            `(job=${jobId}) was already stopped; removing it`
          );
        }
      }

      try {
        await this.removeContainerStrict(container.id, true);
        result.removed += 1;
      } catch (error) {
        const message = errorMessage(error);
        const zombieSuspected = isZombieLikeError(error);
        recordIssue({
          containerId: container.id,
          jobId,
          action: "remove",
          message,
          zombieSuspected,
        });
        console.warn(
          `[container-cleanup] Failed to remove orphaned container ${container.id.slice(0, 12)} ` +
          `(job=${jobId}): ${message}`
        );
      }

      await this.sleep(25);
    }

    // Clean up orphaned job directories on disk (each contains workspace/ and home/ subdirs)
    if (args.repositoryPath) {
      try {
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const GRACE_PERIOD_MS = 2 * 60 * 1000; // 2 minutes
        const entries = await readdir(args.repositoryPath, { withFileTypes: true });
        // Collect active container job IDs for cross-reference
        const containerJobIds = new Set(
          managed.map((c) => c.labels["job-id"]).filter(Boolean)
        );

        for (const entry of entries) {
          if (!entry.isDirectory() || !UUID_RE.test(entry.name)) continue;

          const dirPath = `${args.repositoryPath}/${entry.name}`;
          // Skip directories younger than grace period (prevents race with newly started jobs)
          try {
            const dirStat = await stat(dirPath);
            if (this.now() - dirStat.mtimeMs < GRACE_PERIOD_MS) continue;
          } catch {
            continue;
          }

          // Skip if there's an active job or running container for this ID
          if (active.has(entry.name) || containerJobIds.has(entry.name)) continue;

          // Safety check: do not delete workspaces with unpushed git commits.
          // The workspace subdir contains the git repo (new layout: <jobId>/workspace/).
          const workspaceSubdir = `${dirPath}/workspace`;
          const gitCheckPath = await stat(workspaceSubdir).then(() => workspaceSubdir).catch(() => dirPath);
          const unpushed = await getUnpushedCommits(gitCheckPath);
          if (unpushed.length > 0) {
            console.warn(
              `[workspace-cleanup] SKIPPING ${dirPath} — ${unpushed.length} unpushed commit(s):\n${unpushed.map((c) => `  ${c}`).join("\n")}`
            );
            continue;
          }

          try {
            await rm(dirPath, { recursive: true, force: true });
            console.log(`[workspace-cleanup] Removed orphaned job directory: ${dirPath}`);
          } catch (err) {
            console.warn(
              `[workspace-cleanup] Failed to remove ${dirPath}: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }
      } catch (err) {
        // repositoryPath may not exist yet — non-fatal
        if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
          console.warn(
            `[workspace-cleanup] Failed to list job directories: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    }

    return result;
  }
}

export const createContainerManager = (config: ContainerManagerConfig): ContainerManager => {
  return new ContainerManager(config);
};
