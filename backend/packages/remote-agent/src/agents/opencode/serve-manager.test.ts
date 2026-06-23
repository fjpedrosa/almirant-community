import { describe, expect, it } from "bun:test";
import { createOpenCodeServeManager } from "./serve-manager";

const asFetch = (
  fn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
): typeof fetch => fn as unknown as typeof fetch;

const jsonResponse = (status: number, body: unknown = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("OpenCodeServeManager", () => {
  it("reuses an existing server without spawning", async () => {
    let spawnCalled = false;

    const manager = createOpenCodeServeManager(
      { port: 4500 },
      {
        fetchFn: asFetch(async () => jsonResponse(200)),
        spawnFn: () => {
          spawnCalled = true;
          return {
            pid: 999,
            exited: Promise.resolve(0),
            kill: () => undefined,
          };
        },
      }
    );

    const connection = await manager.start();

    expect(spawnCalled).toBe(false);
    expect(connection.ownedProcess).toBe(false);
    expect(connection.port).toBe(4500);
  });

  it("spawns OpenCode and waits for readiness", async () => {
    let processStarted = false;

    const manager = createOpenCodeServeManager(
      {
        port: 4501,
        readinessTimeoutMs: 100,
        readinessPollIntervalMs: 1,
      },
      {
        fetchFn: asFetch(async () => {
          return processStarted ? jsonResponse(200) : jsonResponse(503);
        }),
        spawnFn: () => {
          processStarted = true;
          return {
            pid: 321,
            exited: Promise.resolve(0),
            kill: () => undefined,
          };
        },
        sleepFn: async () => undefined,
      }
    );

    const connection = await manager.start();

    expect(connection.ownedProcess).toBe(true);
    expect(connection.pid).toBe(321);
    expect(await manager.healthCheck()).toBe(true);
  });

  it("stops owned process gracefully", async () => {
    const signals: Array<string | number | undefined> = [];
    let processStarted = false;

    const manager = createOpenCodeServeManager(
      {
        port: 4502,
        readinessTimeoutMs: 100,
        readinessPollIntervalMs: 1,
      },
      {
        fetchFn: asFetch(async () =>
          processStarted ? jsonResponse(200) : jsonResponse(503)
        ),
        spawnFn: () => {
          processStarted = true;
          return {
            pid: 111,
            exited: Promise.resolve(0),
            kill: (signal?: string | number) => {
              signals.push(signal);
            },
          };
        },
        sleepFn: async () => undefined,
      }
    );

    await manager.start();
    await manager.stop();

    expect(signals).toContain("SIGTERM");
    expect(manager.getConnection()).toBeNull();
  });
});
