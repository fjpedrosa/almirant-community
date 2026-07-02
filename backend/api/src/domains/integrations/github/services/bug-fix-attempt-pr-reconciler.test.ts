import { afterAll, describe, expect, it, mock } from "bun:test";
import { restoreRealModules } from "../../../../test/mocks";

// `mock.module` is sticky across bun test files in the same process; leaking
// our stubs into sibling suites (particularly `feedback-cluster-repository`
// which uses the real drizzle `sql` tagged template) would break them.
// `restoreRealModules()` re-installs the real `@almirant/config` and
// `@almirant/database` on teardown.
mock.module("@almirant/config", () => ({
  env: {},
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
}));

// The reconciler only needs injectable dependencies at test time; stub the
// `@almirant/database` import surface to the bare minimum the module reads
// at import (no real DB connection).
mock.module("@almirant/database", () => ({
  db: {},
  sql: () => null,
  and: () => null,
  isNotNull: () => null,
  inArray: () => null,
  bugFixAttempts: {},
  getInstallationByRepoId: async () => null,
  getRepoIdByGithubFullName: async () => null,
}));

afterAll(() => {
  mock.restore();
  restoreRealModules();
});

import {
  decideFromPrState,
  runBugFixAttemptPrReconciliationOnce,
  type BugFixAttemptReconcilerDeps,
  type PrRemoteState,
  type StuckAttempt,
} from "./bug-fix-attempt-pr-reconciler";

describe("decideFromPrState — pure decision (drift recovery)", () => {
  it("routes a merged PR to the merge path", () => {
    const action = decideFromPrState({
      kind: "merged",
      mergedAt: "2026-04-18T20:00:00.000Z",
      closedAt: "2026-04-18T20:00:00.000Z",
    });
    expect(action).toEqual({
      kind: "run_merge_path",
      mergedAt: "2026-04-18T20:00:00.000Z",
      closedAt: "2026-04-18T20:00:00.000Z",
    });
  });

  it("routes a closed-without-merge PR to the failure path", () => {
    const action = decideFromPrState({
      kind: "closed_unmerged",
      closedAt: "2026-04-18T20:00:00.000Z",
    });
    expect(action).toEqual({
      kind: "run_closed_unmerged_path",
      closedAt: "2026-04-18T20:00:00.000Z",
    });
  });

  it("skips open PRs (attempt still valid, webhook may still arrive)", () => {
    expect(decideFromPrState({ kind: "open" })).toEqual({ kind: "skip_pr_open" });
  });

  it("skips draft PRs (same reason as open: not terminal yet)", () => {
    expect(decideFromPrState({ kind: "draft" })).toEqual({ kind: "skip_pr_draft" });
  });

  it("skips PRs we cannot resolve (missing installation or deleted PR)", () => {
    expect(decideFromPrState({ kind: "not_found" })).toEqual({
      kind: "skip_pr_not_found",
    });
  });
});

// Helpers to build test fixtures concise enough to let the expectations drive
// the story instead of boilerplate.
const makeAttempt = (overrides: Partial<StuckAttempt> = {}): StuckAttempt => ({
  id: overrides.id ?? "attempt-1",
  clusterId: overrides.clusterId ?? "cluster-1",
  feedbackItemId: overrides.feedbackItemId ?? "feedback-1",
  fixPrNumber: overrides.fixPrNumber ?? 100,
  fixPrUrl:
    overrides.fixPrUrl ?? "https://github.com/owner/repo/pull/100",
  projectId: overrides.projectId ?? "project-1",
  workspaceId: overrides.workspaceId ?? "workspace-1",
  status: overrides.status ?? "implementing",
  updatedAt: overrides.updatedAt ?? new Date("2026-04-18T19:00:00.000Z"),
});

type MergePathCall = {
  html_url: string;
  number: number;
  merged_at: string;
  closed_at: string | null;
};
type ClosedUnmergedPathCall = {
  html_url: string;
  number: number;
  closed_at: string | null;
};

