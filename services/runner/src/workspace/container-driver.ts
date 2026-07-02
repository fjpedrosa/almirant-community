import type { ContainerStats, ManagedContainerInfo, RunnerContainerSpec } from "../shared/types";
import type { ContainerCleanupResult, ContainerHealthAnomaly } from "./container-manager";

/**
 * Capabilities a container driver advertises so callers can adapt behavior
 * without knowing the concrete backend:
 *
 * - workspace "host-bind": the driver mounts host directories into containers,
 *   so the runner must pre-create/chown the workspace dirs on its own disk.
 * - workspace "driver-managed": the driver provisions workspace storage itself
 *   (e.g. Kubernetes volumes) — no host-side directory preparation.
 * - networking "bridge": containers live on driver-managed bridge networks the
 *   runner must join/inspect to reach them.
 * - networking "flat": containers are directly routable (e.g. pod networking).
 */
export type DriverCapabilities = {
  workspace: "host-bind" | "driver-managed";
  networking: "bridge" | "flat";
};

/**
 * Contract implemented by container backends (Docker today; Kubernetes in the
 * cloud layer). Mirrors the public surface of ContainerManager so consumers
 * depend on this interface instead of the concrete Docker implementation.
 */
export type ContainerDriver = {
  readonly capabilities: DriverCapabilities;

  ping(): Promise<boolean>;
  pullImage(image: string): Promise<void>;
  createContainer(jobId: string, spec: RunnerContainerSpec): Promise<string>;
  startContainer(containerId: string): Promise<void>;
  streamContainerLogs(containerId: string): Promise<NodeJS.ReadableStream>;
  waitContainer(containerId: string): Promise<number>;
  getContainerIp(containerId: string, preferNetwork?: string): Promise<string>;
  connectToNetwork(containerId: string, networkName: string): Promise<void>;
  createNetwork(name: string): Promise<string>;
  removeNetwork(name: string): Promise<void>;
  getRunnerNetworkName(): Promise<string | null>;
  inspectContainer(containerId: string): Promise<{
    running: boolean;
    oomKilled: boolean;
    exitCode: number | null;
  }>;
  isContainerRunning(containerId: string): Promise<boolean>;
  stopContainer(containerId: string, gracefulTimeoutMs?: number): Promise<void>;
  removeContainer(containerId: string, force?: boolean): Promise<void>;
  detectManagedContainerAnomalies(): Promise<ContainerHealthAnomaly[]>;
  execInContainer(
    containerId: string,
    cmd: string[],
    workingDir?: string,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  writeFileViaExec(containerId: string, filePath: string, content: string): Promise<void>;
  writeFileBufferViaExec(
    containerId: string,
    filePath: string,
    content: Buffer,
    mode?: string,
  ): Promise<void>;
  restoreArchiveViaExec(containerId: string, tarBuffer: Buffer, extractPath: string): Promise<void>;
  getArchiveFromContainer(containerId: string, path: string): Promise<NodeJS.ReadableStream>;
  extractWorkspaceArchive(containerId: string, path?: string, timeoutMs?: number): Promise<Buffer>;
  putArchiveToContainer(containerId: string, tarBuffer: Buffer, path: string): Promise<void>;
  getContainerStats(): Promise<ContainerStats[]>;
  listManagedContainers(): Promise<ManagedContainerInfo[]>;
  cleanupOrphanedContainers(args: {
    activeJobIds: string[];
    olderThanMs?: number;
    /** Runner-local path to workspace directories (e.g. "/app/repos"). */
    repositoryPath?: string;
  }): Promise<ContainerCleanupResult>;
};
