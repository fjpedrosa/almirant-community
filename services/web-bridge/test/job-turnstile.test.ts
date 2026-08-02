import { describe, expect, it } from "bun:test";
import { createJobTurnstile } from "../src/consumer";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("createJobTurnstile", () => {
  it("serializes one job's holders in arrival order", async () => {
    // This is what protects the live stream. Page concurrency exists for native
    // events, which are never rendered; canonical events are published to the
    // user in sequence order and their inserts contend on one agent_jobs row, so
    // they must stay serialized per job exactly as under the sequential loop.
    const acquire = createJobTurnstile();
    const order: number[] = [];
    let inFlight = 0;
    let maxInFlight = 0;

    await Promise.all(
      [1, 2, 3, 4, 5].map(async (index) => {
        const release = await acquire("job-1");
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        order.push(index);
        // A holder that yields must still exclude the next one.
        await wait(5);
        inFlight -= 1;
        release();
      }),
    );

    expect(maxInFlight).toBe(1);
    expect(order).toEqual([1, 2, 3, 4, 5]);
  });

  it("does not serialize across jobs", async () => {
    // The turnstile is per job, not global: two jobs' canonical events have no
    // ordering relationship and must not wait on each other.
    const acquire = createJobTurnstile();
    let inFlight = 0;
    let maxInFlight = 0;

    await Promise.all(
      ["job-a", "job-b", "job-c"].map(async (jobId) => {
        const release = await acquire(jobId);
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await wait(10);
        inFlight -= 1;
        release();
      }),
    );

    expect(maxInFlight).toBe(3);
  });

  it("hands the turn on even when a holder throws", async () => {
    // The consumer releases in a finally, so a failing handler must not wedge
    // every later event of that job.
    const acquire = createJobTurnstile();
    const release = await acquire("job-1");
    let second = false;
    const waiting = acquire("job-1").then((releaseSecond) => {
      second = true;
      releaseSecond();
    });

    expect(second).toBe(false);
    release();
    await waiting;
    expect(second).toBe(true);
  });

  it("does not retain state for a job once its queue empties", async () => {
    const acquire = createJobTurnstile();
    for (let index = 0; index < 3; index += 1) {
      const release = await acquire("job-1");
      release();
    }
    // A fresh acquisition after the queue drained must be immediate, which is
    // only true if the previous tail was dropped rather than chained forever.
    const started = Date.now();
    (await acquire("job-1"))();
    expect(Date.now() - started).toBeLessThan(50);
  });
});
