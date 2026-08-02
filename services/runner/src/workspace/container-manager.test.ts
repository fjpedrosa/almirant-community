import { describe, expect, it } from "bun:test";
import { ContainerManager } from "./container-manager";

type DockerMock = {
  ping: () => Promise<void>;
  pull: (image: string) => Promise<unknown>;
  createContainer: (config: Record<string, unknown>) => Promise<{ id: string }>;
  listContainers?: (options?: unknown) => Promise<Array<Record<string, unknown>>>;
  getContainer?: (id: string) => Record<string, unknown>;
  getNetwork?: (name: string) => Record<string, unknown>;
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
      dnsServers: ["127.0.0.1"],
      tty: true,
    });

    expect(containerId).toBe("container-1");
    expect(receivedConfig?.User).toBe("1001:1001");
    expect(receivedConfig?.HostConfig).toMatchObject({
      Init: true,
      NetworkMode: "none",
      Dns: ["127.0.0.1"],
      Tmpfs: {
        "/workspace": "rw,uid=1001,gid=1001,mode=0755",
      },
      SecurityOpt: ["no-new-privileges:true"],
      CapDrop: ["ALL"],
      ReadonlyRootfs: true,
    });
  });

  it("rejects any caller attempt to create an agent on a Docker network", async () => {
    const manager = new ContainerManager({
      dockerSocketPath: "/var/run/docker.sock",
      workerId: "worker-1",
      docker: createDockerMock() as never,
    });

    await expect(
      manager.createContainer("job-1", {
        image: "almirant-opencode:latest",
        env: {},
        networkMode: "bridge",
      } as never),
    ).rejects.toThrow("must be created with NetworkMode=none");
  });
});

