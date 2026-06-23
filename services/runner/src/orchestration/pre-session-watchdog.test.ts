import { describe, expect, it } from "bun:test";
import { runWithPreSessionWatchdog } from "./pre-session-watchdog";

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
    let cancelledCalled = false;

    await expect(
      runWithPreSessionWatchdog(
        {
          phase: "post-serve setup",
          timeoutMs: 1_000,
          pollIntervalMs: 1,
          getJobStatus: async () => ({ status: "cancelled", shutdownRequested: true }),
          onCancelled: () => {
            cancelledCalled = true;
          },
        },
        () => new Promise((resolve) => setTimeout(() => resolve("late"), 50)),
      ),
    ).rejects.toMatchObject({
      code: "phase_cancelled",
      phase: "post-serve setup",
      shutdownRequested: true,
    });

    expect(cancelledCalled).toBe(true);
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
