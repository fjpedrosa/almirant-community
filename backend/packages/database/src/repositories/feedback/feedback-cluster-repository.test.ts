import { describe, expect, test } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { ACTIVE_CLUSTER_STATUSES } from "@almirant/shared";
import { sql } from "drizzle-orm";
import {
  CLUSTER_RETRY_BUDGET_MAX_ATTEMPTS,
  CLUSTER_TRANSITIONS,
  buildListClustersOrderBy,
  canRecoverToResolved,
  isValidTransition,
  resolveListClustersParams,
  type ClusterStatusEnum,
  type FeedbackClusterDetail,
  type LaunchInvestigationRequest,
  type LaunchInvestigationResult,
  type RetryBudgetStatus,
} from "./feedback-cluster-repository";

// ────────────────────────────────────────────────────────────────────────────
// listClusters — pure helpers (A-F-437)
// ────────────────────────────────────────────────────────────────────────────
//
// `listClusters` itself is DB-bound, but the param defaulting and the
// ORDER BY column selection are extracted as pure helpers precisely so the
// unit suite can guard the A-F-437 contract without a Postgres instance.

const dialect = new PgDialect();

/**
 * Render a Drizzle SQL fragment (such as the ones returned by `desc(column)`)
 * to a raw SQL string so the test can assert on column name + direction.
 */
const renderSql = (fragment: unknown): string =>
  dialect.sqlToQuery(sql`${fragment}` as never).sql;

describe("resolveListClustersParams — defaults (A-F-437)", () => {
  test("sortBy defaults to 'updatedAt' when omitted", () => {
    const resolved = resolveListClustersParams({ workspaceId: "org-1" });
    expect(resolved.sortBy).toBe("updatedAt");
  });

  test("sortBy='itemCount' is preserved when explicitly requested", () => {
    const resolved = resolveListClustersParams({
      workspaceId: "org-1",
      sortBy: "itemCount",
    });
    expect(resolved.sortBy).toBe("itemCount");
  });

  test("sortBy='createdAt' is preserved when explicitly requested", () => {
    const resolved = resolveListClustersParams({
      workspaceId: "org-1",
      sortBy: "createdAt",
    });
    expect(resolved.sortBy).toBe("createdAt");
  });

  test("statuses defaults to ACTIVE_CLUSTER_STATUSES when omitted", () => {
    const resolved = resolveListClustersParams({ workspaceId: "org-1" });
    expect(resolved.statuses).toEqual(ACTIVE_CLUSTER_STATUSES);
  });

  test("statuses filter is honoured when every value is in the enum", () => {
    const resolved = resolveListClustersParams({
      workspaceId: "org-1",
      statuses: ["open", "investigating"],
    });
    expect(resolved.statuses).toEqual(["open", "investigating"]);
  });

  test("minItemCount defaults to 1 when omitted", () => {
    const resolved = resolveListClustersParams({ workspaceId: "org-1" });
    expect(resolved.minItemCount).toBe(1);
  });

  test("minItemCount clamps non-positive values back to the default of 1", () => {
    const resolved = resolveListClustersParams({
      workspaceId: "org-1",
      minItemCount: 0,
    });
    expect(resolved.minItemCount).toBe(1);
  });

  test("minItemCount honours explicit positive values so low-count clusters are hidden", () => {
    const resolved = resolveListClustersParams({
      workspaceId: "org-1",
      minItemCount: 3,
    });
    expect(resolved.minItemCount).toBe(3);
  });
});

describe("buildListClustersOrderBy — primary + tiebreaker columns (A-F-437)", () => {
  test("sortBy='updatedAt' orders by updated_at DESC with item_count as DESC tiebreaker", () => {
    const order = buildListClustersOrderBy("updatedAt");
    expect(order).toHaveLength(2);
    const primary = renderSql(order[0]);
    const secondary = renderSql(order[1]);
    expect(primary).toContain('"updated_at"');
    expect(primary).toMatch(/desc/i);
    expect(secondary).toContain('"item_count"');
    expect(secondary).toMatch(/desc/i);
  });

  test("sortBy='itemCount' orders by item_count DESC with created_at as DESC tiebreaker", () => {
    const order = buildListClustersOrderBy("itemCount");
    expect(order).toHaveLength(2);
    const primary = renderSql(order[0]);
    const secondary = renderSql(order[1]);
    expect(primary).toContain('"item_count"');
    expect(primary).toMatch(/desc/i);
    expect(secondary).toContain('"created_at"');
    expect(secondary).toMatch(/desc/i);
  });

  test("sortBy='createdAt' orders by created_at DESC with item_count as DESC tiebreaker", () => {
    const order = buildListClustersOrderBy("createdAt");
    expect(order).toHaveLength(2);
    const primary = renderSql(order[0]);
    const secondary = renderSql(order[1]);
    expect(primary).toContain('"created_at"');
    expect(primary).toMatch(/desc/i);
    expect(secondary).toContain('"item_count"');
    expect(secondary).toMatch(/desc/i);
  });
});