const makeDeps = (opts: {
  attempts: StuckAttempt[];
  prStatesByAttemptId: Record<string, PrRemoteState | "throw">;
  mergePathBehavior?: "ok" | "throw";
  closedUnmergedPathBehavior?: "ok" | "throw";
}): {
  deps: BugFixAttemptReconcilerDeps;
  calls: {
    loadCalls: { olderThanMinutes: number; batchSize: number }[];
    fetchCalls: StuckAttempt[];
    mergePathCalls: MergePathCall[];
    closedUnmergedPathCalls: ClosedUnmergedPathCall[];
  };
} => {
  const loadCalls: { olderThanMinutes: number; batchSize: number }[] = [];
  const fetchCalls: StuckAttempt[] = [];
  const mergePathCalls: MergePathCall[] = [];
  const closedUnmergedPathCalls: ClosedUnmergedPathCall[] = [];

  const deps: BugFixAttemptReconcilerDeps = {
    loadStuckAttempts: async (cfg) => {
      loadCalls.push(cfg);
      return opts.attempts;
    },
    fetchPrState: async (attempt) => {
      fetchCalls.push(attempt);
      const configured = opts.prStatesByAttemptId[attempt.id];
      if (configured === "throw") {
        throw new Error(`boom for ${attempt.id}`);
      }
      if (!configured) {
        throw new Error(`no pr state configured for ${attempt.id}`);
      }
      return configured;
    },
    runMergePath: async (pr) => {
      mergePathCalls.push(pr);
      if (opts.mergePathBehavior === "throw") {
        throw new Error("merge-path boom");
      }
    },
    runClosedUnmergedPath: async (pr) => {
      closedUnmergedPathCalls.push(pr);
      if (opts.closedUnmergedPathBehavior === "throw") {
        throw new Error("closed-unmerged-path boom");
      }
    },
  };

  return {
    deps,
    calls: {
      loadCalls,
      fetchCalls,
      mergePathCalls,
      closedUnmergedPathCalls,
    },
  };
};

