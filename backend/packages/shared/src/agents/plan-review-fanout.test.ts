import { describe, expect, it } from "bun:test";
import {
  buildPlanReviewSynthesisInput,
  canonicalizePlanReviewPlan,
  createPlanReviewCapabilityRef,
  resolvePlanReviewCritics,
  resolvePlanReviewSynthesizer,
  validatePlanReviewCriticOutput,
  planReviewJobSnapshotSchema,
  planReviewJobSnapshotV3Schema,
} from "./plan-review";

const originalPlan = canonicalizePlanReviewPlan({
  projectId: "project-1",
  boardId: "board-1",
  boardColumnId: "column-1",
  items: [{ tempId: "task-1", type: "task", title: "Task 1", priority: "medium" }],
  dependencies: [],
});

const capabilityRef = (connectionId: string, provider: "anthropic" | "openai" | "zai") =>
  createPlanReviewCapabilityRef({
    workspaceId: "workspace-1",
    userId: "user-1",
    connectionId,
    provider,
  });

const candidates = [
  {
    connectionRef: capabilityRef("critic-a", "openai"),
    provider: "openai" as const,
    model: "gpt-5.6-sol",
    runtime: "opencode" as const,
    supportsIndependentCritics: true,
    maxIndependentCritics: 4,
  },
  {
    connectionRef: capabilityRef("critic-b", "anthropic"),
    provider: "anthropic" as const,
    model: "claude-opus-4-8",
    runtime: "opencode" as const,
    supportsIndependentCritics: true,
    maxIndependentCritics: 4,
  },
  {
    connectionRef: capabilityRef("critic-c", "zai"),
    provider: "zai" as const,
    model: "glm-5.3",
    runtime: "opencode" as const,
    supportsIndependentCritics: true,
    maxIndependentCritics: 4,
  },
];

