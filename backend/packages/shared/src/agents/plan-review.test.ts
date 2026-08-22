import { describe, expect, it } from "bun:test";
import {
  buildSkippedPlanReviewResult,
  canonicalizePlanReviewPlan,
  containsSensitivePlanContent,
  createPlanReviewOpaqueReference,
  hashPlanReviewContent,
  normalizePlanReviewSnapshotForRunner,
  planReviewJobSnapshotSchema,
  planReviewPolicySchema,
  sanitizePlanReviewJobResult,
  validatePlanReviewOutput,
} from "./plan-review";

const plan = {
  projectId: "project-1",
  boardId: "board-1",
  boardColumnId: "column-1",
  items: [
    { tempId: "epic-1", type: "epic" as const, title: "Canonical epic", priority: "medium" as const },
    { tempId: "feature-1", type: "feature" as const, title: "Canonical feature", priority: "medium" as const, parentTempId: "epic-1" },
    { tempId: "story-1", type: "story" as const, title: "Canonical story", priority: "high" as const, parentTempId: "feature-1" },
    { tempId: "task-1", type: "task" as const, title: "Canonical task", priority: "urgent" as const, parentTempId: "story-1" },
  ],
  dependencies: [{ blockedTempId: "task-1", blockedByTempId: "story-1" }],
};

const readySnapshot = planReviewJobSnapshotSchema.parse({
  version: 2,
  intent: "plan-review",
  reviewJobId: "job-ready-1",
  enabled: true,
  originalPlan: canonicalizePlanReviewPlan(plan),
  requestedCriticCount: 2,
  maxRevisions: 1,
  critics: [],
  resolution: {
    status: "ready",
    degradation: { status: "none", reason: "Heterogeneous authorized critics are executable." },
  },
});

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
};

const buildRevisionOutput = (finalPlan: typeof plan) => {
  const content = canonicalJson(finalPlan);
  return {
    outputVersion: 1 as const,
    intent: "plan-review" as const,
    reviewJobId: readySnapshot.reviewJobId,
    originalPlanSha256: readySnapshot.originalPlan.sha256,
    finalPlan: { revisionId: "revision-1", content, sha256: hashPlanReviewContent(content) },
    findings: [],
    findingDecisions: [],
    outcome: "revise" as const,
    rationale: "revised plan",
    revisionCount: 1 as const,
  };
};

