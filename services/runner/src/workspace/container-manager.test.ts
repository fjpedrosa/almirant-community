import { describe, expect, it } from "bun:test";
import { ContainerManager } from "./container-manager";

type DockerMock = {
  ping: () => Promise<void>;
  pull: (image: string) => Promise<unknown>;
  createContainer: (config: Record<string, unknown>) => Promise<{ id: string }>;
  listContainers?: (options?: unknown) => Promise<Array<Record<string, unknown>>>;
  getContainer?: (id: string) => Record<string, unknown>;
  getImage: (image: string) => {
    inspect: () => Promise<unknown>;
  };
  modem: {
    followProgress: (
      stream: unknown,
      onFinished: (error?: unknown) => void,
      onProgress: () => void
    ) => void;
  };
};

const createDockerMock = (overrides: Partial<DockerMock> = {}): DockerMock => {
  return {
    ping: async () => undefined,
    pull: async () => ({ ok: true }),
    createContainer: async () => ({ id: "container-1" }),
    getImage: () => ({
      inspect: async () => ({}),
    }),
    modem: {
      followProgress: (_stream, onFinished) => onFinished(),
    },
    ...overrides,
  };
};

describe("ContainerManager.pullImage", () => {
  it("falls back to the local image when pull progress fails", async () => {
    const docker = createDockerMock({
      pull: async () => ({ stream: true }),
      modem: {
        followProgress: (_stream, onFinished) => {
          onFinished(new Error("pull access denied"));
        },
      },
      getImage: () => ({
        inspect: async () => ({ id: "local-image" }),
      }),
    });

    const manager = new ContainerManager({
      dockerSocketPath: "/var/run/docker.sock",
      workerId: "worker-1",
      docker: docker as never,
    });

    await expect(
      manager.pullImage("almirant-opencode:latest")
    ).resolves.toBeUndefined();
  });

  it("rethrows pull failures when the image is not available locally", async () => {
    const docker = createDockerMock({
      pull: async () => ({ stream: true }),
      modem: {
        followProgress: (_stream, onFinished) => {
          onFinished(new Error("pull access denied"));
        },
      },
      getImage: () => ({
        inspect: async () => {
          throw new Error("No such image");
        },
      }),
    });

    const manager = new ContainerManager({
      dockerSocketPath: "/var/run/docker.sock",
      workerId: "worker-1",
      docker: docker as never,
    });

    await expect(
      manager.pullImage("ghcr.io/example/missing:latest")
    ).rejects.toThrow("pull access denied");
  });
});

describe("ContainerManager.createContainer", () => {
  it("passes the hardened runtime options through to Docker", async () => {
    let receivedConfig: Record<string, unknown> | undefined;
    const docker = createDockerMock({
      createContainer: async (config) => {
        receivedConfig = config;
        return { id: "container-1" };
      },
    });

    const manager = new ContainerManager({
      dockerSocketPath: "/var/run/docker.sock",
      workerId: "worker-1",
      docker: docker as never,
    });

    const containerId = await manager.createContainer("job-1", {
      image: "almirant-opencode:latest",
      env: { KEY: "value" },
      user: "1001:1001",
      tmpfs: {
        "/workspace": "rw,uid=1001,gid=1001,mode=0755",
      },
      securityOpt: ["no-new-privileges:true"],
      capDrop: ["ALL"],
      readOnlyRootFs: true,
      tty: true,
    });

    expect(containerId).toBe("container-1");
    expect(receivedConfig?.User).toBe("1001:1001");
    expect(receivedConfig?.HostConfig).toMatchObject({
      Init: true,
      Tmpfs: {
        "/workspace": "rw,uid=1001,gid=1001,mode=0755",
      },
      SecurityOpt: ["no-new-privileges:true"],
      CapDrop: ["ALL"],
      ReadonlyRootfs: true,
    });
  });
});

