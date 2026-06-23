import { describe, test, expect } from "bun:test";
import { buildClusterTimeline } from "./cluster-timeline-builder";
import type { ClusterStatusHistory } from "../schema";
import type { BugFixAttemptWithPr } from "../repositories/agents/bug-fix-attempt-repository";
import type { FeedbackClusterDetailItem } from "../repositories/feedback/feedback-cluster-repository";

// ──────────────────────────────────────────────
// Fixture builders
// ──────────────────────────────────────────────

const makeItem = (
  overrides: Partial<FeedbackClusterDetailItem> = {},
): FeedbackClusterDetailItem => ({
  id: overrides.id ?? "item-1",
  title: overrides.title ?? "Ticket A",
  content: overrides.content ?? null,
  authorName: overrides.authorName ?? null,
  status: overrides.status ?? "open",
  aiCategory: overrides.aiCategory ?? null,
  createdAt: overrides.createdAt ?? new Date("2025-01-01T00:00:00.000Z"),
  metadata: overrides.metadata ?? null,
  debugBundleId: overrides.debugBundleId ?? null,
  ticketNumber: overrides.ticketNumber ?? null,
  author: overrides.author ?? {
    userId: null,
    name: null,
    email: null,
    avatarUrl: null,
    isAnonymous: true,
  },
});

const makeStatusRow = (
  overrides: Partial<ClusterStatusHistory> = {},
): ClusterStatusHistory => ({
  id: overrides.id ?? "sh-1",
  clusterId: overrides.clusterId ?? "cluster-1",
  fromStatus: overrides.fromStatus ?? null,
  toStatus: overrides.toStatus ?? "open",
  triggeredByKind: overrides.triggeredByKind ?? "system",
  triggeredByUserId: overrides.triggeredByUserId ?? null,
  triggeredByAttemptId: overrides.triggeredByAttemptId ?? null,
  triggeredByAgentJobId: overrides.triggeredByAgentJobId ?? null,
  reason: overrides.reason ?? null,
  metadata: overrides.metadata ?? {},
  changedAt: overrides.changedAt ?? new Date("2025-01-02T00:00:00.000Z"),
});

