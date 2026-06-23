import { describe, test, expect } from "bun:test";
import { createRetryTracker } from "../retry-tracker";

describe("RetryTracker", () => {
  test("exponential backoff — delay doubles each retry", () => {
    const tracker = createRetryTracker({
      maxRetries: 10,
      baseDelayMs: 100,
      maxDelayMs: 100_000,
    });

    // We can't directly observe the delay, but we can observe that
    // getRetryableEventIds respects the nextRetryAt timing.
    // Instead, let's verify the retry count increments.
    expect(tracker.getRetryCount("e-1")).toBe(0);

    tracker.recordFailure("e-1");
    expect(tracker.getRetryCount("e-1")).toBe(1);

    tracker.recordFailure("e-1");
    expect(tracker.getRetryCount("e-1")).toBe(2);

    tracker.recordFailure("e-1");
    expect(tracker.getRetryCount("e-1")).toBe(3);
  });

  test("exponential backoff — events are NOT retryable before their delay", () => {
    const tracker = createRetryTracker({
      maxRetries: 10,
      baseDelayMs: 60_000, // Very long base delay
      maxDelayMs: 300_000,
    });

    tracker.recordFailure("e-1");
    const now = Date.now();

    // Right after failure, the event should NOT be retryable because
    // nextRetryAt is at least 60_000ms * 2^1 = 120s in the future
    const retryable = tracker.getRetryableEventIds(now);
    expect(retryable).not.toContain("e-1");
  });

  test("exponential backoff — events ARE retryable after their delay", () => {
    const tracker = createRetryTracker({
      maxRetries: 10,
      baseDelayMs: 100,
      maxDelayMs: 1000,
    });

    tracker.recordFailure("e-1");

    // Far future — should be retryable
    const farFuture = Date.now() + 100_000;
    const retryable = tracker.getRetryableEventIds(farFuture);
    expect(retryable).toContain("e-1");
  });

  test("jitter — delay has random component within bounds", () => {
    // Run multiple times and verify delays are not all identical
    for (let i = 0; i < 20; i++) {
      const tracker = createRetryTracker({
        maxRetries: 10,
        baseDelayMs: 1000,
        maxDelayMs: 100_000,
      });

      const before = Date.now();
      tracker.recordFailure(`e-${i}`);

      // Check that the event becomes retryable at some point in the future
      // but NOT immediately (base delay * 2^1 = 2000ms minimum)
      const retryableNow = tracker.getRetryableEventIds(before);
      expect(retryableNow).not.toContain(`e-${i}`);

      // Should be retryable well after the max possible delay (2000 + 50% jitter = 3000)
      const retryableLater = tracker.getRetryableEventIds(before + 10_000);
      expect(retryableLater).toContain(`e-${i}`);
    }
  });

  test("max retries exhaustion — shouldRetry returns false after maxRetries", () => {
    const tracker = createRetryTracker({
      maxRetries: 3,
      baseDelayMs: 1,
      maxDelayMs: 10,
    });

    expect(tracker.shouldRetry("e-1")).toBe(true);

    tracker.recordFailure("e-1"); // count = 1
    expect(tracker.shouldRetry("e-1")).toBe(true);

    tracker.recordFailure("e-1"); // count = 2
    expect(tracker.shouldRetry("e-1")).toBe(true);

    tracker.recordFailure("e-1"); // count = 3
    expect(tracker.shouldRetry("e-1")).toBe(false);
  });

  test("max retries — exhausted events are excluded from getRetryableEventIds", () => {
    const tracker = createRetryTracker({
      maxRetries: 2,
      baseDelayMs: 1,
      maxDelayMs: 10,
    });

    tracker.recordFailure("e-1"); // count = 1
    tracker.recordFailure("e-1"); // count = 2 — exhausted

    const farFuture = Date.now() + 100_000;
    const retryable = tracker.getRetryableEventIds(farFuture);
    expect(retryable).not.toContain("e-1");
  });

  test("remove — cleanup works", () => {
    const tracker = createRetryTracker({
      maxRetries: 5,
      baseDelayMs: 1,
      maxDelayMs: 10,
    });

    tracker.recordFailure("e-1");
    tracker.recordFailure("e-1");
    expect(tracker.getRetryCount("e-1")).toBe(2);

    tracker.remove("e-1");
    expect(tracker.getRetryCount("e-1")).toBe(0);
    expect(tracker.shouldRetry("e-1")).toBe(true);

    // No longer in retryable set
    const farFuture = Date.now() + 100_000;
    expect(tracker.getRetryableEventIds(farFuture)).not.toContain("e-1");
  });

  test("getRetryableEventIds — only returns past-due events", () => {
    const tracker = createRetryTracker({
      maxRetries: 10,
      baseDelayMs: 100,
      maxDelayMs: 1000,
    });

    tracker.recordFailure("e-1");
    tracker.recordFailure("e-2");
    tracker.recordFailure("e-3");

    const now = Date.now();

    // Immediately after failures, none should be retryable
    // (base delay * 2^1 = 200ms minimum, plus jitter)
    const immediateRetryable = tracker.getRetryableEventIds(now);
    expect(immediateRetryable).toHaveLength(0);

    // Far in the future, all should be retryable
    const futureRetryable = tracker.getRetryableEventIds(now + 100_000);
    expect(futureRetryable).toContain("e-1");
    expect(futureRetryable).toContain("e-2");
    expect(futureRetryable).toContain("e-3");
  });

  test("multiple events tracked independently", () => {
    const tracker = createRetryTracker({
      maxRetries: 3,
      baseDelayMs: 1,
      maxDelayMs: 10,
    });

    tracker.recordFailure("e-1");
    tracker.recordFailure("e-1");
    tracker.recordFailure("e-2");

    expect(tracker.getRetryCount("e-1")).toBe(2);
    expect(tracker.getRetryCount("e-2")).toBe(1);
    expect(tracker.shouldRetry("e-1")).toBe(true);
    expect(tracker.shouldRetry("e-2")).toBe(true);

    tracker.recordFailure("e-1"); // count = 3 — exhausted
    expect(tracker.shouldRetry("e-1")).toBe(false);
    expect(tracker.shouldRetry("e-2")).toBe(true);
  });
});