describe("ContainerManager cleanup health", () => {
  it("removes exited orphaned containers without degrading the worker", async () => {
    const created = Math.floor((Date.now() - 60 * 60 * 1000) / 1000);
    let removed = false;
    let stopped = false;
    const docker = createDockerMock({
      listContainers: async () => [
        {
          Id: "container-exited",
          Image: "almirant-opencode:latest",
          Labels: { "almirant-runner": "true", "job-id": "job-exited" },
          State: "exited",
          Created: created,
        },
      ],
      getContainer: () => ({
        stop: async () => {
          stopped = true;
        },
        kill: async () => undefined,
        remove: async () => {
          removed = true;
        },
      }),
    } as Partial<DockerMock>);

    const manager = new ContainerManager({
      dockerSocketPath: "/var/run/docker.sock",
      workerId: "worker-1",
      docker: docker as never,
      sleep: async () => undefined,
    });

    const result = await manager.cleanupOrphanedContainers({
      activeJobIds: [],
      olderThanMs: 0,
    });

    expect(stopped).toBe(false);
    expect(removed).toBe(true);
    expect(result).toMatchObject({
      removed: 1,
      failed: 0,
      zombieSuspected: 0,
    });
  });

  it("removes an orphaned container when Docker reports it is already stopped", async () => {
    const created = Math.floor((Date.now() - 60 * 60 * 1000) / 1000);
    let removed = false;
    const docker = createDockerMock({
      listContainers: async () => [
        {
          Id: "container-race",
          Image: "almirant-opencode:latest",
          Labels: { "almirant-runner": "true", "job-id": "job-race" },
          State: "running",
          Created: created,
        },
      ],
      getContainer: () => ({
        stop: async () => {
          throw new Error("cannot kill container: container is not running");
        },
        kill: async () => undefined,
        remove: async () => {
          removed = true;
        },
      }),
    } as Partial<DockerMock>);

    const manager = new ContainerManager({
      dockerSocketPath: "/var/run/docker.sock",
      workerId: "worker-1",
      docker: docker as never,
      sleep: async () => undefined,
    });

    const result = await manager.cleanupOrphanedContainers({
      activeJobIds: [],
      olderThanMs: 0,
    });

    expect(removed).toBe(true);
    expect(result).toMatchObject({
      removed: 1,
      failed: 0,
      zombieSuspected: 0,
    });
  });

  it("reports zombie cleanup failures instead of swallowing Docker errors", async () => {
    const created = Math.floor((Date.now() - 60 * 60 * 1000) / 1000);
    const docker = createDockerMock({
      listContainers: async () => [
        {
          Id: "container-zombie",
          Image: "almirant-opencode:latest",
          Labels: { "almirant-runner": "true", "job-id": "job-zombie" },
          State: "running",
          Created: created,
        },
      ],
      getContainer: () => ({
        stop: async () => {
          throw new Error("PID 123 is zombie and can not be killed");
        },
        kill: async () => undefined,
        remove: async () => undefined,
      }),
    } as Partial<DockerMock>);

    const manager = new ContainerManager({
      dockerSocketPath: "/var/run/docker.sock",
      workerId: "worker-1",
      docker: docker as never,
      sleep: async () => undefined,
    });

    const result = await manager.cleanupOrphanedContainers({
      activeJobIds: [],
      olderThanMs: 0,
    });

    expect(result).toMatchObject({
      removed: 0,
      failed: 1,
      zombieSuspected: 1,
    });
    expect(result.issues[0]).toMatchObject({
      containerId: "container-zombie",
      jobId: "job-zombie",
      zombieSuspected: true,
    });
  });

  it("detects managed containers with zombie processes", async () => {
    const docker = createDockerMock({
      listContainers: async () => [
        {
          Id: "container-with-zombie",
          Image: "almirant-opencode:latest",
          Labels: { "almirant-runner": "true", "job-id": "job-1" },
          State: "running",
          Created: Math.floor(Date.now() / 1000),
        },
      ],
      getContainer: () => ({
        inspect: async () => ({ State: { Status: "running", Dead: false } }),
        top: async () => ({
          Titles: ["PID", "STAT", "COMMAND"],
          Processes: [
            ["100", "Ss", "node"],
            ["101", "Z", "du"],
          ],
        }),
      }),
    } as Partial<DockerMock>);

    const manager = new ContainerManager({
      dockerSocketPath: "/var/run/docker.sock",
      workerId: "worker-1",
      docker: docker as never,
    });

    const anomalies = await manager.detectManagedContainerAnomalies();

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]).toMatchObject({
      containerId: "container-with-zombie",
      jobId: "job-1",
      zombieProcessCount: 1,
      zombieSuspected: true,
    });
  });
});
