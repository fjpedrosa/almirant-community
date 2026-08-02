import { describe, expect, it } from "bun:test";
import { createExecutionBoundary } from "@almirant/shared";
import {
  bindContainerDriverSignal,
  runDeadlineBoundContainerOperation,
  teardownContainerWithIndependentBudgets,
} from "./container-operation";

describe("deadline-bound container operations", () => {
  it("binds the watchdog signal to nested composite driver calls", async () => {
    const controller = new AbortController();
    let capturedSignal: AbortSignal | undefined;
    const driver = bindContainerDriverSignal({
      execInContainer: async (
        _containerId: string,
        _cmd: string[],
        _workingDir?: string,
        options?: { signal?: AbortSignal },
      ) => {
        capturedSignal = options?.signal;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    } as never, controller.signal);

    await driver.execInContainer("container-1", ["true"], "/");

    expect(capturedSignal).toBe(controller.signal);
  });

  it("aborts a never-settling preparation operation at the live work cutoff", async () => {
    const cutoffBudgetMs = 80;
    const boundary = createExecutionBoundary({
      deadlineAt: new Date(Date.now() + cutoffBudgetMs),
    });
    let observedAbort = false;

    const operation = runDeadlineBoundContainerOperation(
      boundary,
      30_000,
      async ({ signal }) => {
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            observedAbort = true;
            reject(signal.reason);
          }, { once: true });
        });
      },
    );

    await expect(operation).rejects.toThrow(
      "execution_boundary_deadline_exceeded",
    );
    expect(observedAbort).toBe(true);
  });

  it("continues stop and remove when cleanup inspection never settles", async () => {
    const calls: string[] = [];
    let inspectAborted = false;

    const result = await teardownContainerWithIndependentBudgets({
      inspectTimeoutMs: 20,
      stopTimeoutMs: 20,
      removeTimeoutMs: 20,
      inspect: async (signal) => {
        calls.push("inspect");
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            inspectAborted = true;
            reject(signal.reason);
          }, { once: true });
        });
        return { running: true, oomKilled: false, exitCode: null };
      },
      stop: async () => {
        calls.push("stop");
      },
      remove: async () => {
        calls.push("remove");
      },
    });

    expect(inspectAborted).toBe(true);
    expect(calls).toEqual(["inspect", "stop", "remove"]);
    expect(result.containerState).toBeNull();
    expect(result.errors).toHaveLength(1);
  });
});
