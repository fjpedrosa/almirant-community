import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  buildDockerContainerManagerConfig,
  createContainerDriver,
  registerContainerDriver,
  type ContainerDriverEnv,
} from "./container-driver-factory";
import { ContainerManager } from "./container-manager";
import type { ContainerDriver } from "./container-driver";

const baseEnv: ContainerDriverEnv = {
  DOCKER_SOCKET: "/var/run/docker.sock",
  WORKER_ID: "worker-test",
  GHCR_USERNAME: undefined,
  GHCR_TOKEN: undefined,
};

/** Every public method the ContainerDriver contract exposes. */
const DRIVER_METHODS: Array<keyof ContainerDriver> = [
  "ping",
  "pullImage",
  "createContainer",
  "startContainer",
  "streamContainerLogs",
  "waitContainer",
  "getContainerIp",
  "connectToNetwork",
  "createNetwork",
  "removeNetwork",
  "getRunnerNetworkName",
  "inspectContainer",
  "isContainerRunning",
  "stopContainer",
  "removeContainer",
  "detectManagedContainerAnomalies",
  "execInContainer",
  "writeFileViaExec",
  "writeFileBufferViaExec",
  "restoreArchiveViaExec",
  "getArchiveFromContainer",
  "extractWorkspaceArchive",
  "putArchiveToContainer",
  "getContainerStats",
  "listManagedContainers",
  "cleanupOrphanedContainers",
];

describe("createContainerDriver", () => {
  it("returns the Docker driver (ContainerManager) by default", () => {
    const driver = createContainerDriver(baseEnv);
    expect(driver).toBeInstanceOf(ContainerManager);
  });

  it("returns an instance that satisfies the ContainerDriver contract", () => {
    // Compile-time check: assignment fails to type-check if the factory
    // return type ever drifts from the interface.
    const driver: ContainerDriver = createContainerDriver(baseEnv);

    for (const method of DRIVER_METHODS) {
      expect(typeof driver[method]).toBe("function");
    }
  });

  it("exposes host-bind workspace and bridge networking capabilities for Docker", () => {
    const driver = createContainerDriver(baseEnv);
    expect(driver.capabilities).toEqual({
      workspace: "host-bind",
      networking: "bridge",
    });
  });

  it("accepts GHCR credentials without changing the driver type", () => {
    const driver = createContainerDriver({
      ...baseEnv,
      GHCR_USERNAME: "octo",
      GHCR_TOKEN: "token",
    });
    expect(driver).toBeInstanceOf(ContainerManager);
    expect(driver.capabilities.workspace).toBe("host-bind");
  });

  it("falls back to the direct Docker socket when the configured socket is a remote proxy", () => {
    // Archive/exec operations don't work through the Docker socket proxy
    // (it blocks PUT/exec-hijack), so the config must keep a direct-socket
    // fallback pointing at the local Docker socket.
    const config = buildDockerContainerManagerConfig({
      ...baseEnv,
      DOCKER_SOCKET: "tcp://docker-proxy:2375",
    });

    expect(config.dockerSocketPath).toBe("tcp://docker-proxy:2375");
    expect(config.directSocketPath).toBe("/var/run/docker.sock");
  });

  it("omits the direct-socket fallback when already talking to the local Docker socket", () => {
    const config = buildDockerContainerManagerConfig(baseEnv);

    expect(config.dockerSocketPath).toBe("/var/run/docker.sock");
    expect(config.directSocketPath).toBeUndefined();
  });
});

/**
 * Locks the CONTAINER_DRIVER extension seam that lets a deployment (e.g. an
 * enterprise Kubernetes driver) plug in an alternative container backend
 * without patching this factory.
 */
describe("container-driver-factory CONTAINER_DRIVER seam", () => {
  let previous: string | undefined;

  beforeEach(() => {
    previous = process.env.CONTAINER_DRIVER;
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.CONTAINER_DRIVER;
    else process.env.CONTAINER_DRIVER = previous;
  });

  it("returns the Docker driver (host-bind) when CONTAINER_DRIVER is unset", () => {
    delete process.env.CONTAINER_DRIVER;
    const driver = createContainerDriver(baseEnv);
    expect(driver.capabilities.workspace).toBe("host-bind");
  });

  it("returns the Docker driver when CONTAINER_DRIVER is explicitly \"docker\"", () => {
    process.env.CONTAINER_DRIVER = "docker";
    const driver = createContainerDriver(baseEnv);
    expect(driver).toBeInstanceOf(ContainerManager);
  });

  it("returns a registered driver when CONTAINER_DRIVER selects it", () => {
    const fake = {
      capabilities: { workspace: "driver-managed", networking: "flat" },
    } as unknown as ContainerDriver;
    registerContainerDriver("fake-test-driver", () => fake);

    process.env.CONTAINER_DRIVER = "fake-test-driver";
    expect(createContainerDriver(baseEnv)).toBe(fake);
  });

  it("throws when CONTAINER_DRIVER names an unregistered backend", () => {
    process.env.CONTAINER_DRIVER = "does-not-exist";
    expect(() => createContainerDriver(baseEnv)).toThrow(/no driver is registered/);
  });
});