describe("native Plan Review authority contract", () => {
  it("resolves only the exact active, unsuspended, authorized synthesizer model", () => {
    const selected = resolvePlanReviewSynthesizer({
      requestedConnectionRef: capabilityRef("synth", "openai"),
      requestedModel: "gpt-5.5",
      candidates: [
        {
          ...candidates[0]!,
          connectionRef: capabilityRef("synth", "openai"),
          isActive: true,
          suspendedAt: null,
        },
        {
          ...candidates[1]!,
          connectionRef: capabilityRef("suspended", "anthropic"),
          isActive: true,
          suspendedAt: new Date("2026-08-24T00:00:00.000Z"),
        },
      ],
    });

    expect(selected.synthesizer).toEqual({
      connectionRef: capabilityRef("synth", "openai"),
      provider: "openai",
      model: "gpt-5.5",
      runtime: "opencode",
    });
    expect(selected.synthesizer?.connectionRef).not.toBe("synth");
  });

  it("fails closed for an inactive, suspended, or unsupported selector", () => {
    for (const state of [
      { isActive: false, suspendedAt: null },
      { isActive: true, suspendedAt: new Date("2026-08-24T00:00:00.000Z") },
    ]) {
      expect(resolvePlanReviewSynthesizer({
        requestedConnectionRef: capabilityRef("synth", "openai"),
        requestedModel: "gpt-5.6-sol",
        candidates: [{
          ...candidates[0]!,
          connectionRef: capabilityRef("synth", "openai"),
          ...state,
        }],
      }).synthesizer).toBeNull();
    }

    expect(resolvePlanReviewSynthesizer({
      requestedConnectionRef: capabilityRef("synth", "openai"),
      requestedModel: "not-a-supported-model",
      candidates: [{
        ...candidates[0]!,
        connectionRef: capabilityRef("synth", "openai"),
        isActive: true,
        suspendedAt: null,
      }],
    }).synthesizer).toBeNull();
  });

  it("assigns distinct lenses and isolated OpenCode critics with quorum and count bounds", () => {
    const result = resolvePlanReviewCritics({
      workspaceId: "workspace-1",
      userId: "user-1",
      reviewJobId: "review-1",
      requestedCriticCount: 4,
      candidates: candidates.slice(0, 2),
    });

    expect(result.critics).toHaveLength(4);
    expect(result.critics.every((critic) => critic.runtime === "opencode")).toBe(true);
    expect(result.critics.every((critic) => critic.isolated)).toBe(true);
    expect(new Set(result.critics.map((critic) => critic.correlationRef)).size).toBe(4);
    expect(new Set(result.critics.map((critic) => critic.lens)).size).toBe(4);
    expect(result.resolution.degradation.status).toBe("none");
  });

  it("returns an auditable skip when fewer than two critics are executable", () => {
    const result = resolvePlanReviewCritics({
      workspaceId: "workspace-1",
      userId: "user-1",
      reviewJobId: "review-1",
      requestedCriticCount: 2,
      candidates: [{ ...candidates[0]!, maxIndependentCritics: 1 }],
    });

    expect(result.critics).toEqual([]);
    expect(result.resolution.status).toBe("skipped");
    expect(result.resolution.degradation.status).toBe("skipped_unavailable");
  });

  it("requires isolated critics and a dedicated synthesizer for runnable snapshots", () => {
    const critics = resolvePlanReviewCritics({
      workspaceId: "workspace-1",
      userId: "user-1",
      reviewJobId: "review-1",
      requestedCriticCount: 2,
      candidates,
    }).critics;
    const synthesizer = resolvePlanReviewSynthesizer({
      requestedConnectionRef: capabilityRef("synth", "openai"),
      requestedModel: "gpt-5.6-sol",
      candidates: [{
        ...candidates[0]!,
        connectionRef: capabilityRef("synth", "openai"),
        isActive: true,
        suspendedAt: null,
      }],
    }).synthesizer;

    expect(planReviewJobSnapshotSchema.parse({
      version: 2,
      intent: "plan-review",
      reviewJobId: "review-1",
      enabled: true,
      originalPlan,
      requestedCriticCount: 2,
      maxRevisions: 1,
      synthesizer,
      critics,
      resolution: {
        status: "ready",
        degradation: { status: "none", reason: "ready" },
      },
    }).critics).toHaveLength(2);
  });

  it("carries canonical Feature and Work Unit evidence through V3 synthesis", () => {
    const nativePlan: Parameters<typeof canonicalizePlanReviewPlan>[0] = {
      version: 1, kind: "plan", title: "Native plan",
      target: { projectId: "project-1", boardId: "board-1" }, features: [],
      workUnits: [{
        kind: "work_unit", tempId: "wu-1", title: "Unit", priority: "high",
        work_unit_size: "L", acceptance: ["Done."], dependencies: [],
      }],
    };
    const snapshot = planReviewJobSnapshotV3Schema.parse({
      version: 3, intent: "plan-review", reviewJobId: "review-v3", enabled: true,
      originalPlan: canonicalizePlanReviewPlan(nativePlan), requestedCriticCount: 2, maxRevisions: 1,
      synthesizer: { connectionRef: capabilityRef("synth", "zai"), provider: "zai", model: "glm-5.3", runtime: "opencode" },
      critics: resolvePlanReviewCritics({ workspaceId: "workspace-1", userId: "user-1", reviewJobId: "review-v3", requestedCriticCount: 2, candidates }).critics,
      resolution: { status: "ready", degradation: { status: "none", reason: "ready" } },
    });
    const input = buildPlanReviewSynthesisInput(snapshot, []);

    expect(input).toContain("\\\"kind\\\":\\\"work_unit\\\"");
    expect(input).not.toContain("estimatedPoints");
  });

  it("binds critic output to its server-assigned correlation and lens", () => {
    const critics = resolvePlanReviewCritics({
      workspaceId: "workspace-1",
      userId: "user-1",
      reviewJobId: "review-1",
      requestedCriticCount: 2,
      candidates,
    }).critics;
    const snapshot = planReviewJobSnapshotSchema.parse({
      version: 2,
      intent: "plan-review",
      reviewJobId: "review-1",
      enabled: true,
      originalPlan,
      requestedCriticCount: 2,
      maxRevisions: 1,
      synthesizer: {
        connectionRef: capabilityRef("synth", "zai"),
        provider: "zai",
        model: "glm-5.3",
        runtime: "opencode",
      },
      critics,
      resolution: {
        status: "ready",
        degradation: { status: "none", reason: "ready" },
      },
    });
    const valid = {
      outputVersion: 1,
      intent: "plan-review-critic",
      reviewJobId: "review-1",
      criticRef: critics[0]!.correlationRef,
      originalPlanSha256: originalPlan.sha256,
      findings: [],
      outcome: "completed",
      rationale: "No material issue found.",
    } as const;

    expect(validatePlanReviewCriticOutput(valid, snapshot, critics[0]!)).toEqual(valid);
    expect(() => validatePlanReviewCriticOutput({ ...valid, criticRef: critics[1]!.correlationRef }, snapshot, critics[0]!)).toThrow();
  });

  it("keeps synthesis input canonical and free of capability or secret material", () => {
    const critics = resolvePlanReviewCritics({
      workspaceId: "workspace-1",
      userId: "user-1",
      reviewJobId: "review-1",
      requestedCriticCount: 2,
      candidates,
    }).critics;
    const snapshot = planReviewJobSnapshotSchema.parse({
      version: 2,
      intent: "plan-review",
      reviewJobId: "review-1",
      enabled: true,
      originalPlan,
      requestedCriticCount: 2,
      maxRevisions: 1,
      synthesizer: {
        connectionRef: capabilityRef("synth", "openai"),
        provider: "openai",
        model: "gpt-5.6-sol",
        runtime: "opencode",
      },
      critics,
      resolution: {
        status: "ready",
        degradation: { status: "none", reason: "ready" },
      },
    });
    const input = buildPlanReviewSynthesisInput(snapshot, critics.map((critic) => ({
      outputVersion: 1 as const,
      intent: "plan-review-critic" as const,
      reviewJobId: snapshot.reviewJobId,
      criticRef: critic.correlationRef,
      originalPlanSha256: originalPlan.sha256,
      findings: [],
      outcome: "completed" as const,
      rationale: "Safe evidence.",
    })));

    expect(input).toContain(originalPlan.sha256);
    expect(input).not.toContain(snapshot.synthesizer!.connectionRef);
    expect(input).not.toContain("apiKey");
    expect(() => buildPlanReviewSynthesisInput(snapshot, [{
      outputVersion: 1,
      intent: "plan-review-critic",
      reviewJobId: snapshot.reviewJobId,
      criticRef: critics[0]!.correlationRef,
      originalPlanSha256: originalPlan.sha256,
      findings: [],
      outcome: "completed",
      rationale: "apiKey: secret-value",
    }])).toThrow("sensitive");
  });
});
