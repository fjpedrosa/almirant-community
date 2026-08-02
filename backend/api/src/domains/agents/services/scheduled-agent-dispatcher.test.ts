import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

// Preserve the real sibling modules BEFORE the `mock.module` calls below
// activate. Without this, Bun's global mock registry would leak our stubs
// into any test file that runs after this one and imports these modules.
import * as realReleaseIntegrationQueueServiceModule from "./release-integration-queue-service";
const realReleaseIntegrationQueueService = { ...realReleaseIntegrationQueueServiceModule };
import * as realExecuteScheduledAgentConfigModule from "./execute-scheduled-agent-config";
const realExecuteScheduledAgentConfig = { ...realExecuteScheduledAgentConfigModule };

import { createDatabaseMocks, createLoggerMock, restoreRealModules } from "../../../test/mocks";
import { DuplicateActiveJobError, type EnabledScheduledAgentConfig } from "@almirant/database";

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------

type CreatedJob = Record<string, unknown> & { workItemId?: string; jobType?: string };

const emptySkipped = {
  excluded: [] as string[],
  blocked: [] as Array<{ workItemId: string; blockedBy: string[] }>,
  active: [] as string[],
  concurrency: [] as string[],
  recentlyModified: [] as Array<{ workItemId: string; lastModifiedAt: string }>,
  dodIncomplete: [] as string[],
  notDodRemediation: [] as string[],
  missingDodReport: [] as string[],
  humanReviewRequired: [] as string[],
};

const state = {
  configs: [] as EnabledScheduledAgentConfig[],
  quotaResult: { allowed: true } as { allowed: boolean; reason?: string },
  quotaCalls: [] as Array<{ workspaceId: string; provider: string }>,
  backlogDrainResult: { candidates: [] as unknown[], skipped: emptySkipped },
  backlogDrainThrowForConfigIds: new Set<string>(),
  backlogDrainCalls: [] as Array<{ configId: string; workspaceId: string }>,
  dodRemediationResult: { candidates: [] as unknown[], skipped: emptySkipped },
  dodRemediationCalls: [] as Array<{ configId: string; workspaceId: string }>,
  dodReviewResult: [] as unknown[],
  dodReviewCalls: [] as Array<{ workspaceId: string; projectId?: string; limit?: number }>,
  countActiveResult: 0,
  countActiveCalls: [] as Array<Record<string, unknown>>,
  validationCandidatesResult: [] as unknown[],
  validationCandidatesCalls: [] as unknown[][],
  fixCandidatesResult: [] as unknown[],
  fixCandidatesCalls: [] as unknown[][],
  createdJobs: [] as CreatedJob[],
  createJobThrowDuplicateForWorkItemIds: new Set<string>(),
  lastRunUpdates: [] as string[],
  releaseIntegrationResult: null as unknown,
  releaseIntegrationCalls: [] as Array<Record<string, unknown>>,
  standaloneResult: { job: { id: "job-standalone" }, created: true } as {
    job: { id: string };
    created: boolean;
  },
  standaloneCalls: [] as Array<{ configId: string; options: Record<string, unknown> }>,
  consumeOnceResult: true,
  consumeOnceCalls: [] as string[],
  workspaceOwnerUserId: null as string | null,
  workspaceOwnerCalls: [] as string[],
};

const resetState = () => {
  state.configs = [];
  state.quotaResult = { allowed: true };
  state.quotaCalls = [];
  state.backlogDrainResult = { candidates: [], skipped: { ...emptySkipped } };
  state.backlogDrainThrowForConfigIds = new Set();
  state.backlogDrainCalls = [];
  state.dodRemediationResult = { candidates: [], skipped: { ...emptySkipped } };
  state.dodRemediationCalls = [];
  state.dodReviewResult = [];
  state.dodReviewCalls = [];
  state.countActiveResult = 0;
  state.countActiveCalls = [];
  state.validationCandidatesResult = [];
  state.validationCandidatesCalls = [];
  state.fixCandidatesResult = [];
  state.fixCandidatesCalls = [];
  state.createdJobs = [];
  state.createJobThrowDuplicateForWorkItemIds = new Set();
  state.lastRunUpdates = [];
  state.releaseIntegrationResult = null;
  state.releaseIntegrationCalls = [];
  state.standaloneResult = { job: { id: "job-standalone" }, created: true };
  state.standaloneCalls = [];
  state.consumeOnceResult = true;
  state.consumeOnceCalls = [];
  state.workspaceOwnerUserId = null;
  state.workspaceOwnerCalls = [];
};

