/**
 * Ephemeral Docker environment for full validation (E2E).
 *
 * Extracted from JobExecutor.setupValidateEnvironment / teardownValidateEnvironment
 * and the related waitForHealthy / waitForServeReady helpers.
 */

import type { ContainerDriver } from "./container-driver";
import type { ValidateEnvironment } from "../shared/types";
import { sleep } from "../shared/job-helpers";

// ── Constants ────────────────────────────────────────────────────────────────

export const SERVE_READINESS_TIMEOUT_MS = 360_000;
export const SERVE_READINESS_POLL_MS = 1_000;

// ── Dependencies ─────────────────────────────────────────────────────────────

export type ValidateEnvironmentDeps = {
  containerManager: ContainerDriver;
};

// ── Functions ────────────────────────────────────────────────────────────────

/**
 * Set up an ephemeral Docker environment for full validation (E2E).
 * Creates a dedicated network and launches PostgreSQL as a sibling
 * container that the agent container can reach.
 */
export const setupValidateEnvironment = async (
  deps: ValidateEnvironmentDeps,
  jobId: string,
  repoPath: string,
): Promise<ValidateEnvironment> => {
  const { containerManager } = deps;
  const sessionName = `validate-${jobId.slice(0, 8)}-${Date.now()}`;
  const networkName = `${sessionName}-net`;

  // 1. Create dedicated network
  await containerManager.createNetwork(networkName);

  const containerIds: string[] = [];

  try {
    // 2. Start PostgreSQL
    const pgId = await containerManager.createContainer(jobId, {
      image: "postgres:17-alpine",
      env: {
        POSTGRES_USER: "validate_user",
        POSTGRES_PASSWORD: "validate_password",
        POSTGRES_DB: "validate_db",
      },
      labels: {
        "validate-session": sessionName,
        "validate-role": "postgres",
      },
      tmpfs: {
        "/var/lib/postgresql/data": "rw,nosuid,nodev,size=512m",
      },
      memoryLimitMb: 512,
      tty: false,
    });
    containerIds.push(pgId);
    await containerManager.connectToNetwork(pgId, networkName);
    await containerManager.startContainer(pgId);

    // 3. Wait for PostgreSQL to be ready
    await waitForHealthy(deps, pgId, "pg_isready -U validate_user -d validate_db", 60_000);

    // 4. Build and start backend (using the repo's backend Dockerfile)
    // For the runner, we use a pre-built image or build from the repo
    // The agent's container will connect to backend via the shared network
    console.log(`[job:${jobId}] Validate env: PostgreSQL ready, starting backend...`);

    return {
      sessionName,
      networkName,
      frontendUrl: "", // Will be set when frontend is started by the skill
      frontendPort: 0,
      containerIds,
    };
  } catch (error) {
    // Cleanup on failure
    for (const id of containerIds) {
      await containerManager.stopContainer(id, 3000);
      await containerManager.removeContainer(id, true);
    }
    await containerManager.removeNetwork(networkName);
    throw error;
  }
};

/**
 * Tear down the ephemeral validation environment.
 * Stops and removes all containers, then removes the network.
 */
export const teardownValidateEnvironment = async (
  deps: ValidateEnvironmentDeps,
  env: ValidateEnvironment,
): Promise<void> => {
  const { containerManager } = deps;
  for (const id of env.containerIds) {
    await containerManager.stopContainer(id, 5000);
    await containerManager.removeContainer(id, true);
  }
  await containerManager.removeNetwork(env.networkName);
  console.log(`[validate] Torn down environment: ${env.sessionName}`);
};

/**
 * Poll a container until a health check command succeeds.
 */
export const waitForHealthy = async (
  deps: ValidateEnvironmentDeps,
  containerId: string,
  healthCmd: string,
  timeoutMs: number,
): Promise<void> => {
  const { containerManager } = deps;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const result = await containerManager.execInContainer(
        containerId,
        ["sh", "-c", healthCmd],
        "/",
      );
      if (result.exitCode === 0) return;
    } catch {
      // Container may not be ready yet
    }
    await sleep(2000);
  }
  throw new Error(`Container ${containerId} did not become healthy within ${timeoutMs}ms`);
};

/**
 * Poll an HTTP serve endpoint until it responds (any status code).
 * Network errors (connection refused, timeout) indicate the server is not yet ready.
 */
export const waitForServeReady = async (baseUrl: string): Promise<void> => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < SERVE_READINESS_TIMEOUT_MS) {
    try {
      const response = await fetch(`${baseUrl}/session`, {
        method: "GET",
        signal: AbortSignal.timeout(5_000),
      });
      // Any HTTP response (even 500) means the server is up and listening.
      // Only network errors (connection refused, timeout) indicate not ready.
      if (response.ok || response.status >= 400) return;
    } catch {
      // Not ready yet
    }
    await sleep(SERVE_READINESS_POLL_MS);
  }

  throw new Error(
    `Serve did not become ready within ${SERVE_READINESS_TIMEOUT_MS}ms at ${baseUrl}`
  );
};