describe("runBugFixAttemptPrReconciliationOnce", () => {
  it("invokes the merge path for a merged PR and counts it", async () => {
    const attempt = makeAttempt({
      id: "attempt-merged-drift",
      fixPrUrl: "https://github.com/owner/repo/pull/200",
      fixPrNumber: 200,
    });
    const { deps, calls } = makeDeps({
      attempts: [attempt],
      prStatesByAttemptId: {
        "attempt-merged-drift": {
          kind: "merged",
          mergedAt: "2026-04-18T20:00:00.000Z",
          closedAt: "2026-04-18T20:00:00.000Z",
        },
      },
    });

    const result = await runBugFixAttemptPrReconciliationOnce(deps, {
      olderThanMinutes: 10,
      batchSize: 25,
    });

    expect(result.checked).toBe(1);
    expect(result.merged).toBe(1);
    expect(result.failedUnmerged).toBe(0);
    expect(result.stillOpen).toBe(0);
    expect(result.notFound).toBe(0);
    expect(calls.mergePathCalls).toEqual([
      {
        html_url: "https://github.com/owner/repo/pull/200",
        number: 200,
        merged_at: "2026-04-18T20:00:00.000Z",
        closed_at: "2026-04-18T20:00:00.000Z",
      },
    ]);
    expect(calls.closedUnmergedPathCalls).toHaveLength(0);
    expect(calls.loadCalls).toEqual([{ olderThanMinutes: 10, batchSize: 25 }]);
  });

  it("invokes the closed-unmerged path for a closed unmerged PR and counts it", async () => {
    const attempt = makeAttempt({
      id: "attempt-closed-drift",
      fixPrUrl: "https://github.com/owner/repo/pull/201",
      fixPrNumber: 201,
    });
    const { deps, calls } = makeDeps({
      attempts: [attempt],
      prStatesByAttemptId: {
        "attempt-closed-drift": {
          kind: "closed_unmerged",
          closedAt: "2026-04-18T20:00:00.000Z",
        },
      },
    });

    const result = await runBugFixAttemptPrReconciliationOnce(deps, {
      olderThanMinutes: 10,
      batchSize: 25,
    });

    expect(result.checked).toBe(1);
    expect(result.failedUnmerged).toBe(1);
    expect(result.merged).toBe(0);
    expect(calls.closedUnmergedPathCalls).toEqual([
      {
        html_url: "https://github.com/owner/repo/pull/201",
        number: 201,
        closed_at: "2026-04-18T20:00:00.000Z",
      },
    ]);
    expect(calls.mergePathCalls).toHaveLength(0);
  });

  it("skips attempts whose PR is still open or draft", async () => {
    const { deps, calls } = makeDeps({
      attempts: [
        makeAttempt({ id: "attempt-open", fixPrNumber: 300 }),
        makeAttempt({ id: "attempt-draft", fixPrNumber: 301 }),
      ],
      prStatesByAttemptId: {
        "attempt-open": { kind: "open" },
        "attempt-draft": { kind: "draft" },
      },
    });

    const result = await runBugFixAttemptPrReconciliationOnce(deps, {
      olderThanMinutes: 10,
      batchSize: 25,
    });

    expect(result.checked).toBe(2);
    expect(result.stillOpen).toBe(2);
    expect(calls.mergePathCalls).toHaveLength(0);
    expect(calls.closedUnmergedPathCalls).toHaveLength(0);
  });

  it("skips attempts whose PR cannot be resolved without failing the whole batch", async () => {
    const { deps, calls } = makeDeps({
      attempts: [
        makeAttempt({ id: "attempt-not-found", fixPrNumber: 400 }),
        makeAttempt({
          id: "attempt-merged-alongside",
          fixPrUrl: "https://github.com/owner/repo/pull/401",
          fixPrNumber: 401,
        }),
      ],
      prStatesByAttemptId: {
        "attempt-not-found": { kind: "not_found" },
        "attempt-merged-alongside": {
          kind: "merged",
          mergedAt: "2026-04-18T20:00:00.000Z",
          closedAt: null,
        },
      },
    });

    const result = await runBugFixAttemptPrReconciliationOnce(deps, {
      olderThanMinutes: 10,
      batchSize: 25,
    });

    expect(result.checked).toBe(2);
    expect(result.notFound).toBe(1);
    expect(result.merged).toBe(1);
    expect(calls.mergePathCalls).toHaveLength(1);
  });

  it("continues processing remaining attempts when one throws on fetch", async () => {
    const { deps, calls } = makeDeps({
      attempts: [
        makeAttempt({ id: "attempt-fetch-boom", fixPrNumber: 500 }),
        makeAttempt({
          id: "attempt-merged-after-boom",
          fixPrUrl: "https://github.com/owner/repo/pull/501",
          fixPrNumber: 501,
        }),
      ],
      prStatesByAttemptId: {
        "attempt-fetch-boom": "throw",
        "attempt-merged-after-boom": {
          kind: "merged",
          mergedAt: "2026-04-18T20:00:00.000Z",
          closedAt: null,
        },
      },
    });

    const result = await runBugFixAttemptPrReconciliationOnce(deps, {
      olderThanMinutes: 10,
      batchSize: 25,
    });

    expect(result.checked).toBe(2);
    expect(result.merged).toBe(1);
    expect(result.errored).toBe(1);
    expect(calls.mergePathCalls).toHaveLength(1);
  });

  it("is a no-op when no stuck attempts are found", async () => {
    const { deps, calls } = makeDeps({
      attempts: [],
      prStatesByAttemptId: {},
    });

    const result = await runBugFixAttemptPrReconciliationOnce(deps, {
      olderThanMinutes: 10,
      batchSize: 25,
    });

    expect(result).toEqual({
      checked: 0,
      merged: 0,
      failedUnmerged: 0,
      stillOpen: 0,
      notFound: 0,
      errored: 0,
    });
    expect(calls.fetchCalls).toHaveLength(0);
    expect(calls.mergePathCalls).toHaveLength(0);
  });
});
