import { describe, expect, it } from "bun:test";
import {
  runAbortableOperationUntilInterrupted,
  runWithPreSessionWatchdog,
} from "./pre-session-watchdog";

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe("runAbortableOperationUntilInterrupted", () => {
  it("aborts and surfaces interruption without waiting for a non-cooperative loser", async () => {
    const started = deferred<void>();
    const releaseOperation = deferred<void>();
    const interruption = deferred<never>();
    const aborted = deferred<void>();
    const events: string[] = [];
    let settled = false;

    const running = runAbortableOperationUntilInterrupted(
      async (signal) => {
        events.push("started");
        signal.addEventListener(
          "abort",
          () => {
            events.push("aborted");
            aborted.resolve();
          },
          { once: true },
        );
        started.resolve();
        await releaseOperation.promise;
        events.push("joined");
        return "late-result";
      },
      interruption.promise,
    ).finally(() => {
      settled = true;
    });
    const observedRejection = running.catch((error) => error);

    await started.promise;
    const cancellation = new Error("cancelled by backend");
    interruption.reject(cancellation);
    await aborted.promise;
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(events).toEqual(["started", "aborted"]);
    const settledBeforeLoser = settled;

    releaseOperation.resolve();
    await expect(observedRejection).resolves.toBe(cancellation);
    expect(settledBeforeLoser).toBe(true);
    expect(events).toEqual(["started", "aborted", "joined"]);
    expect(settled).toBe(true);
  });

  it("returns a successful operation without aborting it", async () => {
    let observedSignal: AbortSignal | undefined;

    await expect(
      runAbortableOperationUntilInterrupted(
        async (signal) => {
          observedSignal = signal;
          return "ready";
        },
        new Promise<never>(() => undefined),
      ),
    ).resolves.toBe("ready");

    expect(observedSignal?.aborted).toBe(false);
  });
});

describe("runWithPreSessionWatchdog", () => {
  it("rechaza con phase_timeout cuando la fase pre-sesión excede el timeout", async () => {
    let timeoutCalled = false;

    await expect(
      runWithPreSessionWatchdog(
        {
          phase: "post-serve setup",
          timeoutMs: 5,
          pollIntervalMs: 100,
          getJobStatus: async () => ({ status: "running" }),
          onTimeout: () => {
            timeoutCalled = true;
          },
        },
        () => new Promise((resolve) => setTimeout(() => resolve("late"), 50)),
      ),
    ).rejects.toMatchObject({
      code: "phase_timeout",
      phase: "post-serve setup",
      timeoutMs: 5,
    });

    expect(timeoutCalled).toBe(true);
  });

  it("interrumpe la fase si el backend marca shutdownRequested antes de crear sesión", async () => {
    let terminalIntentCalled = false;

    await expect(
      runWithPreSessionWatchdog(
        {
          phase: "post-serve setup",
          timeoutMs: 1_000,
          pollIntervalMs: 1,
          getJobStatus: async () => ({ status: "cancelled", shutdownRequested: true }),
          onTerminalIntent: () => {
            terminalIntentCalled = true;
          },
        },
        () => new Promise((resolve) => setTimeout(() => resolve("late"), 50)),
      ),
    ).rejects.toMatchObject({
      code: "phase_terminal_intent",
      phase: "post-serve setup",
      terminalStatus: "cancelled",
      shutdownRequested: true,
    });

    expect(terminalIntentCalled).toBe(true);
  });

  it("aborta y conserva un pending failed antes de crear sesión", async () => {
    let observedIntent: unknown = null;

    await expect(
      runWithPreSessionWatchdog(
        {
          phase: "post-serve setup",
          timeoutMs: 1_000,
          pollIntervalMs: 1,
          getJobStatus: async () => ({
            status: "failed",
            errorType: "interaction-timeout",
            errorMessage: "Interaction timed out",
          }),
          onTerminalIntent: (error) => {
            observedIntent = error;
          },
        },
        () => new Promise((resolve) => setTimeout(() => resolve("late"), 50)),
      ),
    ).rejects.toMatchObject({
      code: "phase_terminal_intent",
      phase: "post-serve setup",
      terminalStatus: "failed",
      shutdownRequested: false,
      errorType: "interaction-timeout",
      errorMessage: "Interaction timed out",
    });

    expect(observedIntent).toMatchObject({
      terminalStatus: "failed",
      errorType: "interaction-timeout",
    });
  });

  it("devuelve el resultado si la fase termina antes del timeout y sin cancelación", async () => {
    const result = await runWithPreSessionWatchdog(
      {
        phase: "post-serve setup",
        timeoutMs: 1_000,
        pollIntervalMs: 100,
        getJobStatus: async () => ({ status: "running" }),
      },
      async () => "ok",
    );

    expect(result).toBe("ok");
  });
});