describe("v2 plan-review contract", () => {
  it("canonicalizes all Community work-item types and binds a SHA-256 digest", () => {
    const first = canonicalizePlanReviewPlan(plan);
    const second = canonicalizePlanReviewPlan({ ...plan, items: [...plan.items].reverse().reverse() });

    expect(first.content).toBe(second.content);
    expect(first.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.revisionId).toBe("original");
  });

  it("rejects duplicate tempIds before persistence", () => {
    expect(() => canonicalizePlanReviewPlan({
      ...plan,
      items: [...plan.items, { ...plan.items[0]! }],
    })).toThrow("unique tempId");
  });

  it("accepts only client policy fields", () => {
    expect(planReviewPolicySchema.parse({ enabled: false })).toEqual({ enabled: false });
    expect(() => planReviewPolicySchema.parse({ enabled: true })).toThrow();
    expect(() => planReviewPolicySchema.parse({ enabled: true, requestedCriticCount: 2, provider: "openai" })).toThrow();
  });

  it("rejects secret and connection material instead of attempting redaction", () => {
    expect(containsSensitivePlanContent("apiKey: should-not-persist")).toBe(true);
    expect(containsSensitivePlanContent("postgres://user:password@db.example/test")).toBe(true);
    expect(() => canonicalizePlanReviewPlan({
      ...plan,
      items: [{ ...plan.items[0]!, title: "authorization: bearer secret" }],
    })).toThrow("sensitive");
  });

  it("creates deterministic opaque, non-authorizing critic references", () => {
    const input = {
      workspaceId: "workspace-1",
      userId: "user-1",
      reviewJobId: "job-1",
      provider: "openai" as const,
      model: "gpt-5.6-sol",
      runtime: "codex" as const,
    };
    const reference = createPlanReviewOpaqueReference(input);
    expect(reference).toMatch(/^prc1\.[A-Za-z0-9_-]{43}$/);
    expect(createPlanReviewOpaqueReference(input)).toBe(reference);
    expect(createPlanReviewOpaqueReference({ ...input, reviewJobId: "job-2" })).not.toBe(reference);
  });

  it("normalizes legacy and malformed snapshots to an auditable skip", () => {
    expect(normalizePlanReviewSnapshotForRunner({ version: 1, enabled: true })).toEqual({
      status: "skipped_unavailable",
      reason: "legacy_or_invalid_plan_review_snapshot",
    });
    const invalidContent = JSON.stringify({ items: [], dependencies: [], projectId: "project-1", boardId: "board-1", boardColumnId: "column-1" });
    expect(normalizePlanReviewSnapshotForRunner({
      ...readySnapshot,
      originalPlan: {
        ...readySnapshot.originalPlan,
        content: invalidContent,
        sha256: hashPlanReviewContent(invalidContent),
      },
    })).toEqual({ status: "skipped_unavailable", reason: "legacy_or_invalid_plan_review_snapshot" });
  });

  it("validates a skipped result against the original plan and stores only the envelope", () => {
    const snapshot = planReviewJobSnapshotSchema.parse({
      ...readySnapshot,
      reviewJobId: "job-skipped-1",
      critics: [],
      resolution: {
        status: "skipped",
        degradation: { status: "skipped_unavailable", reason: "native fan-out unavailable" },
      },
    });
    const output = buildSkippedPlanReviewResult(snapshot.reviewJobId, snapshot, "native fan-out unavailable");
    expect(validatePlanReviewOutput(output, snapshot)).toEqual(output);
    const stored = sanitizePlanReviewJobResult({ secret: "must-not-persist" }, snapshot);
    expect(stored.output?.outcome).toBe("skipped_unavailable");
    expect(stored.storedResult).not.toHaveProperty("secret");
  });

  it("rejects duplicate tempIds in a revised final plan", () => {
    const duplicatePlan = { ...plan, items: [plan.items[0]!, { ...plan.items[0]! }] };
    const duplicateContent = JSON.stringify(duplicatePlan);
    expect(() => validatePlanReviewOutput({
      outputVersion: 1,
      intent: "plan-review",
      reviewJobId: readySnapshot.reviewJobId,
      originalPlanSha256: readySnapshot.originalPlan.sha256,
      finalPlan: { revisionId: "revision-1", content: duplicateContent, sha256: hashPlanReviewContent(duplicateContent) },
      findings: [],
      findingDecisions: [],
      outcome: "revise",
      rationale: "revised plan",
      revisionCount: 1,
    }, readySnapshot)).toThrow("unique tempId");
  });

  it("binds every revised final-plan target to the frozen target", () => {
    for (const target of ["projectId", "boardId", "boardColumnId"] as const) {
      expect(() => validatePlanReviewOutput(
        buildRevisionOutput({ ...plan, [target]: `drifted-${target}` }),
        readySnapshot,
      )).toThrow(`final plan ${target}`);
    }
  });

  it("rejects a revised item whose parent is missing from the same plan", () => {
    expect(() => validatePlanReviewOutput(buildRevisionOutput({
      ...plan,
      items: [{ ...plan.items[0]!, parentTempId: "missing-parent" }],
    }), readySnapshot)).toThrow("same plan");
  });

  it("rejects self-parent and cyclic parent references", () => {
    expect(() => validatePlanReviewOutput(buildRevisionOutput({
      ...plan,
      items: [{ ...plan.items[0]!, parentTempId: "epic-1" }],
    }), readySnapshot)).toThrow("own parent");

    expect(() => validatePlanReviewOutput(buildRevisionOutput({
      ...plan,
      items: [
        { ...plan.items[0]!, parentTempId: "feature-1" },
        { ...plan.items[1]!, parentTempId: "epic-1" },
      ],
    }), readySnapshot)).toThrow("cycles");
  });

  it("accepts a valid hierarchy with in-plan parent references", () => {
    const output = {
      outputVersion: 1 as const,
      intent: "plan-review" as const,
      reviewJobId: readySnapshot.reviewJobId,
      originalPlanSha256: readySnapshot.originalPlan.sha256,
      finalPlan: readySnapshot.originalPlan,
      findings: [],
      findingDecisions: [],
      outcome: "accept" as const,
      rationale: "valid hierarchy",
      revisionCount: 0 as const,
    };

    expect(validatePlanReviewOutput(output, readySnapshot)).toEqual(output);
  });
});