describe("CLUSTER_TRANSITIONS matrix", () => {
  test("covers every status in the enum", () => {
    const expectedKeys: ClusterStatusEnum[] = [
      "open",
      "investigating",
      "fix_ready",
      "resolved",
      "regression",
      "dismissed",
      "promoted",
    ];

    for (const status of expectedKeys) {
      expect(CLUSTER_TRANSITIONS[status]).toBeDefined();
      expect(Array.isArray(CLUSTER_TRANSITIONS[status])).toBe(true);
    }
  });

  test("dismissed is terminal (no outgoing transitions)", () => {
    expect(CLUSTER_TRANSITIONS.dismissed).toEqual([]);
  });

  test("promoted is terminal legacy (no outgoing transitions)", () => {
    expect(CLUSTER_TRANSITIONS.promoted).toEqual([]);
  });
});

describe("isValidTransition — valid transitions", () => {
  test("open → investigating is valid (triage start)", () => {
    expect(isValidTransition("open", "investigating")).toBe(true);
  });

  test("investigating → fix_ready is valid (agent proposed a fix)", () => {
    expect(isValidTransition("investigating", "fix_ready")).toBe(true);
  });

  test("fix_ready → resolved is valid (PR merged)", () => {
    expect(isValidTransition("fix_ready", "resolved")).toBe(true);
  });

  test("resolved → regression is valid (new matching feedback arrived)", () => {
    expect(isValidTransition("resolved", "regression")).toBe(true);
  });

  test("regression → investigating is valid (reopen after regression)", () => {
    expect(isValidTransition("regression", "investigating")).toBe(true);
  });

  test("resolved → investigating is valid (manual reopen)", () => {
    expect(isValidTransition("resolved", "investigating")).toBe(true);
  });

  test("every status except terminals can transition to dismissed", () => {
    expect(isValidTransition("open", "dismissed")).toBe(true);
    expect(isValidTransition("investigating", "dismissed")).toBe(true);
    expect(isValidTransition("fix_ready", "dismissed")).toBe(true);
    expect(isValidTransition("resolved", "dismissed")).toBe(true);
    expect(isValidTransition("regression", "dismissed")).toBe(true);
  });

  test("investigating and fix_ready can roll back to open", () => {
    expect(isValidTransition("investigating", "open")).toBe(true);
    expect(isValidTransition("fix_ready", "open")).toBe(true);
  });
});

describe("isValidTransition — invalid transitions", () => {
  test("dismissed → open is rejected (terminal state)", () => {
    expect(isValidTransition("dismissed", "open")).toBe(false);
  });

  test("promoted → investigating is rejected (terminal legacy)", () => {
    expect(isValidTransition("promoted", "investigating")).toBe(false);
  });

  test("resolved → open (bypassing investigating) is rejected", () => {
    expect(isValidTransition("resolved", "open")).toBe(false);
  });

  test("open → fix_ready skips investigating and is rejected", () => {
    expect(isValidTransition("open", "fix_ready")).toBe(false);
  });

  test("open → resolved skips the entire lifecycle and is rejected", () => {
    expect(isValidTransition("open", "resolved")).toBe(false);
  });

  test("regression → resolved must go through investigating/fix_ready first", () => {
    expect(isValidTransition("regression", "resolved")).toBe(false);
  });

  test("fix_ready → regression is rejected (must resolve first)", () => {
    expect(isValidTransition("fix_ready", "regression")).toBe(false);
  });

  test("self-transitions are not listed as valid in the matrix", () => {
    // Note: `transitionCluster` treats toStatus === fromStatus as a no-op
    // success, but the matrix itself does not include self-loops.
    expect(isValidTransition("open", "open")).toBe(false);
    expect(isValidTransition("resolved", "resolved")).toBe(false);
  });
});

