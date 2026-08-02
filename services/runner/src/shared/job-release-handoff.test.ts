import { describe, expect, it } from "bun:test";
import {
  drainAndReleaseJob,
  drainJobEventProducers,
  SequenceHandoffCoverageError,
} from "./job-release-handoff";

/** Virtual clock, so a 7-minute wait costs no wall time in tests. */
const virtualClock = () => {
  let nowMs = 0;
  return {
    now: () => nowMs,
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
};

describe("drainAndReleaseJob", () => {
  it("settles at the terminal deadline without waiting for a non-cooperative drain", async () => {
    const controller = new AbortController();
    let released = false;
    const draining = drainAndReleaseJob({
      signal: controller.signal,
      drain: async () => {
        await new Promise<void>(() => undefined);
      },
      readHighWater: () => ({
        protocolVersion: 2,
        jobLogs: 0,
        sessionEvents: 0,
        nativeEvents: 0,
      }),
      release: async () => {
        released = true;
      },
    });
    await Promise.resolve();
    controller.abort(new Error("terminal_deadline_exceeded"));

    await expect(draining).rejects.toThrow(
      "terminal_deadline_exceeded",
    );
    expect(released).toBe(false);
  });

  it("keeps the job unclaimable until every producer has drained and its high-water marks are fixed", async () => {
    const calls: string[] = [];
    let finishPublisher!: () => void;
    let finishLogger!: () => void;
    const publisherBarrier = new Promise<void>((resolve) => {
      finishPublisher = resolve;
    });
    const loggerBarrier = new Promise<void>((resolve) => {
      finishLogger = resolve;
    });

    const handoff = drainAndReleaseJob({
      drain: () => drainJobEventProducers({
        closePublisher: async () => {
          calls.push("publisher:start");
          await publisherBarrier;
          calls.push("publisher:complete");
        },
        stopLogger: async () => {
          calls.push("logger:start");
          await loggerBarrier;
          calls.push("logger:complete");
        },
      }),
      readHighWater: () => {
        calls.push("high-water:fixed");
        return {
          protocolVersion: 2,
          jobLogs: 41,
          sessionEvents: 73,
          nativeEvents: 19,
        };
      },
      release: async (sequenceHighWater) => {
        calls.push(`released:${sequenceHighWater.sessionEvents}`);
      },
    });

    await Promise.resolve();
    expect(calls).toEqual(["publisher:start", "logger:start"]);

    finishPublisher();
    await Promise.resolve();
    expect(calls).not.toContain("high-water:fixed");

    finishLogger();
    await handoff;

    expect(calls).toEqual([
      "publisher:start",
      "logger:start",
      "publisher:complete",
      "logger:complete",
      "high-water:fixed",
      "released:73",
    ]);
  });

  it("fails closed without releasing the job when producer drain fails", async () => {
    let released = false;

    await expect(
      drainAndReleaseJob({
        drain: async () => {
          throw new Error("producer drain failed");
        },
        readHighWater: () => ({
          protocolVersion: 2,
          jobLogs: 1,
          sessionEvents: 2,
          nativeEvents: 3,
        }),
        release: async () => {
          released = true;
        },
      }),
    ).rejects.toThrow("producer drain failed");

    expect(released).toBe(false);
  });

  it("polls the exact handoff until database coverage is ready before terminal status", async () => {
    const calls: string[] = [];
    let handoffAttempt = 0;

    await drainAndReleaseJob({
      drain: async () => {
        calls.push("tail+drain");
      },
      readHighWater: () => {
        calls.push("high-water");
        return {
          protocolVersion: 2,
          jobLogs: 5,
          sessionEvents: 7,
          nativeEvents: 3,
        };
      },
      prepareHandoff: async (emittedThrough) => {
        handoffAttempt += 1;
        calls.push(`handoff:${handoffAttempt}:${emittedThrough.sessionEvents}`);
        return {
          ready: handoffAttempt === 2,
          insertedCount: {
            jobLogs: 5,
            sessionEvents: handoffAttempt === 2 ? 7 : 6,
            nativeEvents: 3,
          },
          expectedCount: { jobLogs: 5, sessionEvents: 7, nativeEvents: 3 },
        };
      },
      waitBeforeHandoffPoll: async () => {
        calls.push("wait");
      },
      release: async () => {
        calls.push("terminal-status");
      },
    });

    expect(calls).toEqual([
      "tail+drain",
      "high-water",
      "handoff:1:7",
      "wait",
      "handoff:2:7",
      "terminal-status",
    ]);
  });

  for (const status of ["completed", "incomplete", "failed", "prewarm_timeout"] as const) {
    it(`uses tail -> strict drain -> handoff -> ${status} ordering`, async () => {
      const calls: string[] = [];
      await drainAndReleaseJob({
        drain: async () => {
          calls.push("strict-drain");
        },
        readHighWater: () => ({
          protocolVersion: 2,
          jobLogs: 1,
          sessionEvents: 1,
          nativeEvents: 0,
        }),
        prepareHandoff: async () => {
          calls.push("handoff-ready");
          return {
            ready: true,
            insertedCount: { jobLogs: 1, sessionEvents: 1, nativeEvents: 0 },
            expectedCount: { jobLogs: 1, sessionEvents: 1, nativeEvents: 0 },
          };
        },
        release: async () => {
          calls.push(status);
        },
      });

      expect(calls).toEqual(["strict-drain", "handoff-ready", status]);
    });
  }

  it("keeps waiting while coverage progresses, far past the old 30s budget", async () => {
    // Reproduces the job this loop destroyed: its logs were already durable, but
    // 10,396 native and 904 session events were still draining from the shared
    // bridge at the measured ~12 rows/s and only reached parity 432s later. The
    // old budget of 120 polls x 250ms gave up at 30s and threw the finished job
    // away — 106 KB of validated output, already submitted.
    const clock = virtualClock();
    const expectedCount = { jobLogs: 9643, sessionEvents: 904, nativeEvents: 10396 };
    let attempts = 0;
    let released: { sessionEvents: number } | undefined;

    await drainAndReleaseJob({
      drain: async () => {},
      readHighWater: () => ({ protocolVersion: 2, ...expectedCount }),
      now: clock.now,
      waitBeforeHandoffPoll: async (_signal, delayMs) => {
        clock.advance(delayMs ?? 250);
      },
      prepareHandoff: async () => {
        attempts += 1;
        const elapsedSeconds = clock.now() / 1000;
        const nativeEvents = Math.min(
          expectedCount.nativeEvents,
          5031 + Math.floor(elapsedSeconds * 12.42),
        );
        const sessionEvents = Math.min(
          expectedCount.sessionEvents,
          450 + Math.floor(elapsedSeconds * 1.05),
        );
        return {
          ready:
            nativeEvents === expectedCount.nativeEvents &&
            sessionEvents === expectedCount.sessionEvents,
          insertedCount: { jobLogs: expectedCount.jobLogs, sessionEvents, nativeEvents },
          expectedCount,
        };
      },
      release: async (highWater) => {
        released = highWater;
      },
    });

    expect(released?.sessionEvents).toBe(expectedCount.sessionEvents);
    // Survived the real catch-up, and still finished under the ceiling.
    expect(clock.now()).toBeGreaterThan(400_000);
    expect(clock.now()).toBeLessThan(540_000);
    // The old budget would have thrown long before this many polls.
    expect(attempts).toBeGreaterThan(120);
  });

  it("gives up with per-channel deltas once coverage stops progressing", async () => {
    const clock = virtualClock();
    let released = false;
    let attempts = 0;

    const handoff = drainAndReleaseJob({
      drain: async () => {},
      readHighWater: () => ({
        protocolVersion: 2,
        jobLogs: 10,
        sessionEvents: 20,
        nativeEvents: 30,
      }),
      now: clock.now,
      waitBeforeHandoffPoll: async (_signal, delayMs) => {
        clock.advance(delayMs ?? 250);
      },
      prepareHandoff: async () => {
        attempts += 1;
        return {
          ready: false,
          // Frozen: whatever was pending will never arrive.
          insertedCount: { jobLogs: 10, sessionEvents: 18, nativeEvents: 30 },
          expectedCount: { jobLogs: 10, sessionEvents: 20, nativeEvents: 30 },
        };
      },
      release: async () => {
        released = true;
      },
    });

    const error = await handoff.then(
      () => undefined,
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(SequenceHandoffCoverageError);
    const coverageError = error as SequenceHandoffCoverageError;
    expect(coverageError.stalled).toBe(true);
    expect(coverageError.insertedCount.sessionEvents).toBe(18);
    expect(coverageError.expectedCount.sessionEvents).toBe(20);
    // The message names the channel that was behind; the old one named nothing.
    expect(coverageError.message).toContain("sessionEvents 18/20");
    expect(released).toBe(false);
    // Stopped on the stall window, not on the absolute ceiling.
    expect(clock.now()).toBeGreaterThanOrEqual(120_000);
    expect(clock.now()).toBeLessThan(130_000);
    // And the backoff means it did not hammer the locks it was waiting on:
    // 120s of polling every 250ms would be ~480 attempts, the backoff makes it
    // 120 fast polls plus 45 slow ones.
    expect(attempts).toBeLessThan(200);
    expect(attempts).toBeGreaterThan(120);
  });

  it("refuses a handoff that claims ready without complete coverage", async () => {
    let released = false;

    const handoff = drainAndReleaseJob({
      drain: async () => {},
      readHighWater: () => ({
        protocolVersion: 2,
        jobLogs: 4,
        sessionEvents: 4,
        nativeEvents: 4,
      }),
      prepareHandoff: async () => ({
        ready: true,
        insertedCount: { jobLogs: 4, sessionEvents: 3, nativeEvents: 4 },
        expectedCount: { jobLogs: 4, sessionEvents: 4, nativeEvents: 4 },
      }),
      release: async () => {
        released = true;
      },
    });

    await expect(handoff).rejects.toThrow(
      /reported ready without complete database coverage \(.*sessionEvents 3\/4/,
    );
    expect(released).toBe(false);
  });

  it("propagates handoff transport failures without releasing", async () => {
    let released = false;
    let attempts = 0;

    await expect(drainAndReleaseJob({
      drain: async () => {},
      readHighWater: () => ({
        protocolVersion: 2,
        jobLogs: 1,
        sessionEvents: 2,
        nativeEvents: 3,
      }),
      prepareHandoff: async () => {
        attempts += 1;
        throw new Error("handoff unavailable");
      },
      release: async () => {
        released = true;
      },
    })).rejects.toThrow("handoff unavailable");

    expect(attempts).toBe(1);
    expect(released).toBe(false);
  });
});
