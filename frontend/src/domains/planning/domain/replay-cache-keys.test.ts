import { describe, expect, it } from "bun:test";
import { planningReplayCacheKeys } from "./replay-cache-keys";
import { planningSessionKeys } from "./query-keys";

// These keys route the transcript/replay loaders through the React Query cache so
// navigating A -> B -> A (or a spurious remount) dedupes instead of re-downloading
// up to ~20k chunks. The guarantees the loaders rely on:
//   1. STABLE: same inputs -> deeply equal key (so React Query dedupes/caches).
//   2. ORG-SCOPED: partitioned by workspace (no cross-org cache bleed).
//   3. DISTINCT: different session/job/org -> different key.
describe("planningReplayCacheKeys", () => {
  it("messagesFromLogs is stable for the same (sessionId, orgId)", () => {
    const a = planningReplayCacheKeys.messagesFromLogs("s1", "org-1");
    const b = planningReplayCacheKeys.messagesFromLogs("s1", "org-1");
    expect(a).toEqual(b);
    // built from the canonical detail() prefix + a replay marker + org scope
    expect(a).toEqual([
      ...planningSessionKeys.detail("s1"),
      "replay-logs",
      "org:org-1",
    ]);
  });

  it("generatedItems reuses the canonical work-items key (org-scoped)", () => {
    const key = planningReplayCacheKeys.generatedItems("s1", "org-1");
    expect(key).toEqual([...planningSessionKeys.workItems("s1"), "org:org-1"]);
    // stable
    expect(key).toEqual(planningReplayCacheKeys.generatedItems("s1", "org-1"));
  });

  it("replayTrace is keyed by jobId and org-scoped, stable across calls", () => {
    const a = planningReplayCacheKeys.replayTrace("job-9", "org-1");
    const b = planningReplayCacheKeys.replayTrace("job-9", "org-1");
    expect(a).toEqual(b);
    expect(a.at(-1)).toBe("org:org-1");
    expect(a).toContain("job-9");
  });

  it("partitions by org: same session, different workspace -> different key", () => {
    const orgA = planningReplayCacheKeys.messagesFromLogs("s1", "org-A");
    const orgB = planningReplayCacheKeys.messagesFromLogs("s1", "org-B");
    expect(orgA).not.toEqual(orgB);
  });

  it("distinguishes sessions and jobs", () => {
    expect(planningReplayCacheKeys.messagesFromLogs("s1", "o")).not.toEqual(
      planningReplayCacheKeys.messagesFromLogs("s2", "o"),
    );
    expect(planningReplayCacheKeys.replayTrace("j1", "o")).not.toEqual(
      planningReplayCacheKeys.replayTrace("j2", "o"),
    );
  });

  it("falls back to org:none when the workspace id is not yet resolved", () => {
    const key = planningReplayCacheKeys.messagesFromLogs("s1", null);
    expect(key.at(-1)).toBe("org:none");
  });
});