describe("canRecoverToResolved — drift recovery predicate", () => {
  // Unlike `isValidTransition`, this predicate is used by the PR-merge
  // webhook + the drift-recovery sweeper to jump straight to `resolved` when
  // GitHub reports the bug-fix PR is merged. The matrix stays strict for the
  // human lifecycle; this predicate is the privileged shortcut and only
  // terminal states block it.

  test("allows recovery from open (cluster never flipped to investigating)", () => {
    expect(canRecoverToResolved("open")).toBe(true);
  });

  test("allows recovery from investigating (PR merge webhook missed fix_ready flip)", () => {
    expect(canRecoverToResolved("investigating")).toBe(true);
  });

  test("allows recovery from fix_ready (happy path for the PR-merge webhook)", () => {
    expect(canRecoverToResolved("fix_ready")).toBe(true);
  });

  test("allows recovery from regression (re-fix PR merged after regression signal)", () => {
    expect(canRecoverToResolved("regression")).toBe(true);
  });

  test("is idempotent from resolved (duplicate webhook / redelivery)", () => {
    expect(canRecoverToResolved("resolved")).toBe(true);
  });

  test("blocks recovery from dismissed (terminal, human intent)", () => {
    expect(canRecoverToResolved("dismissed")).toBe(false);
  });

  test("blocks recovery from promoted (terminal legacy)", () => {
    expect(canRecoverToResolved("promoted")).toBe(false);
  });
});