const makeAttempt = (
  overrides: Partial<BugFixAttemptWithPr> = {},
): BugFixAttemptWithPr => ({
  id: overrides.id ?? "att-1",
  feedbackItemId: overrides.feedbackItemId ?? null,
  clusterId: overrides.clusterId ?? "cluster-1",
  projectId: overrides.projectId ?? "proj-1",
  organizationId: overrides.organizationId ?? "org-1",
  agentJobId: overrides.agentJobId ?? null,
  domain: overrides.domain ?? null,
  rootCause: overrides.rootCause ?? null,
  solutionProposed: overrides.solutionProposed ?? null,
  filesAffected: overrides.filesAffected ?? null,
  fixBranch: overrides.fixBranch ?? null,
  fixPrUrl: overrides.fixPrUrl ?? null,
  fixPrNumber: overrides.fixPrNumber ?? null,
  status: overrides.status ?? "analyzing",
  attemptNumber: overrides.attemptNumber ?? 1,
  failureReason: overrides.failureReason ?? null,
  failureDetectedBy: overrides.failureDetectedBy ?? null,
  metadata: overrides.metadata ?? {},
  createdAt: overrides.createdAt ?? new Date("2025-01-03T00:00:00.000Z"),
  updatedAt: overrides.updatedAt ?? new Date("2025-01-03T00:00:00.000Z"),
  pr: overrides.pr === undefined ? null : overrides.pr,
});

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe("buildClusterTimeline", () => {
  test("returns an empty array when all inputs are empty", () => {
    const result = buildClusterTimeline({
      items: [],
      attempts: [],
      statusHistory: [],
    });
    expect(result).toEqual([]);
  });

  test("emits one ticket_created per item, sorted ascending", () => {
    const items: FeedbackClusterDetailItem[] = [
      makeItem({
        id: "item-2",
        title: "Second",
        createdAt: new Date("2025-02-02T00:00:00.000Z"),
      }),
      makeItem({
        id: "item-1",
        title: "First",
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
      }),
      makeItem({
        id: "item-3",
        title: "Third",
        createdAt: new Date("2025-03-03T00:00:00.000Z"),
      }),
    ];

    const result = buildClusterTimeline({
      items,
      attempts: [],
      statusHistory: [],
    });

    expect(result).toHaveLength(3);
    expect(result.every((e) => e.kind === "ticket_created")).toBe(true);
    expect(result.map((e) => e.at)).toEqual([
      "2025-01-01T00:00:00.000Z",
      "2025-02-02T00:00:00.000Z",
      "2025-03-03T00:00:00.000Z",
    ]);
    const first = result[0];
    if (first?.kind !== "ticket_created") throw new Error("unreachable");
    expect(first.ticketId).toBe("item-1");
    expect(first.ticketTitle).toBe("First");
  });

  test("prefers author.name / author.userId when present", () => {
    const item = makeItem({
      authorName: "fallback",
      author: {
        userId: "user-42",
        name: "Ada Lovelace",
        email: "ada@example.com",
        avatarUrl: null,
        isAnonymous: false,
      },
    });

    const [event] = buildClusterTimeline({
      items: [item],
      attempts: [],
      statusHistory: [],
    });

    if (event?.kind !== "ticket_created") throw new Error("unreachable");
    expect(event.authorName).toBe("Ada Lovelace");
    expect(event.authorUserId).toBe("user-42");
  });

  test("emits tickets and non-regression status transitions together", () => {
    const items = [
      makeItem({
        id: "item-1",
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
      }),
    ];
    const statusHistory = [
      makeStatusRow({
        id: "sh-1",
        fromStatus: null,
        toStatus: "open",
        changedAt: new Date("2025-01-02T00:00:00.000Z"),
        triggeredByKind: "system",
      }),
      makeStatusRow({
        id: "sh-2",
        fromStatus: "open",
        toStatus: "investigating",
        changedAt: new Date("2025-01-03T00:00:00.000Z"),
        triggeredByKind: "agent",
        reason: "auto_triage",
      }),
    ];

    const result = buildClusterTimeline({
      items,
      attempts: [],
      statusHistory,
    });

    expect(result.map((e) => e.kind)).toEqual([
      "ticket_created",
      "status_transition",
      "status_transition",
    ]);
    const second = result[1];
    if (second?.kind !== "status_transition") throw new Error("unreachable");
    expect(second.fromStatus).toBeNull();
    expect(second.toStatus).toBe("open");
    expect(second.triggeredByKind).toBe("system");

    const third = result[2];
    if (third?.kind !== "status_transition") throw new Error("unreachable");
    expect(third.fromStatus).toBe("open");
    expect(third.toStatus).toBe("investigating");
    expect(third.reason).toBe("auto_triage");
  });

  test("emits regression_detected (NOT status_transition) for regression rows", () => {
    const statusHistory = [
      makeStatusRow({
        id: "sh-regression",
        fromStatus: "resolved",
        toStatus: "regression",
        changedAt: new Date("2025-04-01T00:00:00.000Z"),
        metadata: {
          newItemIds: ["item-new-1", "item-new-2"],
          previousAttemptIds: ["att-prev-1"],
        },
      }),
    ];

    const result = buildClusterTimeline({
      items: [],
      attempts: [],
      statusHistory,
    });

    expect(result).toHaveLength(1);
    const event = result[0];
    if (event?.kind !== "regression_detected") throw new Error("unreachable");
    expect(event.at).toBe("2025-04-01T00:00:00.000Z");
    expect(event.newItemIds).toEqual(["item-new-1", "item-new-2"]);
    expect(event.previousAttemptIds).toEqual(["att-prev-1"]);
  });

  test("regression row with missing/malformed metadata defaults to empty id arrays", () => {
    const statusHistory = [
      makeStatusRow({
        id: "sh-regression-a",
        toStatus: "regression",
        changedAt: new Date("2025-05-01T00:00:00.000Z"),
        metadata: null,
      }),
      makeStatusRow({
        id: "sh-regression-b",
        toStatus: "regression",
        changedAt: new Date("2025-05-02T00:00:00.000Z"),
        metadata: { newItemIds: "not-an-array", previousAttemptIds: 42 },
      }),
      makeStatusRow({
        id: "sh-regression-c",
        toStatus: "regression",
        changedAt: new Date("2025-05-03T00:00:00.000Z"),
        metadata: {
          newItemIds: ["a", 5, null, "b"],
          previousAttemptIds: [],
        },
      }),
    ];

    const result = buildClusterTimeline({
      items: [],
      attempts: [],
      statusHistory,
    });

    expect(result).toHaveLength(3);
    for (const e of result) {
      expect(e.kind).toBe("regression_detected");
    }
    const a = result[0];
    const b = result[1];
    const c = result[2];
    if (a?.kind !== "regression_detected") throw new Error("unreachable");
    if (b?.kind !== "regression_detected") throw new Error("unreachable");
    if (c?.kind !== "regression_detected") throw new Error("unreachable");
    expect(a.newItemIds).toEqual([]);
    expect(a.previousAttemptIds).toEqual([]);
    expect(b.newItemIds).toEqual([]);
    expect(b.previousAttemptIds).toEqual([]);
    // Non-string entries filtered; strings preserved.
    expect(c.newItemIds).toEqual(["a", "b"]);
    expect(c.previousAttemptIds).toEqual([]);
  });

  test("attempt with open+merged PR emits attempt_launched, pr_opened, pr_merged", () => {
    const attempts: BugFixAttemptWithPr[] = [
      makeAttempt({
        id: "att-9",
        attemptNumber: 2,
        status: "merged",
        createdAt: new Date("2025-06-01T00:00:00.000Z"),
        fixPrUrl: "https://github.com/acme/app/pull/42",
        fixPrNumber: 42,
        pr: {
          state: "merged",
          reviewStatus: "approved",
          ciStatus: "success",
          mergedAt: new Date("2025-06-02T00:00:00.000Z"),
          closedAt: new Date("2025-06-02T00:00:00.000Z"),
        },
      }),
    ];

    const result = buildClusterTimeline({
      items: [],
      attempts,
      statusHistory: [],
    });

    expect(result.map((e) => e.kind)).toEqual([
      "attempt_launched",
      "pr_opened",
      "pr_merged",
    ]);

    const launched = result[0];
    const opened = result[1];
    const merged = result[2];

    if (launched?.kind !== "attempt_launched") throw new Error("unreachable");
    expect(launched.attemptId).toBe("att-9");
    expect(launched.attemptNumber).toBe(2);
    expect(launched.status).toBe("merged");
    expect(launched.at).toBe("2025-06-01T00:00:00.000Z");

    if (opened?.kind !== "pr_opened") throw new Error("unreachable");
    // Falls back to attempt.createdAt since pr.openedAt is not present.
    expect(opened.at).toBe("2025-06-01T00:00:00.000Z");
    expect(opened.attemptId).toBe("att-9");
    expect(opened.prUrl).toBe("https://github.com/acme/app/pull/42");
    expect(opened.prNumber).toBe(42);

    if (merged?.kind !== "pr_merged") throw new Error("unreachable");
    expect(merged.at).toBe("2025-06-02T00:00:00.000Z");
    expect(merged.attemptId).toBe("att-9");
    expect(merged.prUrl).toBe("https://github.com/acme/app/pull/42");
  });

  test("attempt with pr=null emits only attempt_launched", () => {
    const attempts = [
      makeAttempt({
        id: "att-lonely",
        createdAt: new Date("2025-07-01T00:00:00.000Z"),
        pr: null,
      }),
    ];

    const result = buildClusterTimeline({
      items: [],
      attempts,
      statusHistory: [],
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe("attempt_launched");
  });

  test("attempt with pr set but no mergedAt does not emit pr_merged", () => {
    const attempts = [
      makeAttempt({
        id: "att-open",
        createdAt: new Date("2025-08-01T00:00:00.000Z"),
        fixPrUrl: "https://github.com/acme/app/pull/7",
        fixPrNumber: 7,
        pr: {
          state: "open",
          reviewStatus: "pending",
          ciStatus: "pending",
          mergedAt: null,
          closedAt: null,
        },
      }),
    ];

    const result = buildClusterTimeline({
      items: [],
      attempts,
      statusHistory: [],
    });

    expect(result.map((e) => e.kind)).toEqual([
      "attempt_launched",
      "pr_opened",
    ]);
  });

  test("mixed chronology: final array is globally sorted ascending across kinds", () => {
    const items = [
      makeItem({
        id: "item-1",
        createdAt: new Date("2025-09-01T10:00:00.000Z"),
      }),
      makeItem({
        id: "item-2",
        createdAt: new Date("2025-09-04T10:00:00.000Z"),
      }),
    ];
    const statusHistory = [
      makeStatusRow({
        id: "sh-init",
        fromStatus: null,
        toStatus: "open",
        changedAt: new Date("2025-09-01T10:05:00.000Z"),
      }),
      makeStatusRow({
        id: "sh-regress",
        fromStatus: "resolved",
        toStatus: "regression",
        changedAt: new Date("2025-09-05T12:00:00.000Z"),
        metadata: {
          newItemIds: ["item-2"],
          previousAttemptIds: ["att-1"],
        },
      }),
    ];
    const attempts = [
      makeAttempt({
        id: "att-1",
        attemptNumber: 1,
        createdAt: new Date("2025-09-02T09:00:00.000Z"),
        fixPrUrl: "https://github.com/acme/app/pull/1",
        fixPrNumber: 1,
        pr: {
          state: "merged",
          reviewStatus: "approved",
          ciStatus: "success",
          mergedAt: new Date("2025-09-03T15:00:00.000Z"),
          closedAt: new Date("2025-09-03T15:00:00.000Z"),
        },
      }),
    ];

    const result = buildClusterTimeline({ items, attempts, statusHistory });

    // Sorted ascending by `at`.
    const timestamps = result.map((e) => e.at);
    const sortedCopy = [...timestamps].sort();
    expect(timestamps).toEqual(sortedCopy);

    // Expected kind sequence mirrors the chronological layout.
    expect(result.map((e) => e.kind)).toEqual([
      "ticket_created", // 2025-09-01 10:00
      "status_transition", // 2025-09-01 10:05
      "attempt_launched", // 2025-09-02 09:00
      "pr_opened", // 2025-09-02 09:00 (fallback == createdAt)
      "pr_merged", // 2025-09-03 15:00
      "ticket_created", // 2025-09-04 10:00
      "regression_detected", // 2025-09-05 12:00
    ]);

    const regression = result[result.length - 1];
    if (regression?.kind !== "regression_detected") {
      throw new Error("unreachable");
    }
    expect(regression.newItemIds).toEqual(["item-2"]);
    expect(regression.previousAttemptIds).toEqual(["att-1"]);
  });

  test("does not emit ticket_burst (frontend-only variant)", () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      makeItem({
        id: `item-${i}`,
        createdAt: new Date(`2025-10-01T10:00:0${i}.000Z`),
      }),
    );

    const result = buildClusterTimeline({
      items,
      attempts: [],
      statusHistory: [],
    });

    expect(result.every((e) => e.kind !== "ticket_burst")).toBe(true);
  });
});
