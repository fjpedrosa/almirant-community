import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContainerDriver } from "./container-driver-factory";

const SOCKET_PROXY_IMAGE =
  "tecnativa/docker-socket-proxy:v0.4.2@sha256:1f3a6f303320723d199d2316a3e82b2e2685d86c275d5e3deeaf182573b47476";
const TARGET_IMAGE =
  "alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc";
const PROXY_FLAGS = {
  CONTAINERS: "1",
  IMAGES: "1",
  NETWORKS: "1",
  EXEC: "1",
  PING: "1",
  AUTH: "0",
  BUILD: "0",
  COMMIT: "0",
  CONFIGS: "0",
  DISTRIBUTION: "0",
  EVENTS: "0",
  INFO: "0",
  NODES: "0",
  PLUGINS: "0",
  SECRETS: "0",
  SERVICES: "0",
  SESSION: "0",
  SWARM: "0",
  SYSTEM: "0",
  TASKS: "0",
  VERSION: "0",
  VOLUMES: "0",
} as const;

const dockerAvailable = (): boolean => {
  try {
    execFileSync("docker", ["info"], { stdio: "ignore", timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
};

const runDocker = (...args: string[]): string =>
  execFileSync("docker", args, {
    encoding: "utf8",
    timeout: 120_000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

const readStream = async (stream: NodeJS.ReadableStream): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

const waitForProxy = async (port: number): Promise<void> => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/_ping`);
      if (response.ok && (await response.text()).trim() === "OK") return;
    } catch {
      // The proxy briefly refuses connections while HAProxy starts.
    }
    await Bun.sleep(100);
  }
  throw new Error("Docker socket proxy did not become ready");
};

const createProxyDriver = (port: number, workerId: string) =>
  createContainerDriver({
    DOCKER_SOCKET: `tcp://127.0.0.1:${port}`,
    WORKER_ID: workerId,
    GHCR_USERNAME: undefined,
    GHCR_TOKEN: undefined,
  });

const startProxy = (name: string, post: "0" | "1"): number => {
  runDocker(
    "run",
    "-d",
    "--name",
    name,
    "-p",
    "127.0.0.1::2375",
    "-v",
    "/var/run/docker.sock:/var/run/docker.sock:ro",
    ...Object.entries(PROXY_FLAGS).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
    "-e",
    `POST=${post}`,
    SOCKET_PROXY_IMAGE,
  );
  const published = runDocker("port", name, "2375/tcp");
  const port = Number(published.slice(published.lastIndexOf(":") + 1));
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid proxy port: ${published}`);
  }
  return port;
};

const enabled = dockerAvailable();
const resources = new Set<string>();
const networks = new Set<string>();
const tempDirectories = new Set<string>();

afterEach(async () => {
  for (const resource of resources) {
    try {
      runDocker("rm", "-f", resource);
    } catch {
      // Best effort after an assertion or daemon failure.
    }
  }
  resources.clear();
  for (const network of networks) {
    try {
      runDocker("network", "rm", network);
    } catch {
      // Best effort after an assertion or daemon failure.
    }
  }
  networks.clear();
  await Promise.all(
    [...tempDirectories].map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
  tempDirectories.clear();
});

describe.skipIf(!enabled)("ContainerManager through docker-socket-proxy", () => {
  test("runs the full lifecycle, exec, and GET/PUT archive over one TCP client", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const proxyName = `almirant-proxy-test-${suffix}`;
    resources.add(proxyName);
    const port = startProxy(proxyName, "1");
    await waitForProxy(port);
    const proxyEnvironment = new Set(
      JSON.parse(runDocker("inspect", "-f", "{{json .Config.Env}}", proxyName)) as string[],
    );
    for (const [key, value] of Object.entries({ ...PROXY_FLAGS, POST: "1" })) {
      expect(proxyEnvironment.has(`${key}=${value}`)).toBe(true);
    }

    const manager = createProxyDriver(port, `proxy-test-${suffix}`);
    expect(await manager.ping()).toBe(true);
    await manager.pullImage(TARGET_IMAGE);

    const networkName = `almirant-proxy-net-${suffix}`;
    const controlNetworkName = `almirant-control-net-${suffix}`;
    networks.add(networkName);
    networks.add(controlNetworkName);
    await manager.createNetwork(networkName);
    await manager.createNetwork(controlNetworkName);
    const containerId = await manager.createContainer(`job-${suffix}`, {
      image: TARGET_IMAGE,
      env: {},
      command: ["sh", "-c", "printf lifecycle-ok; sleep 30"],
      networkMode: "none",
      dnsServers: ["127.0.0.1"],
      tty: true,
    });
    resources.add(containerId);
    await manager.connectToNetwork(containerId, networkName);
    await manager.connectToNetwork(containerId, controlNetworkName);
    expect(typeof manager.assertContainerNetworkIsolation).toBe("function");
    await manager.assertContainerNetworkIsolation!(
      containerId,
      networkName,
      [controlNetworkName],
    );
    await manager.startContainer(containerId);

    expect(await manager.inspectContainer(containerId)).toMatchObject({
      running: true,
      oomKilled: false,
    });
    expect(await manager.getContainerIp(containerId, networkName)).toMatch(
      /^\d+\.\d+\.\d+\.\d+$/,
    );
    const execResult = await manager.execInContainer(
      containerId,
      ["sh", "-c", "printf proxy-exec-ok"],
      "/",
    );
    expect(execResult).toEqual({
      exitCode: 0,
      stdout: "proxy-exec-ok",
      stderr: "",
    });

    const directory = await mkdtemp(join(tmpdir(), "almirant-proxy-archive-"));
    tempDirectories.add(directory);
    const payload = "archive-via-proxy";
    await writeFile(join(directory, "payload.txt"), payload);
    const tarPath = join(directory, "payload.tar");
    execFileSync("tar", ["-cf", tarPath, "-C", directory, "payload.txt"], {
      stdio: "ignore",
      timeout: 10_000,
    });

    await manager.putArchiveToContainer(containerId, await readFile(tarPath), "/tmp");
    const archive = await readStream(
      await manager.getArchiveFromContainer(containerId, "/tmp/payload.txt"),
    );
    expect(archive.includes(Buffer.from(payload))).toBe(true);

    const logsPromise = readStream(await manager.streamContainerLogs(containerId));
    await Bun.sleep(100);
    await manager.stopContainer(containerId, 1_000);
    expect(typeof await manager.waitContainer(containerId)).toBe("number");
    expect((await logsPromise).toString()).toContain("lifecycle-ok");
    await manager.removeContainer(containerId, true);
    resources.delete(containerId);
    await manager.removeNetwork(networkName);
    networks.delete(networkName);
    await manager.removeNetwork(controlNetworkName);
    networks.delete(controlNetworkName);
  }, 180_000);

  // The "surfaces HTTP 403 when mutation flags are insufficient" case from
  // upstream is intentionally not ported: it asserts that execInContainer()
  // fails when the socket-proxy EXEC flag is off, but ContainerManager here
  // still keeps the `directSocketPath` raw-socket fallback for exec/archive
  // ops (see CLOUD_DELTA.md's container-driver-factory.ts row) — a separate,
  // already-tracked architectural decision outside this change's scope. That
  // fallback makes exec bypass the proxy by design, so the assertion does not
  // hold here.
});
