import { describe, expect, test } from "bun:test";
import { selectBacklogDrainCandidates, type BacklogDrainWorkItemInput } from "./backlog-drain-selection";

const item = (overrides: Partial<BacklogDrainWorkItemInput> & Pick<BacklogDrainWorkItemInput, "id" | "projectId">): BacklogDrainWorkItemInput => ({
  id: overrides.id,
  projectId: overrides.projectId,
  taskId: overrides.taskId ?? overrides.id,
  title: overrides.title ?? overrides.id,
  type: overrides.type ?? "task",
  parentId: overrides.parentId ?? null,
  boardId: overrides.boardId ?? "board-1",
  position: overrides.position ?? 0,
  columnRole: overrides.columnRole ?? "backlog",
  columnIsDone: overrides.columnIsDone ?? false,
  columnOrder: overrides.columnOrder ?? 0,
  updatedAt: overrides.updatedAt ?? new Date("2026-04-26T21:00:00.000Z"),
  codingAgent: overrides.codingAgent ?? null,
  aiModel: overrides.aiModel ?? null,
  metadata: overrides.metadata ?? null,
  dodRemediationAttemptCount: overrides.dodRemediationAttemptCount ?? null,
});

describe("selectBacklogDrainCandidates", () => {
  test("excludes a work item and all descendants by default", () => {
    const workItems = [
      item({ id: "FF1", projectId: "p1", type: "feature", columnRole: null, position: 1 }),
      item({ id: "FF2", projectId: "p1", type: "feature", columnRole: null, position: 2 }),
      item({ id: "FF2-T1", projectId: "p1", parentId: "FF2" }),
      item({ id: "FF4", projectId: "p1", type: "feature", columnRole: null, position: 4 }),
      item({ id: "FF4-T1", projectId: "p1", parentId: "FF4" }),
    ];

    const result = selectBacklogDrainCandidates({
      rules: [{ projectId: "p1", maxConcurrentJobs: 10, excludedWorkItemIds: ["FF2"] }],
      workItems,
      dependencies: [],
      activeJobs: [],
    });

    expect(result.candidates.map((candidate) => candidate.id)).toEqual(["FF1", "FF4"]);
    expect(result.skipped.excluded).toContain("FF2");
    expect(result.skipped.excluded).toContain("FF2-T1");
  });

  test("skips blocked items but still fills concurrency with ready work", () => {
    const workItems = [
      item({ id: "FF1", projectId: "p1", type: "feature", columnRole: null, position: 1 }),
      item({ id: "FF2", projectId: "p1", type: "feature", columnRole: null, position: 2 }),
      item({ id: "FF3", projectId: "p1", type: "feature", columnRole: null, position: 3 }),
      item({ id: "FF4", projectId: "p1", type: "feature", columnRole: null, position: 4 }),
    ];

    const result = selectBacklogDrainCandidates({
      rules: [{ projectId: "p1", maxConcurrentJobs: 2 }],
      workItems,
      dependencies: [
        { workItemId: "FF2", blockedByWorkItemId: "FF1" },
        { workItemId: "FF3", blockedByWorkItemId: "FF1" },
      ],
      activeJobs: [],
    });

    expect(result.candidates.map((candidate) => candidate.id)).toEqual(["FF1", "FF4"]);
    expect(result.skipped.blocked).toEqual([
      { workItemId: "FF2", blockedBy: ["FF1"] },
      { workItemId: "FF3", blockedBy: ["FF1"] },
    ]);
  });

  test("waits for a backlog block to be stable before selecting it", () => {
    const workItems = [
      item({
        id: "F1",
        projectId: "p1",
        type: "feature",
        columnRole: null,
        position: 1,
        updatedAt: new Date("2026-04-26T21:30:00.000Z"),
      }),
      item({
        id: "T1",
        projectId: "p1",
        parentId: "F1",
        position: 1,
        updatedAt: new Date("2026-04-26T21:55:00.000Z"),
      }),
      item({
        id: "F2",
        projectId: "p1",
        type: "feature",
        columnRole: null,
        position: 2,
        updatedAt: new Date("2026-04-26T21:30:00.000Z"),
      }),
    ];

    const result = selectBacklogDrainCandidates({
      rules: [{ projectId: "p1", maxConcurrentJobs: 2 }],
      workItems,
      dependencies: [],
      activeJobs: [],
      now: new Date("2026-04-26T22:00:00.000Z"),
    });

    expect(result.candidates.map((candidate) => candidate.id)).toEqual(["F2"]);
    expect(result.skipped.recentlyModified).toEqual([
      { workItemId: "F1", lastModifiedAt: "2026-04-26T21:55:00.000Z" },
    ]);
  });

  test("allows disabling the backlog quiet period with a zero stabilization window", () => {
    const workItems = [
      item({
        id: "F1",
        projectId: "p1",
        type: "feature",
        columnRole: null,
        position: 1,
        updatedAt: new Date("2026-04-26T21:59:00.000Z"),
      }),
    ];

    const result = selectBacklogDrainCandidates({
      rules: [{ projectId: "p1", maxConcurrentJobs: 2 }],
      workItems,
      dependencies: [],
      activeJobs: [],
      now: new Date("2026-04-26T22:00:00.000Z"),
      stabilizationWindowMs: 0,
    });

    expect(result.candidates.map((candidate) => candidate.id)).toEqual(["F1"]);
    expect(result.skipped.recentlyModified).toEqual([]);
  });

  test("selects the highest ready ancestor instead of child tasks", () => {
    const workItems = [
      item({ id: "F1", projectId: "p1", type: "feature", columnRole: null, position: 1 }),
      item({ id: "T1", projectId: "p1", parentId: "F1", position: 1 }),
      item({ id: "T2", projectId: "p1", parentId: "F1", position: 2 }),
    ];

    const result = selectBacklogDrainCandidates({
      rules: [{ projectId: "p1", maxConcurrentJobs: 5 }],
      workItems,
      dependencies: [],
      activeJobs: [],
    });

    expect(result.candidates.map((candidate) => candidate.id)).toEqual(["F1"]);
  });

  test("respects project concurrency and active jobs", () => {
    const workItems = [
      item({ id: "F1", projectId: "p1", type: "feature", columnRole: null, position: 1 }),
      item({ id: "F2", projectId: "p1", type: "feature", columnRole: null, position: 2 }),
    ];

    const result = selectBacklogDrainCandidates({
      rules: [{ projectId: "p1", maxConcurrentJobs: 2 }],
      workItems,
      dependencies: [],
      activeJobs: [{ projectId: "p1", workItemId: "existing" }],
    });

    expect(result.candidates.map((candidate) => candidate.id)).toEqual(["F1"]);
  });

  test("uses rule runtime before project defaults and fallback runtime", () => {
    const result = selectBacklogDrainCandidates({
      rules: [{ projectId: "p1", maxConcurrentJobs: 1, codingAgent: "opencode", model: "glm-5.1", reasoningLevel: "disabled" }],
      projects: [{ id: "p1", agentDefaults: { implementation: { codingAgent: "claude-code", model: "claude-opus-4-7", reasoningLevel: "high" } } }],
      fallbackRuntime: { codingAgent: "codex", model: "gpt-5.5", reasoningLevel: "xhigh" },
      workItems: [item({ id: "F1", projectId: "p1", type: "feature", columnRole: null })],
      dependencies: [],
      activeJobs: [],
    });

    expect(result.candidates[0]).toMatchObject({
      codingAgent: "opencode",
      aiProvider: "zai",
      provider: "zipu",
      model: "glm-5.1",
      reasoningLevel: "disabled",
    });
  });

  test("uses scheduled agent runtime before work item and project defaults", () => {
    const result = selectBacklogDrainCandidates({
      rules: [{ projectId: "p1", maxConcurrentJobs: 1 }],
      projects: [
        {
          id: "p1",
          agentDefaults: {
            implementation: {
              codingAgent: "claude-code",
              aiProvider: "anthropic",
              model: "claude-opus-4-7",
              reasoningLevel: "high",
            },
          },
        },
      ],
      fallbackRuntime: {
        provider: "zipu",
        codingAgent: "claude-code",
        aiProvider: "zai",
        model: "glm-5.1",
        reasoningLevel: "max",
      },
      workItems: [
        item({
          id: "F1",
          projectId: "p1",
          type: "feature",
          columnRole: null,
          codingAgent: "claude-code",
          aiModel: "claude-sonnet-4-5",
        }),
      ],
      dependencies: [],
      activeJobs: [],
    });

    expect(result.candidates[0]).toMatchObject({
      codingAgent: "claude-code",
      aiProvider: "zai",
      provider: "zipu",
      model: "glm-5.1",
      reasoningLevel: "max",
    });
  });

  test("repairs stale scheduled provider from the selected AI provider", () => {
    const result = selectBacklogDrainCandidates({
      mode: "dod-remediation",
      rules: [{ projectId: "p1", maxConcurrentJobs: 1 }],
      fallbackRuntime: {
        provider: "codex",
        codingAgent: "opencode",
        aiProvider: "zai",
        model: "glm-5.1",
        reasoningLevel: "max",
      },
      workItems: [
        item({
          id: "dod-ready",
          projectId: "p1",
          metadata: {
            dod_incompleted: true,
            dod_report: "Missing redirect from /legacy to /new.",
          },
        }),
      ],
      dependencies: [],
      activeJobs: [],
    });

    expect(result.candidates[0]).toMatchObject({
      codingAgent: "opencode",
      aiProvider: "zai",
      provider: "zipu",
      model: "glm-5.1",
      skillName: "runner-fix-dod",
    });
  });

  test("uses fallback reasoning level when rule and project defaults do not define one", () => {
    const result = selectBacklogDrainCandidates({
      rules: [{ projectId: "p1", maxConcurrentJobs: 1, codingAgent: "codex" }],
      projects: [{ id: "p1", agentDefaults: { implementation: { model: "gpt-5.5" } } }],
      fallbackRuntime: { reasoningLevel: "xhigh" },
      workItems: [item({ id: "F1", projectId: "p1", type: "feature", columnRole: null })],
      dependencies: [],
      activeJobs: [],
    });

    expect(result.candidates[0]).toMatchObject({
      codingAgent: "codex",
      aiProvider: "openai",
      provider: "codex",
      model: "gpt-5.5",
      reasoningLevel: "xhigh",
    });
  });

  test("derives provider from project default runtime when scheduled automation has no direct coding agent", () => {
    const result = selectBacklogDrainCandidates({
      rules: [{ projectId: "p1", maxConcurrentJobs: 1 }],
      projects: [{ id: "p1", agentDefaults: { implementation: { codingAgent: "codex", model: "gpt-5.5" } } }],
      fallbackRuntime: { provider: "claude-code" },
      workItems: [item({ id: "F1", projectId: "p1", type: "feature", columnRole: null })],
      dependencies: [],
      activeJobs: [],
    });

    expect(result.candidates[0]).toMatchObject({
      codingAgent: "codex",
      provider: "codex",
      model: "gpt-5.5",
    });
  });

  test("derives Grok provider when project defaults use Codex with xAI", () => {
    const result = selectBacklogDrainCandidates({
      rules: [{ projectId: "p1", maxConcurrentJobs: 1 }],
      projects: [{
        id: "p1",
        agentDefaults: {
          implementation: {
            codingAgent: "codex",
            aiProvider: "xai",
          },
        },
      }],
      workItems: [item({ id: "F1", projectId: "p1", type: "feature", columnRole: null })],
      dependencies: [],
      activeJobs: [],
    });

    expect(result.candidates[0]).toMatchObject({
      codingAgent: "codex",
      aiProvider: "xai",
      provider: "grok",
      model: "grok-4.20-reasoning",
    });
  });

  test("normal backlog drain excludes DoD-incomplete items and ancestors", () => {
    const workItems = [
      item({ id: "F1", projectId: "p1", type: "feature", columnRole: null, position: 1 }),
      item({
        id: "F1-T1",
        projectId: "p1",
        parentId: "F1",
        metadata: {
          dod_incompleted: true,
          dod_report: "Legacy routes still render UI instead of redirects.",
        },
      }),
      item({ id: "F2", projectId: "p1", type: "feature", columnRole: null, position: 2 }),
    ];

    const result = selectBacklogDrainCandidates({
      rules: [{ projectId: "p1", maxConcurrentJobs: 10 }],
      workItems,
      dependencies: [],
      activeJobs: [],
    });

    expect(result.candidates.map((candidate) => candidate.id)).toEqual(["F2"]);
    expect(result.skipped.dodIncomplete).toContain("F1");
    expect(result.skipped.dodIncomplete).toContain("F1-T1");
  });

  test("DoD remediation mode only selects DoD-incomplete items with a report", () => {
    const result = selectBacklogDrainCandidates({
      mode: "dod-remediation",
      rules: [{ projectId: "p1", maxConcurrentJobs: 10 }],
      workItems: [
        item({ id: "normal", projectId: "p1", position: 1 }),
        item({
          id: "dod-ready",
          projectId: "p1",
          position: 2,
          metadata: {
            dod_incompleted: true,
            dod_report: "Missing redirect from /legacy to /new.",
            dod_reviewed_at: "2026-05-02T18:00:00.000Z",
          },
        }),
        item({
          id: "dod-without-report",
          projectId: "p1",
          position: 3,
          metadata: {
            dod_incompleted: true,
          },
        }),
      ],
      dependencies: [],
      activeJobs: [],
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      id: "dod-ready",
      skillName: "runner-fix-dod",
      dodReport: "Missing redirect from /legacy to /new.",
      dodReviewedAt: "2026-05-02T18:00:00.000Z",
    });
    expect(result.skipped.notDodRemediation).toContain("normal");
    expect(result.skipped.missingDodReport).toContain("dod-without-report");
  });

  test("DoD remediation mode leaves items with more than 3 DoD failures for human review", () => {
    const result = selectBacklogDrainCandidates({
      mode: "dod-remediation",
      rules: [{ projectId: "p1", maxConcurrentJobs: 10 }],
      workItems: [
        item({
          id: "needs-human-review",
          projectId: "p1",
          metadata: {
            dod_incompleted: true,
            dod_report: "Same missing redirect after repeated remediation attempts.",
            dod_incompleted_count: 4,
          },
        }),
      ],
      dependencies: [],
      activeJobs: [],
    });

    expect(result.candidates).toEqual([]);
    expect(result.skipped.humanReviewRequired).toContain("needs-human-review");
  });

  test("DoD remediation mode escalates after more than 3 real remediation attempts", () => {
    const result = selectBacklogDrainCandidates({
      mode: "dod-remediation",
      rules: [{ projectId: "p1", maxConcurrentJobs: 10 }],
      workItems: [
        item({
          id: "looping-remediation",
          projectId: "p1",
          dodRemediationAttemptCount: 4,
          metadata: {
            dod_incompleted: true,
            dod_report: "Same SEO metadata failure after repeated runner-fix-dod jobs.",
            dod_incompleted_count: 1,
          },
        }),
      ],
      dependencies: [],
      activeJobs: [],
    });

    expect(result.candidates).toEqual([]);
    expect(result.skipped.humanReviewRequired).toContain("looping-remediation");
  });

  test("DoD remediation mode parks the whole block when a child needs human intervention", () => {
    const workItems = [
      item({
        id: "FE16",
        projectId: "p1",
        type: "feature",
        columnRole: null,
        position: 1,
        metadata: {
          dod_incompleted: true,
          dod_report: "QA verification block still has incomplete child tasks.",
        },
      }),
      item({
        id: "FE16-T1",
        projectId: "p1",
        parentId: "FE16",
        position: 1,
        metadata: {
          dod_incompleted: true,
          dod_report: "Needs external QA validator.",
          dod_human_action_required: true,
          dod_auto_remediation_blocked: true,
        },
      }),
      item({
        id: "FE16-T2",
        projectId: "p1",
        parentId: "FE16",
        position: 2,
        metadata: {
          dod_incompleted: true,
          dod_report: "Fix an auto-remediable assertion.",
        },
      }),
    ];

    const result = selectBacklogDrainCandidates({
      mode: "dod-remediation",
      rules: [{ projectId: "p1", maxConcurrentJobs: 10 }],
      workItems,
      dependencies: [],
      activeJobs: [],
    });

    expect(result.candidates).toEqual([]);
    expect(result.skipped.humanReviewRequired).toEqual(expect.arrayContaining(["FE16", "FE16-T1", "FE16-T2"]));
  });

  test("DoD remediation mode treats external validator requirements as human intervention", () => {
    const result = selectBacklogDrainCandidates({
      mode: "dod-remediation",
      rules: [{ projectId: "p1", maxConcurrentJobs: 10 }],
      workItems: [
        item({
          id: "external-validator",
          projectId: "p1",
          metadata: {
            dod_incompleted: true,
            dod_report: "Schema.org rich result must be checked in Google's external validator.",
            dod_external_validation_required: true,
            dod_external_validation_tools: ["Google Rich Results Test"],
          },
        }),
      ],
      dependencies: [],
      activeJobs: [],
    });

    expect(result.candidates).toEqual([]);
    expect(result.skipped.humanReviewRequired).toContain("external-validator");
  });
});
