import { afterEach, describe, expect, it } from "bun:test";
import {
  __resetFeatureFlagCache,
  invalidateFeatureFlagCache,
  isFeatureFlagEnabled,
} from "./posthog-service";

// These tests run with POSTHOG_API_KEY intentionally unset in the test env,
// so `isFeatureFlagEnabled` exercises the fail-closed path (returns false without
// hitting the network). Behavior-with-client is covered by integration tests.

afterEach(() => {
  __resetFeatureFlagCache();
});

describe("isFeatureFlagEnabled — fail-closed semantics", () => {
  it("returns false when PostHog is not configured", async () => {
    const result = await isFeatureFlagEnabled("effort-estimation-v1", "org-1");
    expect(result).toBe(false);
  });

  it("returns false consistently across calls without cache writes when unconfigured", async () => {
    // Without POSTHOG_API_KEY, we return false WITHOUT writing to cache
    // (so invalidate is a no-op and subsequent calls still return false).
    const first = await isFeatureFlagEnabled("flag-a", "user-1");
    const second = await isFeatureFlagEnabled("flag-a", "user-1");
    expect(first).toBe(false);
    expect(second).toBe(false);
  });
});

describe("invalidateFeatureFlagCache", () => {
  it("is a no-op when cache is empty", () => {
    expect(() => invalidateFeatureFlagCache()).not.toThrow();
    expect(() => invalidateFeatureFlagCache("some-flag")).not.toThrow();
    expect(() => invalidateFeatureFlagCache(undefined, "some-user")).not.toThrow();
  });
});

describe("__resetFeatureFlagCache", () => {
  it("clears the cache without throwing", () => {
    expect(() => __resetFeatureFlagCache()).not.toThrow();
  });
});
