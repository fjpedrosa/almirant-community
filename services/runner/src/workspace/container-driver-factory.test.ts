import { describe, expect, it } from "bun:test";
import { createContainerDriver } from "./container-driver-factory";
import { ContainerManager } from "./container-manager";
import type { ContainerDriver } from "./container-driver";

const baseEnv = {
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
});
