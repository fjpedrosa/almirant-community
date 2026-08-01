import type { RunnerEnv } from "../shared/config";
import type { ContainerDriver } from "./container-driver";
import {
  createContainerManager,
  type ContainerManagerConfig,
} from "./container-manager";

/** Subset of the runner env the factory needs to build a driver. */
export type ContainerDriverEnv = Pick<
  RunnerEnv,
  "DOCKER_SOCKET" | "WORKER_ID" | "GHCR_USERNAME" | "GHCR_TOKEN"
>;

/** Builds an alternative container backend selectable via CONTAINER_DRIVER. */
export type ContainerDriverFactory = (env: ContainerDriverEnv) => ContainerDriver;

const driverRegistry = new Map<string, ContainerDriverFactory>();

/**
 * Register a pluggable container backend under a CONTAINER_DRIVER name. Lets a
 * deployment (e.g. the Kubernetes driver) plug in a backend without patching
 * this factory. Must run before createContainerDriver() is called at startup.
 */
export const registerContainerDriver = (
  name: string,
  factory: ContainerDriverFactory,
): void => {
  driverRegistry.set(name, factory);
};

/**
 * Build the Docker container manager config for this runner.
 */
export const buildDockerContainerManagerConfig = (
  env: ContainerDriverEnv,
): ContainerManagerConfig => ({
  dockerSocketPath: env.DOCKER_SOCKET,
  workerId: env.WORKER_ID,
  // Use direct socket for archive/exec ops that fail through the Docker socket proxy
  directSocketPath: env.DOCKER_SOCKET !== "/var/run/docker.sock"
    ? "/var/run/docker.sock"
    : undefined,
  ...(env.GHCR_USERNAME && env.GHCR_TOKEN
    ? {
        registryAuth: {
          username: env.GHCR_USERNAME,
          password: env.GHCR_TOKEN,
          serveraddress: "ghcr.io",
        },
      }
    : {}),
});

/**
 * Build the container driver for this runner. Community ships the Docker
 * driver (ContainerManager); an alternative backend registered under
 * CONTAINER_DRIVER (e.g. the cloud layer's Kubernetes driver) takes over when
 * that env var is set to its name.
 */
export const createContainerDriver = (env: ContainerDriverEnv): ContainerDriver => {
  const selected = process.env.CONTAINER_DRIVER;
  if (selected && selected !== "docker") {
    const factory = driverRegistry.get(selected);
    if (!factory) {
      throw new Error(
        `CONTAINER_DRIVER="${selected}" but no driver is registered under that ` +
          `name. Call registerContainerDriver("${selected}", ...) before startup.`,
      );
    }
    return factory(env);
  }

  return createContainerManager(buildDockerContainerManagerConfig(env));
};