describe("ContainerManager agent egress isolation", () => {
  it("detaches private none mode before attaching the two approved networks", async () => {
    const calls: string[] = [];
    let noneAttached = true;
    const docker = createDockerMock({
      getContainer: () => ({
        inspect: async () => ({
          NetworkSettings: { Networks: noneAttached ? { none: {} } : {} },
        }),
      }),
      getNetwork: (name) => ({
        disconnect: async () => {
          noneAttached = false;
          calls.push(`disconnect:${name}`);
        },
        connect: async () => calls.push(`connect:${name}`),
      }),
    });
    const manager = new ContainerManager({
      dockerSocketPath: "tcp://docker-proxy:2375",
      workerId: "worker-1",
      docker: docker as never,
    });

    await manager.connectToNetwork("container-1", "almirant-agent-egress");
    await manager.connectToNetwork("container-1", "almirant-agent-control");

    expect(calls).toEqual([
      "disconnect:none",
      "connect:almirant-agent-egress",
      "connect:almirant-agent-control",
    ]);
  });

  it("validates the internal labelled network, its proxy alias, and pins the proxy IP", async () => {
    const docker = createDockerMock({
      getNetwork: () => ({
        inspect: async () => ({
          Name: "almirant-agent-egress",
          Driver: "bridge",
          Internal: true,
          Labels: { "com.almirant.network.role": "agent-egress" },
          Containers: {
            proxy: {
              Name: "almirant-egress-proxy",
              IPv4Address: "172.30.0.2/16",
            },
            runner: {
              Name: "almirant-runner",
              IPv4Address: "172.30.0.3/16",
            },
          },
        }),
      }),
      getContainer: (id) => ({
        inspect: async () =>
          id === "proxy"
            ? {
                Config: { Labels: { "com.almirant.network.role": "egress-proxy" } },
                NetworkSettings: {
                  Networks: {
                    "almirant-agent-egress": { Aliases: ["egress-proxy"] },
                  },
                },
              }
            : {
                Config: { Labels: { "com.almirant.network.role": "runner" } },
                NetworkSettings: { Networks: { "almirant-agent-egress": {} } },
              },
      }),
    });
    const manager = new ContainerManager({
      dockerSocketPath: "/var/run/docker.sock",
      workerId: "worker-1",
      docker: docker as never,
    });

    await expect(
      manager.resolveAgentEgressProxy(
        "almirant-agent-egress",
        "http://egress-proxy:3128/",
      ),
    ).resolves.toBe("http://172.30.0.2:3128/");
  });

  it.each([
    ["non-internal", { Internal: false, Labels: { "com.almirant.network.role": "agent-egress" }, Containers: {} }],
    ["unlabelled", { Internal: true, Labels: {}, Containers: {} }],
    [
      "control-plane member",
      {
        Internal: true,
        Labels: { "com.almirant.network.role": "agent-egress" },
        Containers: { backend: { Name: "almirant-backend-1", IPv4Address: "172.30.0.4/16" } },
      },
    ],
  ])("rejects a %s network before an agent is connected", async (_case, networkInfo) => {
    const docker = createDockerMock({
      getNetwork: () => ({ inspect: async () => ({ Name: "almirant-agent-egress", Driver: "bridge", ...networkInfo }) }),
      getContainer: () => ({
        inspect: async () => ({ Config: { Labels: {} }, NetworkSettings: { Networks: {} } }),
      }),
    });
    const manager = new ContainerManager({
      dockerSocketPath: "/var/run/docker.sock",
      workerId: "worker-1",
      docker: docker as never,
    });

    await expect(
      manager.resolveAgentEgressProxy(
        "almirant-agent-egress",
        "http://egress-proxy:3128/",
      ),
    ).rejects.toThrow("Unsafe agent egress network");
  });

  it("validates the internal labelled runner-to-agent control network", async () => {
    const docker = createDockerMock({
      getNetwork: () => ({
        inspect: async () => ({
          Name: "almirant-agent-control",
          Driver: "bridge",
          Internal: true,
          Labels: { "com.almirant.network.role": "agent-control" },
        }),
      }),
    });
    const manager = new ContainerManager({
      dockerSocketPath: "/var/run/docker.sock",
      workerId: "worker-1",
      docker: docker as never,
    });

    await expect(
      manager.assertAgentControlNetwork("almirant-agent-control"),
    ).resolves.toBeUndefined();
  });

  it("rejects an unlabelled or non-internal control network", async () => {
    const docker = createDockerMock({
      getNetwork: () => ({
        inspect: async () => ({
          Name: "almirant-agent-control",
          Driver: "bridge",
          Internal: false,
          Labels: {},
        }),
      }),
    });
    const manager = new ContainerManager({
      dockerSocketPath: "/var/run/docker.sock",
      workerId: "worker-1",
      docker: docker as never,
    });

    await expect(
      manager.assertAgentControlNetwork("almirant-agent-control"),
    ).rejects.toThrow("Unsafe agent control network");
  });

  it("does not fall back to the first attached network when the explicit one is missing", async () => {
    const docker = createDockerMock({
      getContainer: () => ({
        inspect: async () => ({
          NetworkSettings: {
            Networks: {
              "runner-internal": { IPAddress: "172.20.0.9" },
            },
          },
        }),
      }),
    });
    const manager = new ContainerManager({
      dockerSocketPath: "/var/run/docker.sock",
      workerId: "worker-1",
      docker: docker as never,
    });

    await expect(
      manager.getContainerIp("container-1", "almirant-agent-egress"),
    ).rejects.toThrow("not attached to required network");
  });

  it("rejects a container attached to any network besides the explicit egress network", async () => {
    const docker = createDockerMock({
      getContainer: () => ({
        inspect: async () => ({
          NetworkSettings: {
            Networks: {
              "almirant-agent-egress": { IPAddress: "172.30.0.9" },
              "runner-internal": { IPAddress: "172.20.0.9" },
            },
          },
        }),
      }),
    });
    const manager = new ContainerManager({
      dockerSocketPath: "/var/run/docker.sock",
      workerId: "worker-1",
      docker: docker as never,
    });

    await expect(
      manager.assertContainerNetworkIsolation("container-1", "almirant-agent-egress"),
    ).rejects.toThrow("unexpected networks: runner-internal");
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
