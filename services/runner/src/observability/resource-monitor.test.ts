import { describe, expect, it } from "bun:test";
import type { ContainerManager } from "../workspace/container-manager";
import type { RunnerJobEventLogger } from "./job-event-logger";
import { startTmpfsWatcher } from "./resource-monitor";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const createEventLogger = (): RunnerJobEventLogger =>
  ({
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    transcript: () => undefined,
  }) as unknown as RunnerJobEventLogger;

describe("startTmpfsWatcher", () => {
  it("skips overlapping resource checks while a previous exec is still running", async () => {
    let execCalls = 0;
    const pendingResolvers: Array<(value: { exitCode: number; stdout: string; stderr: string }) => void> = [];
    const containerManager = {
      execInContainer: async () => {
        execCalls++;
        return new Promise((resolve) => {
          pendingResolvers.push(resolve);
        });
      },
    } as unknown as ContainerManager;

    const watcher = startTmpfsWatcher(
      containerManager,
      "container-1",
      "job-1",
      createEventLogger(),
      { checkIntervalMs: 5, execTimeoutMs: 100 },
    );

    await sleep(30);
    watcher.cleanup();
    pendingResolvers.forEach((resolve) =>
      resolve({ exitCode: 0, stdout: "tmpfs 100 1 99 1% /home/opencode\n", stderr: "" }),
    );

    expect(execCalls).toBe(1);
  });

  it("disables workspace du checks after timeout instead of spawning repeated du processes", async () => {
    let dfCalls = 0;
    let duCalls = 0;
    const containerManager = {
      execInContainer: async (_containerId: string, cmd: string[]) => {
        if (cmd[0] === "df") {
          dfCalls++;
          return {
            exitCode: 0,
            stdout: "tmpfs 100 1 99 1% /home/opencode\n",
            stderr: "",
          };
        }

        if (cmd[0] === "du") {
          duCalls++;
          return new Promise(() => undefined);
        }

        return { exitCode: 0, stdout: "", stderr: "" };
      },
    } as unknown as ContainerManager;

    const watcher = startTmpfsWatcher(
      containerManager,
      "container-1",
      "job-1",
      createEventLogger(),
      { checkIntervalMs: 15, execTimeoutMs: 5, workspaceDuTimeoutMs: 5 },
    );

    await sleep(70);
    watcher.cleanup();

    expect(dfCalls).toBeGreaterThan(1);
    expect(duCalls).toBe(1);
  });

  it("keeps workspace du enabled when du finishes before workspaceDuTimeoutMs even though execTimeoutMs is shorter", async () => {
    let duCalls = 0;
    const containerManager = {
      execInContainer: async (_containerId: string, cmd: string[]) => {
        if (cmd[0] === "df") {
          return {
            exitCode: 0,
            stdout: "tmpfs 100 1 99 1% /home/opencode\n",
            stderr: "",
          };
        }

        if (cmd[0] === "du") {
          duCalls++;
          // du takes ~30ms — longer than execTimeoutMs (5ms) but
          // shorter than workspaceDuTimeoutMs (200ms).
          await sleep(30);
          return { exitCode: 0, stdout: "1500\t/workspace\n", stderr: "" };
        }

        return { exitCode: 0, stdout: "", stderr: "" };
      },
    } as unknown as ContainerManager;

    const watcher = startTmpfsWatcher(
      containerManager,
      "container-1",
      "job-1",
      createEventLogger(),
      { checkIntervalMs: 50, execTimeoutMs: 5, workspaceDuTimeoutMs: 200 },
    );

    await sleep(180);
    watcher.cleanup();

    // du should run multiple times because its dedicated timeout (200ms) is
    // larger than the actual du duration (30ms). Without the dedicated timeout
    // the shared execTimeoutMs (5ms) would disable du after the first call.
    expect(duCalls).toBeGreaterThan(1);
  });
});