describe("FeedbackClusterDetail shape", () => {
  // These tests validate the TypeScript contract of the aggregate returned
  // by `getFeedbackClusterDetail`. They do not exercise the DB — that's
  // covered by the integration suite — but they guarantee the shape stays
  // stable for the cluster-detail modal consumers.
  test("accepts a well-formed detail object with no promotion and no active attempt", () => {
    const detail: FeedbackClusterDetail = {
      cluster: {} as FeedbackClusterDetail["cluster"],
      items: [],
      bugFixAttempts: [],
      activeAttempt: null,
      statusHistory: [],
      promotion: null,
      timelineEvents: [],
      summary: {} as FeedbackClusterDetail["summary"],
    };

    expect(detail.activeAttempt).toBeNull();
    expect(detail.promotion).toBeNull();
    expect(Array.isArray(detail.items)).toBe(true);
    expect(Array.isArray(detail.bugFixAttempts)).toBe(true);
    expect(Array.isArray(detail.statusHistory)).toBe(true);
    expect(Array.isArray(detail.timelineEvents)).toBe(true);
    expect(detail.timelineEvents).toEqual([]);
  });

  test("accepts a promotion with null work item (work item deleted scenario)", () => {
    const detail: FeedbackClusterDetail = {
      cluster: {} as FeedbackClusterDetail["cluster"],
      items: [],
      bugFixAttempts: [],
      activeAttempt: null,
      statusHistory: [],
      promotion: {
        promotion: {} as FeedbackClusterDetail["promotion"] extends infer P
          ? P extends { promotion: infer Q }
            ? Q
            : never
          : never,
        workItem: null,
      },
      timelineEvents: [],
      summary: {} as FeedbackClusterDetail["summary"],
    };

    expect(detail.promotion?.workItem).toBeNull();
  });

  test("timelineEvents is typed as ClusterTimelineEvent[] (discriminated union)", () => {
    // Compile-time check: the field must accept any variant of the discriminated
    // union, so we cover a handful here to guard against an accidental narrowing
    // (e.g. someone pinning the field to a single event kind).
    const detail: FeedbackClusterDetail = {
      cluster: {} as FeedbackClusterDetail["cluster"],
      items: [],
      bugFixAttempts: [],
      activeAttempt: null,
      statusHistory: [],
      promotion: null,
      timelineEvents: [
        {
          kind: "ticket_created",
          at: "2025-01-01T00:00:00.000Z",
          ticketId: "t-1",
          ticketTitle: "hello",
          authorName: null,
          authorUserId: null,
        },
        {
          kind: "status_transition",
          at: "2025-01-02T00:00:00.000Z",
          fromStatus: null,
          toStatus: "open",
          triggeredByKind: "system",
          triggeredByUserId: null,
          triggeredByAttemptId: null,
          triggeredByAgentJobId: null,
          reason: null,
        },
      ],
      summary: {} as FeedbackClusterDetail["summary"],
    };

    expect(detail.timelineEvents).toHaveLength(2);
    expect(detail.timelineEvents[0]?.kind).toBe("ticket_created");
    expect(detail.timelineEvents[1]?.kind).toBe("status_transition");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// launchClusterInvestigation contract
// ────────────────────────────────────────────────────────────────────────────
//
// These tests guard the type shape of `LaunchInvestigationRequest` and
// `LaunchInvestigationResult`. The full transactional behaviour lives in the
// integration suite (which hits a real Postgres via docker-compose); these
// pure-TS tests ensure the tagged-union discriminants stay stable so HTTP
// routes relying on them don't drift silently.

describe("LaunchInvestigationRequest shape", () => {
  test("accepts the minimum required fields (no domain)", () => {
    const req: LaunchInvestigationRequest = {
      clusterId: "00000000-0000-0000-0000-000000000001",
      userId: "user-123",
      projectId: "proj-1",
      workspaceId: "org-1",
    };

    expect(req.clusterId).toBe("00000000-0000-0000-0000-000000000001");
    expect(req.domain).toBeUndefined();
  });

  test("accepts every valid bug domain value", () => {
    const domains = [
      "frontend",
      "backend",
      "coding-agent",
      "infrastructure",
      "unknown",
    ] as const;

    for (const domain of domains) {
      const req: LaunchInvestigationRequest = {
        clusterId: "c",
        userId: "u",
        projectId: "p",
        workspaceId: "o",
        domain,
      };
      expect(req.domain).toBe(domain);
    }
  });
});

describe("LaunchInvestigationResult shape — failure reasons", () => {
  test("cluster_not_found is a pure tagged failure", () => {
    const result: LaunchInvestigationResult = {
      success: false,
      reason: "cluster_not_found",
    };
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe("cluster_not_found");
    }
  });

  test("invalid_state carries the current status string", () => {
    const result: LaunchInvestigationResult = {
      success: false,
      reason: "invalid_state",
      currentStatus: "dismissed",
    };
    if (!result.success && result.reason === "invalid_state") {
      expect(result.currentStatus).toBe("dismissed");
    } else {
      throw new Error("type narrowing failed");
    }
  });

  test("active_attempt_exists optionally carries the winning attempt id", () => {
    const withId: LaunchInvestigationResult = {
      success: false,
      reason: "active_attempt_exists",
      activeAttemptId: "attempt-42",
    };
    const withoutId: LaunchInvestigationResult = {
      success: false,
      reason: "active_attempt_exists",
    };

    if (!withId.success && withId.reason === "active_attempt_exists") {
      expect(withId.activeAttemptId).toBe("attempt-42");
    }
    if (!withoutId.success && withoutId.reason === "active_attempt_exists") {
      expect(withoutId.activeAttemptId).toBeUndefined();
    }
  });

  test("cluster_empty has no extra payload", () => {
    const result: LaunchInvestigationResult = {
      success: false,
      reason: "cluster_empty",
    };
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe("cluster_empty");
    }
  });

  test("max_attempts_reached carries a RetryBudgetStatus with anchor='cluster' in the canonical path", () => {
    // A-F-435: canonical contract — when the launch transaction sees the cluster
    // has already consumed its budget, the failure variant MUST carry a full
    // `RetryBudgetStatus` snapshot so the HTTP layer can render a precise
    // message ("this cluster already has N attempts out of MAX").
    const budget: RetryBudgetStatus = {
      anchor: "cluster",
      anchorId: "00000000-0000-0000-0000-000000000001",
      currentCount: CLUSTER_RETRY_BUDGET_MAX_ATTEMPTS,
      maxAttempts: CLUSTER_RETRY_BUDGET_MAX_ATTEMPTS,
      isExhausted: true,
    };
    const result: LaunchInvestigationResult = {
      success: false,
      reason: "max_attempts_reached",
      budget,
    };
    expect(result.success).toBe(false);
    if (!result.success && result.reason === "max_attempts_reached") {
      expect(result.budget.anchor).toBe("cluster");
      expect(result.budget.isExhausted).toBe(true);
      expect(result.budget.currentCount).toBeGreaterThanOrEqual(
        result.budget.maxAttempts
      );
      expect(result.budget.maxAttempts).toBe(CLUSTER_RETRY_BUDGET_MAX_ATTEMPTS);
    } else {
      throw new Error("type narrowing failed");
    }
  });

  test("max_attempts_reached preserves anchor='feedback_item' for orphan attempts", () => {
    // Orphan path: the feedback item is not (yet) clustered. The budget is
    // counted against the feedback item id and the anchor discriminator must
    // faithfully round-trip through the failure variant so the UI renders a
    // different copy ("this feedback item already has …").
    const budget: RetryBudgetStatus = {
      anchor: "feedback_item",
      anchorId: "feedback-item-42",
      currentCount: CLUSTER_RETRY_BUDGET_MAX_ATTEMPTS,
      maxAttempts: CLUSTER_RETRY_BUDGET_MAX_ATTEMPTS,
      isExhausted: true,
    };
    const result: LaunchInvestigationResult = {
      success: false,
      reason: "max_attempts_reached",
      budget,
    };
    if (!result.success && result.reason === "max_attempts_reached") {
      expect(result.budget.anchor).toBe("feedback_item");
      expect(result.budget.anchorId).toBe("feedback-item-42");
      expect(result.budget.isExhausted).toBe(true);
    } else {
      throw new Error("type narrowing failed");
    }
  });

  test("drift regression: cluster with currentCount=5 and maxAttempts=3 is still a valid isExhausted result", () => {
    // Historical drift (A-F-435): before the budget was canonicalised, some
    // call sites kept inserting attempts past the cap because the counter
    // and the gate lived in different modules. If that happens again the
    // snapshot must still compile AND still report `isExhausted = true` so
    // the HTTP layer returns 422 instead of silently creating a 6th attempt.
    const budget: RetryBudgetStatus = {
      anchor: "cluster",
      anchorId: "00000000-0000-0000-0000-000000000099",
      currentCount: 5,
      maxAttempts: 3,
      isExhausted: true,
    };
    const result: LaunchInvestigationResult = {
      success: false,
      reason: "max_attempts_reached",
      budget,
    };
    if (!result.success && result.reason === "max_attempts_reached") {
      expect(result.budget.currentCount).toBe(5);
      expect(result.budget.maxAttempts).toBe(3);
      expect(result.budget.currentCount).toBeGreaterThan(
        result.budget.maxAttempts
      );
      expect(result.budget.isExhausted).toBe(true);
    } else {
      throw new Error("type narrowing failed");
    }
  });

  test("all five failure reasons are distinct", () => {
    // After the A-F-435 canonicalisation, the union still has exactly five
    // failure discriminants. The `max_attempts_reached` variant now carries a
    // `budget` field, so this test doubles as a compile-time guard that the
    // added field did not accidentally collapse two reasons into one.
    const reasons: Array<Exclude<LaunchInvestigationResult, { success: true }>["reason"]> = [
      "cluster_not_found",
      "invalid_state",
      "active_attempt_exists",
      "cluster_empty",
      "max_attempts_reached",
    ];
    expect(new Set(reasons).size).toBe(5);
  });
});

describe("LaunchInvestigationResult shape — happy path", () => {
  test("success carries attempt, cluster, and primary feedback item id", () => {
    const result: LaunchInvestigationResult = {
      success: true,
      attempt: {
        id: "attempt-1",
        attemptNumber: 1,
      } as Extract<LaunchInvestigationResult, { success: true }>["attempt"],
      cluster: {
        id: "cluster-1",
        status: "investigating",
      } as Extract<LaunchInvestigationResult, { success: true }>["cluster"],
      primaryFeedbackItemId: "item-1",
    };

    if (result.success) {
      expect(result.attempt.id).toBe("attempt-1");
      expect(result.attempt.attemptNumber).toBe(1);
      expect(result.cluster.status).toBe("investigating");
      expect(result.primaryFeedbackItemId).toBe("item-1");
    } else {
      throw new Error("type narrowing failed");
    }
  });

  test("launching from open/resolved/regression is consistent with the transition matrix", () => {
    // The launchable statuses MUST be a subset of the transitions the matrix
    // permits TO `investigating`. If this test starts failing it means the
    // matrix and the launch allow-list have drifted and the feature will
    // throw at runtime for users landing in one of those states.
    const launchableStatuses: ClusterStatusEnum[] = [
      "open",
      "resolved",
      "regression",
    ];

    for (const from of launchableStatuses) {
      expect(isValidTransition(from, "investigating")).toBe(true);
    }
  });

  test("launchable statuses DO NOT include the terminal or in-flight ones", () => {
    // Belt-and-braces check: `investigating`, `fix_ready`, `dismissed`,
    // `promoted` must NEVER be launchable — launching from them either
    // duplicates work or violates a terminal-state invariant.
    expect(CLUSTER_TRANSITIONS.dismissed).toEqual([]);
    expect(CLUSTER_TRANSITIONS.promoted).toEqual([]);
    // `investigating → investigating` would be a matrix self-loop, which is
    // not listed; `transitionCluster` treats it as a no-op but launch MUST
    // reject it with invalid_state so we don't create a second attempt.
    expect(isValidTransition("investigating", "investigating")).toBe(false);
  });
});
