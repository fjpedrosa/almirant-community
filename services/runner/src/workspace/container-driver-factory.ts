import type { RunnerEnv } from "../shared/config";
import type { ContainerDriver } from "./container-driver";
import { createContainerManager } from "./container-manager";

/** Subset of the runner env the factory needs to build a driver. */
type ContainerDriverEnv = Pick<
  RunnerEnv,
  "DOCKER_SOCKET" | "WORKER_ID" | "GHCR_USERNAME" | "GHCR_TOKEN"
>;

/**
 * Build the container driver for this runner. Community ships the Docker
 * driver (ContainerManager); the cloud layer swaps in a Kubernetes driver
 * behind the same ContainerDriver contract.
 */
export const createContainerDriver = (env: ContainerDriverEnv): ContainerDriver => {
  return createContainerManager({
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
};