mock.module("@almirant/database", () =>
  createDatabaseMocks({
    listEnabledScheduledAgentConfigs: async () => state.configs,
    checkQuotaAvailable: async (workspaceId: string, provider: string) => {
      state.quotaCalls.push({ workspaceId, provider });
      return state.quotaResult;
    },
    getBacklogDrainCandidatesForConfigId: async (configId: string, workspaceId: string) => {
      state.backlogDrainCalls.push({ configId, workspaceId });
      if (state.backlogDrainThrowForConfigIds.has(configId)) {
        throw new Error(`backlog-drain candidate lookup failed for ${configId}`);
      }
      return state.backlogDrainResult;
    },
    getDodRemediationCandidatesForConfigId: async (configId: string, workspaceId: string) => {
      state.dodRemediationCalls.push({ configId, workspaceId });
      return state.dodRemediationResult;
    },
    getDefinitionOfDoneReviewCandidates: async (
      workspaceId: string,
      projectId?: string,
      limit?: number,
    ) => {
      state.dodReviewCalls.push({ workspaceId, projectId, limit });
      return state.dodReviewResult;
    },
    countActiveAgentJobsForLane: async (params: Record<string, unknown>) => {
      state.countActiveCalls.push(params);
      return state.countActiveResult;
    },
    getValidationCandidates: async (...args: unknown[]) => {
      state.validationCandidatesCalls.push(args);
      return state.validationCandidatesResult;
    },
    getFixCandidates: async (...args: unknown[]) => {
      state.fixCandidatesCalls.push(args);
      return state.fixCandidatesResult;
    },
    createJob: async (input: CreatedJob) => {
      if (
        typeof input.workItemId === "string" &&
        state.createJobThrowDuplicateForWorkItemIds.has(input.workItemId)
      ) {
        throw new DuplicateActiveJobError(input.workItemId, (input.jobType as string) ?? null);
      }
      state.createdJobs.push(input);
      return { id: `job-${state.createdJobs.length}`, status: "queued", ...input };
    },
    updateScheduledAgentConfigLastRunAt: async (id: string) => {
      state.lastRunUpdates.push(id);
    },
    consumeOnceScheduleOccurrence: async (id: string) => {
      state.consumeOnceCalls.push(id);
      return state.consumeOnceResult;
    },
    getWorkspaceOwnerUserId: async (workspaceId: string) => {
      state.workspaceOwnerCalls.push(workspaceId);
      return state.workspaceOwnerUserId;
    },
  }),
);

mock.module("@almirant/config", () => createLoggerMock());

mock.module("./release-integration-queue-service", () => ({
  queueReleaseIntegration: async (input: Record<string, unknown>) => {
    state.releaseIntegrationCalls.push(input);
    return state.releaseIntegrationResult;
  },
}));

mock.module("./execute-scheduled-agent-config", () => ({
  executeScheduledAgentConfigWithResult: async (
    config: EnabledScheduledAgentConfig,
    options: Record<string, unknown>,
  ) => {
    state.standaloneCalls.push({ configId: config.id, options });
    return state.standaloneResult;
  },
}));

const { runScheduledAgentDispatchOnce } = await import("./scheduled-agent-dispatcher");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = new Date("2026-08-01T10:00:00.000Z"); // hour 10 UTC

const baseConfig: EnabledScheduledAgentConfig = {
  id: "config-1",
  workspaceId: "workspace-1",
  ownerUserId: null,
  projectId: null,
  name: "Test scheduled agent",
  prompt: null,
  jobType: "scheduled",
  provider: "claude-code",
  description: null,
  codingAgent: "claude-code",
  aiProvider: null,
  aiModel: null,
  reasoningLevel: null,
  skillId: null,
  trigger: "scheduled",
  webhookToken: null,
  scheduleType: "time_window",
  // In-window for NOW (hour 10) by default; individual tests override.
  scheduleConfig: { startHour: 8, endHour: 18, daysOfWeek: [] },
  timezone: "UTC",
  enabled: true,
  targetConfig: {},
  mcpServers: null,
  maxJobsPerRun: 10,
  pausedUntil: null,
  lastRunAt: null,
  managedBy: "user" as const,
  builtinAutomationId: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  projectName: null,
} as EnabledScheduledAgentConfig;

