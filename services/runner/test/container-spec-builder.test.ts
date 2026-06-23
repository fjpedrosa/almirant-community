import { describe, expect, it } from "bun:test";
import {
  PROVIDER_MEMORY_BUMP,
  computeMemoryLimit,
} from "../src/workspace/container-spec-builder";
import { getResourcesForTier } from "../src/orchestration/job-intent";

/**
 * Memory-bump regression tests.
 *
 * Context: 28/33 post-`job.completed` OOM events in a 14-day window were
 * traced to the post-session push temporarily running a second LLM session
 * on the same serve process (claude-shim + serve). The Codex runtime already
 * had a bump; claude-shim did not.
 *
 * These tests guard that the bump table keeps the intended values and that
 * `computeMemoryLimit` returns the base memory without double-counting tmpfs
 * in bind mode.
 */
describe("PROVIDER_MEMORY_BUMP", () => {
  it("keeps the existing codex-shim bump", () => {
    expect(PROVIDER_MEMORY_BUMP["codex-shim"]).toBe(1536);
  });

  it("adds a 512MB bump for claude-shim to absorb the post-session push window", () => {
    expect(PROVIDER_MEMORY_BUMP["claude-shim"]).toBe(512);
  });

  it("does NOT bump the neutral opencode runtime", () => {
    expect(PROVIDER_MEMORY_BUMP["opencode"]).toBeUndefined();
  });
});

describe("computeMemoryLimit", () => {
  it("returns resources.memoryMb in bind mode (no tmpfs overhead)", () => {
    const resources = getResourcesForTier("standard");
    expect(computeMemoryLimit(resources, true)).toBe(resources.memoryMb);
  });

  it("includes tmpfs sizes when bind mode is disabled", () => {
    const resources = getResourcesForTier("standard");
    const expected =
      resources.memoryMb +
      resources.tmpfs.workspace +
      resources.tmpfs.tmp +
      resources.tmpfs.home;
    expect(computeMemoryLimit(resources, false)).toBe(expected);
  });

  it("claude-shim bind-mode final limit is 2028 + 512 = 2540 MB for the standard tier", () => {
    const resources = getResourcesForTier("standard");
    const base = computeMemoryLimit(resources, true);
    const bumped = base + (PROVIDER_MEMORY_BUMP["claude-shim"] ?? 0);
    expect(bumped).toBe(2540);
  });

  it("codex-shim bind-mode final limit remains 2028 + 1536 = 3564 MB for the standard tier", () => {
    const resources = getResourcesForTier("standard");
    const base = computeMemoryLimit(resources, true);
    const bumped = base + (PROVIDER_MEMORY_BUMP["codex-shim"] ?? 0);
    expect(bumped).toBe(3564);
  });
});