describe("runScheduledAgentDispatchOnce", () => {
  beforeEach(() => {
    resetState();
  });

  it("skips a config that is not due yet, without creating a job", async () => {
    state.configs = [
      { ...baseConfig, scheduleConfig: { startHour: 8, endHour: 9, daysOfWeek: [] } },
    ];

    const summary = await runScheduledAgentDispatchOnce(NOW);

    expect(summary.configsSeen).toBe(1);
    expect(summary.configsProcessed).toBe(1);
    expect(summary.skipped.notDue).toBe(1);
    expect(summary.jobsCreated).toBe(0);
    expect(state.createdJobs).toEqual([]);
    expect(state.lastRunUpdates).toEqual([]);
    expect(state.standaloneCalls).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // scheduleType='once' (community issue #91) — due-gate routing wiring. The
  // auto-disable behavior itself lives in `updateScheduledAgentConfigLastRunAt`
  // (repository layer, exercised in scheduled-agent-config-repository.test.ts
  // against a real PGlite instance) — this mocked-DB suite only proves the
  // dispatcher calls `isOnceDue` (not `isTimeWindowActive`) for 'once' configs.
  // ---------------------------------------------------------------------------

  it("skips a 'once' config whose runAt is still in the future", async () => {
    state.configs = [
      {
        ...baseConfig,
        scheduleType: "once",
        scheduleConfig: { runAt: "2026-08-01T11:00:00.000Z" },
      },
    ];

    const summary = await runScheduledAgentDispatchOnce(NOW);

    expect(summary.skipped.notDue).toBe(1);
    expect(summary.jobsCreated).toBe(0);
    expect(state.standaloneCalls).toEqual([]);
  });

  it("dispatches a standalone 'once' config once runAt has passed, keyed by 'once:<runAt>'", async () => {
    state.configs = [
      {
        ...baseConfig,
        scheduleType: "once",
        scheduleConfig: { runAt: "2026-08-01T09:00:00.000Z" },
      },
    ];

    const summary = await runScheduledAgentDispatchOnce(NOW);

    expect(summary.skipped.notDue).toBe(0);
    expect(summary.jobsCreatedByMode.standalone).toBe(1);
    expect(state.standaloneCalls).toHaveLength(1);
    expect(state.standaloneCalls[0]?.options).toMatchObject({
      dueKey: "once:2026-08-01T09:00:00.000Z",
    });
  });

  // -------------------------------------------------------------------------
  // Fix 1 (review, CRITICAL): at-most-once PRE-dispatch consumption for
  // 'once' configs. `consumeOnceScheduleOccurrence` must be called for EVERY
  // dispatch mode (not just standalone), BEFORE the mode router, and a
  // `false` return must skip without creating any job — the atomic UPDATE
  // itself is exercised against a real PGlite instance in
  // scheduled-agent-config-repository.test.ts; this mocked-DB suite only
  // proves the dispatcher wiring: who gets called, in what order, and what
  // happens on both outcomes.
  // -------------------------------------------------------------------------
  it("consumes the 'once' occurrence before routing to backlogDrain, and dispatches when consumption succeeds", async () => {
    state.configs = [
      {
        ...baseConfig,
        scheduleType: "once",
        scheduleConfig: { runAt: "2026-08-01T09:00:00.000Z" },
        targetConfig: { backlogDrain: { enabled: true } },
      },
    ];
    state.consumeOnceResult = true;
    state.backlogDrainResult = {
      candidates: [
        {
          id: "wi-once-1",
          projectId: "p1",
          boardId: "b1",
          provider: "claude-code",
          codingAgent: "claude-code",
          aiProvider: "anthropic",
          model: "claude-opus-4-8",
          reasoningLevel: null,
        },
      ],
      skipped: { ...emptySkipped },
    };

    const summary = await runScheduledAgentDispatchOnce(NOW);

    expect(state.consumeOnceCalls).toEqual(["config-1"]);
    expect(state.backlogDrainCalls).toHaveLength(1);
    expect(state.createdJobs).toHaveLength(1);
    expect(summary.jobsCreatedByMode.backlogDrain).toBe(1);
  });

  it("skips a 'once' config without dispatching ANY mode when the occurrence was already consumed by another dispatch authority", async () => {
    state.configs = [
      {
        ...baseConfig,
        scheduleType: "once",
        scheduleConfig: { runAt: "2026-08-01T09:00:00.000Z" },
        targetConfig: { backlogDrain: { enabled: true } },
      },
    ];
    // Simulates a concurrent replica (or a crashed-but-already-consumed
    // occurrence) winning the atomic UPDATE first.
    state.consumeOnceResult = false;

    const summary = await runScheduledAgentDispatchOnce(NOW);

    expect(state.consumeOnceCalls).toEqual(["config-1"]);
    expect(state.backlogDrainCalls).toEqual([]);
    expect(state.createdJobs).toEqual([]);
    expect(summary.jobsCreated).toBe(0);
    expect(summary.jobsCreatedByMode.backlogDrain).toBe(0);
    expect(summary.skipped.onceAlreadyConsumed).toBe(1);
  });

  it("consumes the 'once' occurrence before routing to the standalone (jobType='scheduled') branch too", async () => {
    state.configs = [
      {
        ...baseConfig,
        scheduleType: "once",
        scheduleConfig: { runAt: "2026-08-01T09:00:00.000Z" },
      },
    ];
    state.consumeOnceResult = false;

    const summary = await runScheduledAgentDispatchOnce(NOW);

    expect(state.consumeOnceCalls).toEqual(["config-1"]);
    expect(state.standaloneCalls).toEqual([]);
    expect(summary.jobsCreatedByMode.standalone).toBe(0);
    expect(summary.skipped.onceAlreadyConsumed).toBe(1);
  });

  it("consumes the 'once' occurrence before routing to candidate-based dispatch too", async () => {
    state.configs = [
      {
        ...baseConfig,
        scheduleType: "once",
        scheduleConfig: { runAt: "2026-08-01T09:00:00.000Z" },
        jobType: "validation",
      },
    ];
    state.consumeOnceResult = false;
    state.validationCandidatesResult = [{ id: "wi-once-2", projectId: "p1", boardId: "b1" }];

    const summary = await runScheduledAgentDispatchOnce(NOW);

    expect(state.consumeOnceCalls).toEqual(["config-1"]);
    expect(state.validationCandidatesCalls).toEqual([]);
    expect(state.createdJobs).toEqual([]);
    expect(summary.skipped.onceAlreadyConsumed).toBe(1);
  });

  it("does NOT call consumeOnceScheduleOccurrence for cron/time_window configs — only 'once' gets pre-dispatch consumption", async () => {
    state.configs = [
      { ...baseConfig, scheduleType: "time_window" },
      {
        ...baseConfig,
        id: "config-cron",
        scheduleType: "cron",
        scheduleConfig: { expression: "*/5 * * * *" },
      },
    ];

    await runScheduledAgentDispatchOnce(NOW);

    expect(state.consumeOnceCalls).toEqual([]);
  });

  it("does not consume the 'once' occurrence when the quota gate rejects it first — quota exhaustion must not permanently lose the occurrence", async () => {
    state.configs = [
      {
        ...baseConfig,
        scheduleType: "once",
        scheduleConfig: { runAt: "2026-08-01T09:00:00.000Z" },
      },
    ];
    state.quotaResult = { allowed: false, reason: "monthly token limit exceeded" };

    const summary = await runScheduledAgentDispatchOnce(NOW);

    expect(summary.skipped.noQuota).toBe(1);
    expect(state.consumeOnceCalls).toEqual([]);
  });

  it("skips a due config without quota, and does NOT touch lastRunAt", async () => {
    state.configs = [{ ...baseConfig }];
    state.quotaResult = { allowed: false, reason: "monthly token limit exceeded" };

    const summary = await runScheduledAgentDispatchOnce(NOW);

    expect(summary.skipped.noQuota).toBe(1);
    expect(summary.jobsCreated).toBe(0);
    expect(state.createdJobs).toEqual([]);
    expect(state.lastRunUpdates).toEqual([]);
    expect(state.standaloneCalls).toEqual([]);
    // provider is null on the config, so it must fall back through
    // AI_PROVIDER_BY_AGENT_PROVIDER["claude-code"] -> "anthropic".
    expect(state.quotaCalls).toEqual([{ workspaceId: "workspace-1", provider: "anthropic" }]);
  });

  it("keeps processing the rest of the tick when one config throws", async () => {
    const throwing: EnabledScheduledAgentConfig = {
      ...baseConfig,
      id: "config-throw",
      targetConfig: { backlogDrain: { enabled: true } },
    };
    const ok: EnabledScheduledAgentConfig = {
      ...baseConfig,
      id: "config-ok",
      workspaceId: "workspace-2",
    };
    state.configs = [throwing, ok];
    state.backlogDrainThrowForConfigIds.add("config-throw");

    const summary = await runScheduledAgentDispatchOnce(NOW);

    expect(summary.configsProcessed).toBe(2);
    expect(summary.errors).toBe(1);
    expect(summary.jobsCreatedByMode.standalone).toBe(1);
    expect(state.standaloneCalls).toHaveLength(1);
    expect(state.standaloneCalls[0]?.configId).toBe("config-ok");
    // The failing config never reached lastRunAt.
    expect(state.lastRunUpdates).toEqual([]);
  });

  it("round-robins configs across workspaces instead of exhausting one first", async () => {
    const wsA = Array.from({ length: 3 }, (_, i) => ({
      ...baseConfig,
      id: `a-${i}`,
      workspaceId: "ws-a",
    }));
    const wsB = Array.from({ length: 3 }, (_, i) => ({
      ...baseConfig,
      id: `b-${i}`,
      workspaceId: "ws-b",
    }));
    state.configs = [...wsA, ...wsB];

    const summary = await runScheduledAgentDispatchOnce(NOW, { maxConfigsPerTick: 4 });

    expect(summary.configsSeen).toBe(6);
    expect(summary.configsProcessed).toBe(4);
    expect(summary.capReached).toBe(true);

    const processedIds = state.standaloneCalls.map((c) => c.configId);
    expect(processedIds).toHaveLength(4);
    const fromA = processedIds.filter((id) => id.startsWith("a-")).length;
    const fromB = processedIds.filter((id) => id.startsWith("b-")).length;
    // Fair split: neither workspace exhausted before the other got a turn.
    expect(fromA).toBe(2);
    expect(fromB).toBe(2);
  });

  it("routes backlogDrain configs through getBacklogDrainCandidatesForConfigId", async () => {
    state.configs = [
      {
        ...baseConfig,
        targetConfig: { backlogDrain: { enabled: true } },
      },
    ];
    state.backlogDrainResult = {
      candidates: [
        {
          id: "wi-1",
          projectId: "p1",
          boardId: "b1",
          provider: "claude-code",
          codingAgent: "claude-code",
          aiProvider: "anthropic",
          model: "claude-opus-4-8",
          reasoningLevel: null,
        },
      ],
      skipped: { ...emptySkipped },
    };

    const summary = await runScheduledAgentDispatchOnce(NOW);

    expect(state.backlogDrainCalls).toEqual([{ configId: "config-1", workspaceId: "workspace-1" }]);
    expect(state.createdJobs).toHaveLength(1);
    expect(state.createdJobs[0]?.workItemId).toBe("wi-1");
    expect((state.createdJobs[0]?.config as Record<string, unknown>)?.source).toBe("backlog-drain");
    expect(summary.jobsCreatedByMode.backlogDrain).toBe(1);
    expect(state.lastRunUpdates).toEqual(["config-1"]);
  });

  it("routes dodRemediation configs through getDodRemediationCandidatesForConfigId", async () => {
    state.configs = [
      {
        ...baseConfig,
        targetConfig: { dodRemediation: { enabled: true } },
      },
    ];
    state.dodRemediationResult = {
      candidates: [
        {
          id: "wi-2",
          projectId: "p1",
          boardId: "b1",
          provider: "claude-code",
          codingAgent: "claude-code",
          aiProvider: "anthropic",
          model: "claude-opus-4-8",
          reasoningLevel: null,
          skillName: "runner-fix-dod",
          dodReport: "some report",
          dodReviewedAt: "2026-07-31T00:00:00.000Z",
        },
      ],
      skipped: { ...emptySkipped },
    };

    const summary = await runScheduledAgentDispatchOnce(NOW);

    expect(state.dodRemediationCalls).toEqual([{ configId: "config-1", workspaceId: "workspace-1" }]);
    expect(state.createdJobs).toHaveLength(1);
    expect((state.createdJobs[0]?.config as Record<string, unknown>)?.source).toBe("dod-remediation");
    expect(summary.jobsCreatedByMode.dodRemediation).toBe(1);
  });

  it("routes dodReview configs through getDefinitionOfDoneReviewCandidates + countActiveAgentJobsForLane", async () => {
    state.configs = [
      {
        ...baseConfig,
        targetConfig: { dodReview: { enabled: true } },
      },
    ];
    state.countActiveResult = 0;
    state.dodReviewResult = [{ id: "wi-3", projectId: "p1", boardId: "b1" }];

    const summary = await runScheduledAgentDispatchOnce(NOW);

    expect(state.countActiveCalls).toHaveLength(1);
    expect(state.dodReviewCalls).toHaveLength(1);
    expect(state.createdJobs).toHaveLength(1);
    expect(state.createdJobs[0]?.jobType).toBe("review");
    expect(summary.jobsCreatedByMode.dodReview).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Duplicate-active-job races (agent_jobs_work_item_job_type_active_uidx,
  // migration 0236): the runner-side scheduler and this backend dispatcher
  // can both pick the same candidate in the same tick. `createJob` throws
  // `DuplicateActiveJobError` for that candidate — it must be treated as a
  // skipped candidate (like the existing skipped.active read-time filter),
  // never as a tick error, and must not stop the rest of the batch.
  // -------------------------------------------------------------------------
  it("treats a duplicate-active-job race in backlogDrain as a skipped candidate, not a tick error", async () => {
    state.configs = [
      {
        ...baseConfig,
        targetConfig: { backlogDrain: { enabled: true } },
      },
    ];
    state.backlogDrainResult = {
      candidates: [
        {
          id: "wi-raced",
          projectId: "p1",
          boardId: "b1",
          provider: "claude-code",
          codingAgent: "claude-code",
          aiProvider: "anthropic",
          model: "claude-opus-4-8",
          reasoningLevel: null,
        },
        {
          id: "wi-ok",
          projectId: "p1",
          boardId: "b1",
          provider: "claude-code",
          codingAgent: "claude-code",
          aiProvider: "anthropic",
          model: "claude-opus-4-8",
          reasoningLevel: null,
        },
      ],
      skipped: { ...emptySkipped },
    };
    state.createJobThrowDuplicateForWorkItemIds.add("wi-raced");

    const summary = await runScheduledAgentDispatchOnce(NOW);

    expect(summary.errors).toBe(0);
    expect(summary.duplicateSkipped).toBe(1);
    expect(state.createdJobs).toHaveLength(1);
    expect(state.createdJobs[0]?.workItemId).toBe("wi-ok");
    expect(summary.jobsCreatedByMode.backlogDrain).toBe(1);
    expect(state.lastRunUpdates).toEqual(["config-1"]);
  });

  it("treats a duplicate-active-job race in dodRemediation as a skipped candidate, not a tick error", async () => {
    state.configs = [
      {
        ...baseConfig,
        targetConfig: { dodRemediation: { enabled: true } },
      },
    ];
    state.dodRemediationResult = {
      candidates: [
        {
          id: "wi-raced",
          projectId: "p1",
          boardId: "b1",
          provider: "claude-code",
          codingAgent: "claude-code",
          aiProvider: "anthropic",
          model: "claude-opus-4-8",
          reasoningLevel: null,
          skillName: "runner-fix-dod",
          dodReport: "some report",
          dodReviewedAt: "2026-07-31T00:00:00.000Z",
        },
      ],
      skipped: { ...emptySkipped },
    };
    state.createJobThrowDuplicateForWorkItemIds.add("wi-raced");

    const summary = await runScheduledAgentDispatchOnce(NOW);

    expect(summary.errors).toBe(0);
    expect(summary.duplicateSkipped).toBe(1);
    expect(state.createdJobs).toHaveLength(0);
    expect(summary.jobsCreatedByMode.dodRemediation).toBe(0);
    expect(state.lastRunUpdates).toEqual(["config-1"]);
  });

  it("treats a duplicate-active-job race in dodReview as a skipped candidate, not a tick error", async () => {
    state.configs = [
      {
        ...baseConfig,
        targetConfig: { dodReview: { enabled: true } },
      },
    ];
    state.countActiveResult = 0;
    state.dodReviewResult = [
      { id: "wi-raced", projectId: "p1", boardId: "b1" },
      { id: "wi-ok", projectId: "p1", boardId: "b1" },
    ];
    state.createJobThrowDuplicateForWorkItemIds.add("wi-raced");

    const summary = await runScheduledAgentDispatchOnce(NOW);

    expect(summary.errors).toBe(0);
    expect(summary.duplicateSkipped).toBe(1);
    expect(state.createdJobs).toHaveLength(1);
    expect(state.createdJobs[0]?.workItemId).toBe("wi-ok");
    expect(summary.jobsCreatedByMode.dodReview).toBe(1);
  });

  it("treats a duplicate-active-job race in candidate-based dispatch as a skipped candidate, not a tick error", async () => {
    state.configs = [{ ...baseConfig, jobType: "validation" }];
    state.validationCandidatesResult = [
      { id: "wi-raced", projectId: "p1", boardId: "b1" },
      { id: "wi-ok", projectId: "p1", boardId: "b1" },
    ];
    state.createJobThrowDuplicateForWorkItemIds.add("wi-raced");

    const summary = await runScheduledAgentDispatchOnce(NOW);

    expect(summary.errors).toBe(0);
    expect(summary.duplicateSkipped).toBe(1);
    expect(state.createdJobs).toHaveLength(1);
    expect(state.createdJobs[0]?.workItemId).toBe("wi-ok");
    expect(summary.jobsCreatedByMode.candidateBased).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Precedence ladder contract pin — mirrors the if/else-if order in
  // dispatchOneConfig EXACTLY: backlogDrain -> dodRemediation -> dodReview ->
  // releaseIntegration. When multiple targetConfig flags are simultaneously
  // enabled on the same config, the FIRST one in that order must win and the
  // others must never be consulted. This must hold whether the router is a
  // literal if/else-if chain or derived from the builtin-automations
  // catalog's dispatchPrecedence.
  // -------------------------------------------------------------------------
  it("backlogDrain wins when all four built-in flags are enabled simultaneously", async () => {
    state.configs = [
      {
        ...baseConfig,
        targetConfig: {
          backlogDrain: { enabled: true },
          dodRemediation: { enabled: true },
          dodReview: { enabled: true },
          releaseIntegration: { enabled: true },
        },
      },
    ];

    const summary = await runScheduledAgentDispatchOnce(NOW);

    expect(state.backlogDrainCalls).toHaveLength(1);
    expect(state.dodRemediationCalls).toHaveLength(0);
    expect(state.dodReviewCalls).toHaveLength(0);
    expect(state.releaseIntegrationCalls).toHaveLength(0);
    expect(summary.jobsCreatedByMode.backlogDrain).toBe(0); // no candidates, but the branch ran
    expect(summary.jobsCreatedByMode.dodRemediation).toBe(0);
    expect(summary.jobsCreatedByMode.dodReview).toBe(0);
    expect(summary.jobsCreatedByMode.releaseIntegration).toBe(0);
  });

  it("dodRemediation wins over dodReview/releaseIntegration when backlogDrain is disabled", async () => {
    state.configs = [
      {
        ...baseConfig,
        targetConfig: {
          backlogDrain: { enabled: false },
          dodRemediation: { enabled: true },
          dodReview: { enabled: true },
          releaseIntegration: { enabled: true },
        },
      },
    ];

    await runScheduledAgentDispatchOnce(NOW);

    expect(state.backlogDrainCalls).toHaveLength(0);
    expect(state.dodRemediationCalls).toHaveLength(1);
    expect(state.dodReviewCalls).toHaveLength(0);
    expect(state.releaseIntegrationCalls).toHaveLength(0);
  });

  it("dodReview wins over releaseIntegration when backlogDrain/dodRemediation are disabled", async () => {
    state.configs = [
      {
        ...baseConfig,
        targetConfig: {
          backlogDrain: { enabled: false },
          dodRemediation: { enabled: false },
          dodReview: { enabled: true },
          releaseIntegration: { enabled: true },
        },
      },
    ];

    await runScheduledAgentDispatchOnce(NOW);

    expect(state.dodRemediationCalls).toHaveLength(0);
    expect(state.dodReviewCalls).toHaveLength(1);
    expect(state.releaseIntegrationCalls).toHaveLength(0);
  });

  it("releaseIntegration only runs when the other three built-in flags are disabled", async () => {
    state.configs = [
      {
        ...baseConfig,
        targetConfig: {
          backlogDrain: { enabled: false },
          dodRemediation: { enabled: false },
          dodReview: { enabled: false },
          releaseIntegration: { enabled: true },
        },
      },
    ];
    state.releaseIntegrationResult = { batches: [], skipped: {
      noCandidates: 1, activeRunningBatches: 0, activeProjectLimit: 0,
      duplicateItems: 0, missingPullRequest: 0, unresolvedRepository: 0,
    } };

    await runScheduledAgentDispatchOnce(NOW);

    expect(state.dodReviewCalls).toHaveLength(0);
    expect(state.releaseIntegrationCalls).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Skill-name contract pin — the literal skill names hardcoded per mode
  // today, now expected to be sourced from the builtin-automations catalog.
  // -------------------------------------------------------------------------
  it("pins the skillName written into created jobs for each built-in mode", async () => {
    state.configs = [
      { ...baseConfig, id: "cfg-backlog", targetConfig: { backlogDrain: { enabled: true } } },
    ];
    state.backlogDrainResult = {
      candidates: [
        {
          id: "wi-skill-1", projectId: "p1", boardId: "b1", provider: "claude-code",
          codingAgent: "claude-code", aiProvider: "anthropic", model: "claude-opus-4-8",
          reasoningLevel: null,
        },
      ],
      skipped: { ...emptySkipped },
    };

    await runScheduledAgentDispatchOnce(NOW);

    expect((state.createdJobs[0]?.config as Record<string, unknown>)?.skillName).toBe(
      "runner-implement",
    );
  });

  it("dodRemediation falls back to the catalog's skill name when a candidate has none", async () => {
    state.configs = [
      { ...baseConfig, targetConfig: { dodRemediation: { enabled: true } } },
    ];
    state.dodRemediationResult = {
      candidates: [
        {
          id: "wi-skill-2", projectId: "p1", boardId: "b1", provider: "claude-code",
          codingAgent: "claude-code", aiProvider: "anthropic", model: "claude-opus-4-8",
          reasoningLevel: null,
          // no skillName on the candidate -> must fall back to the catalog default.
        },
      ],
      skipped: { ...emptySkipped },
    };

    await runScheduledAgentDispatchOnce(NOW);

    expect((state.createdJobs[0]?.config as Record<string, unknown>)?.skillName).toBe(
      "runner-fix-dod",
    );
  });

  it("dodReview writes the catalog's skillName into created jobs", async () => {
    state.configs = [{ ...baseConfig, targetConfig: { dodReview: { enabled: true } } }];
    state.dodReviewResult = [{ id: "wi-skill-3", projectId: "p1", boardId: "b1" }];

    await runScheduledAgentDispatchOnce(NOW);

    expect((state.createdJobs[0]?.config as Record<string, unknown>)?.skillName).toBe("dod-review");
  });

  it("routes releaseIntegration configs through queueReleaseIntegration", async () => {
    state.configs = [
      {
        ...baseConfig,
        targetConfig: { releaseIntegration: { enabled: true } },
      },
    ];
    state.releaseIntegrationResult = {
      batches: [
        { batchId: "batch-1", repositoryId: "r1", projectId: "p1", created: true, enqueuedItemCount: 2 },
      ],
      skipped: {
        noCandidates: 0,
        activeRunningBatches: 0,
        activeProjectLimit: 0,
        duplicateItems: 0,
        missingPullRequest: 0,
        unresolvedRepository: 0,
      },
    };

    const summary = await runScheduledAgentDispatchOnce(NOW);

    expect(state.releaseIntegrationCalls).toHaveLength(1);
    expect(summary.jobsCreatedByMode.releaseIntegration).toBe(2);
    expect(state.lastRunUpdates).toEqual(["config-1"]);
  });

  it("routes jobType=scheduled configs through executeScheduledAgentConfigWithResult with a dueKey", async () => {
    state.configs = [{ ...baseConfig }];

    const summary = await runScheduledAgentDispatchOnce(NOW);

    expect(state.standaloneCalls).toHaveLength(1);
    expect(state.standaloneCalls[0]?.options.trigger).toBe("schedule");
    expect(typeof state.standaloneCalls[0]?.options.dueKey).toBe("string");
    expect(summary.jobsCreatedByMode.standalone).toBe(1);
    // executeScheduledAgentConfigWithResult owns lastRunAt for this path.
    expect(state.lastRunUpdates).toEqual([]);
  });

  it("routes other jobTypes (e.g. validation) through candidate-based dispatch", async () => {
    state.configs = [{ ...baseConfig, jobType: "validation" }];
    state.validationCandidatesResult = [{ id: "wi-4", projectId: "p1", boardId: "b1" }];

    const summary = await runScheduledAgentDispatchOnce(NOW);

    expect(state.validationCandidatesCalls).toHaveLength(1);
    expect(state.createdJobs).toHaveLength(1);
    expect(state.createdJobs[0]?.jobType).toBe("validation");
    expect(summary.jobsCreatedByMode.candidateBased).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Regression test: explicitly disabling every project rule for a
  // deterministic mode must NOT fall back to config.projectId and silently
  // re-enable it. See scheduled-agent-dispatcher.ts's "DELIBERATE DIVERGENCE"
  // note — the runner's resolveProjectConcurrencyScopes has this bug; this
  // dispatcher's resolveProjectConcurrencyScopes must not.
  // -------------------------------------------------------------------------
  it("respects an explicitly disabled project rule for dodReview (does not re-derive from config.projectId)", async () => {
    state.configs = [
      {
        ...baseConfig,
        projectId: "p1",
        targetConfig: {
          dodReview: { enabled: true, projects: [{ projectId: "p1", enabled: false }] },
        },
      },
    ];

    const summary = await runScheduledAgentDispatchOnce(NOW);

    expect(state.countActiveCalls).toEqual([]);
    expect(state.dodReviewCalls).toEqual([]);
    expect(state.createdJobs).toEqual([]);
    expect(summary.jobsCreated).toBe(0);
    // The mode still ran (it just found zero scopes to query), so lastRunAt
    // is updated — same as any other "no candidates" outcome.
    expect(state.lastRunUpdates).toEqual(["config-1"]);
  });

  it("respects an explicitly disabled project rule for releaseIntegration (does not re-derive from config.projectId)", async () => {
    state.configs = [
      {
        ...baseConfig,
        projectId: "p1",
        targetConfig: {
          releaseIntegration: { enabled: true, projects: [{ projectId: "p1", enabled: false }] },
        },
      },
    ];

    const summary = await runScheduledAgentDispatchOnce(NOW);

    expect(state.releaseIntegrationCalls).toEqual([]);
    expect(summary.jobsCreated).toBe(0);
    expect(state.lastRunUpdates).toEqual(["config-1"]);
  });

  // -------------------------------------------------------------------------
  // createdByUserId workspace-owner fallback (legacy `ownerUserId: null`
  // configs). Each of the four built-in dispatcher automations calls
  // `createJob` once per candidate inside a loop — the fallback lookup must
  // still happen ONCE per dispatch, not once per candidate. See
  // `resolveScheduledDispatchCreatedByUserId`'s docstring in
  // scheduled-agent-identity.ts.
  // -------------------------------------------------------------------------
  it("backlogDrain falls back to the workspace owner once for the whole dispatch, even with multiple candidates", async () => {
    state.configs = [{ ...baseConfig, targetConfig: { backlogDrain: { enabled: true } } }];
    state.workspaceOwnerUserId = "workspace-owner-1";
    state.backlogDrainResult = {
      candidates: [
        { id: "wi-1", projectId: "p1", boardId: "b1", provider: "claude-code", codingAgent: "claude-code", aiProvider: "anthropic", model: "claude-opus-4-8", reasoningLevel: null },
        { id: "wi-2", projectId: "p1", boardId: "b1", provider: "claude-code", codingAgent: "claude-code", aiProvider: "anthropic", model: "claude-opus-4-8", reasoningLevel: null },
      ],
      skipped: { ...emptySkipped },
    };

    await runScheduledAgentDispatchOnce(NOW);

    expect(state.createdJobs).toHaveLength(2);
    expect(state.createdJobs.every((job) => job.createdByUserId === "workspace-owner-1")).toBe(true);
    expect(state.workspaceOwnerCalls).toEqual(["workspace-1"]);
  });

  it("backlogDrain does not query the workspace owner when the config already has one", async () => {
    state.configs = [
      { ...baseConfig, ownerUserId: "agent-owner-1", targetConfig: { backlogDrain: { enabled: true } } },
    ];
    state.backlogDrainResult = {
      candidates: [
        { id: "wi-1", projectId: "p1", boardId: "b1", provider: "claude-code", codingAgent: "claude-code", aiProvider: "anthropic", model: "claude-opus-4-8", reasoningLevel: null },
      ],
      skipped: { ...emptySkipped },
    };

    await runScheduledAgentDispatchOnce(NOW);

    expect(state.createdJobs).toHaveLength(1);
    expect(state.createdJobs[0]?.createdByUserId).toBe("agent-owner-1");
    expect(state.workspaceOwnerCalls).toEqual([]);
  });

  it("dodRemediation falls back to the workspace owner when the config has no owner", async () => {
    state.configs = [{ ...baseConfig, targetConfig: { dodRemediation: { enabled: true } } }];
    state.workspaceOwnerUserId = "workspace-owner-1";
    state.dodRemediationResult = {
      candidates: [
        { id: "wi-2", projectId: "p1", boardId: "b1", provider: "claude-code", codingAgent: "claude-code", aiProvider: "anthropic", model: "claude-opus-4-8", reasoningLevel: null, skillName: "runner-fix-dod", dodReport: "report", dodReviewedAt: "2026-07-31T00:00:00.000Z" },
      ],
      skipped: { ...emptySkipped },
    };

    await runScheduledAgentDispatchOnce(NOW);

    expect(state.createdJobs).toHaveLength(1);
    expect(state.createdJobs[0]?.createdByUserId).toBe("workspace-owner-1");
    expect(state.workspaceOwnerCalls).toEqual(["workspace-1"]);
  });

  it("dodReview falls back to the workspace owner when the config has no owner", async () => {
    state.configs = [{ ...baseConfig, targetConfig: { dodReview: { enabled: true } } }];
    state.workspaceOwnerUserId = "workspace-owner-1";
    state.dodReviewResult = [{ id: "wi-3", projectId: "p1", boardId: "b1" }];

    await runScheduledAgentDispatchOnce(NOW);

    expect(state.createdJobs).toHaveLength(1);
    expect(state.createdJobs[0]?.createdByUserId).toBe("workspace-owner-1");
    expect(state.workspaceOwnerCalls).toEqual(["workspace-1"]);
  });

  it("candidate-based dispatch falls back to the workspace owner when the config has no owner", async () => {
    state.configs = [{ ...baseConfig, jobType: "validation" }];
    state.workspaceOwnerUserId = "workspace-owner-1";
    state.validationCandidatesResult = [{ id: "wi-4", projectId: "p1", boardId: "b1" }];

    await runScheduledAgentDispatchOnce(NOW);

    expect(state.createdJobs).toHaveLength(1);
    expect(state.createdJobs[0]?.createdByUserId).toBe("workspace-owner-1");
    expect(state.workspaceOwnerCalls).toEqual(["workspace-1"]);
  });

  it("does not query the workspace owner when there are no candidates to dispatch", async () => {
    state.configs = [{ ...baseConfig, targetConfig: { backlogDrain: { enabled: true } } }];
    state.backlogDrainResult = { candidates: [], skipped: { ...emptySkipped } };

    await runScheduledAgentDispatchOnce(NOW);

    expect(state.createdJobs).toEqual([]);
    expect(state.workspaceOwnerCalls).toEqual([]);
  });
});

afterAll(() => {
  mock.restore();
  restoreRealModules();
  mock.module("./release-integration-queue-service", () => realReleaseIntegrationQueueService);
  mock.module("./execute-scheduled-agent-config", () => realExecuteScheduledAgentConfig);
});
