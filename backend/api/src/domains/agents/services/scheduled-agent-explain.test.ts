import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

import { createDatabaseMocks, restoreRealModules } from "../../../test/mocks";
import type { ScheduledAgentConfigDb } from "@almirant/database";
import { resolveEnabledBuiltinAutomation } from "@almirant/shared";

// ---------------------------------------------------------------------------
// Shared mock state — every DB-backed function the explain service touches
// is stubbed here so the test never hits a real Postgres connection.
// ---------------------------------------------------------------------------

type ExplainableConfig = ScheduledAgentConfigDb & { projectName: string | null };
type ListedConfig = ExplainableConfig & { skillName: string | null };

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
  configById: null as ExplainableConfig | null,
  configsByWorkspace: [] as ListedConfig[],
  projects: [] as Array<{ id: string; name: string }>,
  quotaResult: { allowed: true } as { allowed: boolean; reason?: string; resetAt?: string },
  boards: [] as Array<{ id: string; name: string; columns: Array<{ name: string; role: string }> }>,
  backlogDrainWorkItems: [] as Array<{
    id: string;
    taskId: string | null;
    title: string;
    type: string;
    parentId: string | null;
    projectId: string;
    boardId: string;
    columnRole: string | null;
    columnIsDone: boolean;
  }>,
  backlogDrainResult: { candidates: [] as unknown[], skipped: { ...emptySkipped } },
  dodRemediationResult: { candidates: [] as unknown[], skipped: { ...emptySkipped } },
  dodReviewResult: [] as unknown[],
  releaseIntegrationResult: {
    candidates: [] as unknown[],
    skipped: { missingPullRequest: 0, unresolvedRepository: 0, alreadyBatched: 0 },
  },
  validationCandidatesResult: [] as unknown[],
  fixCandidatesResult: [] as unknown[],
};

const resetState = () => {
  state.configById = null;
  state.configsByWorkspace = [];
  state.projects = [];
  state.quotaResult = { allowed: true };
  state.boards = [];
  state.backlogDrainWorkItems = [];
  state.backlogDrainResult = { candidates: [], skipped: { ...emptySkipped } };
  state.dodRemediationResult = { candidates: [], skipped: { ...emptySkipped } };
  state.dodReviewResult = [];
  state.releaseIntegrationResult = {
    candidates: [],
    skipped: { missingPullRequest: 0, unresolvedRepository: 0, alreadyBatched: 0 },
  };
  state.validationCandidatesResult = [];
  state.fixCandidatesResult = [];
};

mock.module("@almirant/database", () =>
  createDatabaseMocks({
    getScheduledAgentConfigById: async (id: string, workspaceId: string) =>
      state.configById && state.configById.id === id && state.configById.workspaceId === workspaceId
        ? state.configById
        : undefined,
    listScheduledAgentConfigsByWorkspace: async () => state.configsByWorkspace,
    getProjectById: async (_workspaceId: string, id: string) => {
      const found = state.projects.find((p) => p.id === id);
      return found ? { ...found } : null;
    },
    getProjects: async () => ({ projects: state.projects, total: state.projects.length }),
    checkQuotaAvailable: async () => state.quotaResult,
    getAllBoards: async () => state.boards,
    listBacklogDrainWorkItems: async (_workspaceId: string, projectIds: string[]) =>
      state.backlogDrainWorkItems.filter((item) => projectIds.includes(item.projectId)),
    getBacklogDrainCandidatesForConfigId: async () => state.backlogDrainResult,
    getDodRemediationCandidatesForConfigId: async () => state.dodRemediationResult,
    getDefinitionOfDoneReviewCandidates: async () => state.dodReviewResult,
    getValidatingReleaseCandidates: async () => state.releaseIntegrationResult,
    getValidationCandidates: async () => state.validationCandidatesResult,
    getFixCandidates: async () => state.fixCandidatesResult,
  }),
);

const { explainScheduledAgentDispatch } = await import("./scheduled-agent-explain");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = new Date("2026-08-01T10:00:00.000Z"); // Saturday, hour 10 UTC

const baseConfig: ExplainableConfig = {
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
} as ExplainableConfig;

const gateOf = (
  gates: Array<{ gate: string; passed: boolean; detail: string }>,
  name: string,
) => gates.find((g) => g.gate === name);

describe("explainScheduledAgentDispatch", () => {
  beforeEach(() => {
    resetState();
  });

  afterAll(() => {
    restoreRealModules();
  });

  it("blocks on paused-until when the agent is paused into the future", async () => {
    state.configById = { ...baseConfig, pausedUntil: new Date("2026-08-01T12:00:00.000Z") };

    const [explanation] = await explainScheduledAgentDispatch({
      workspaceId: "workspace-1",
      configId: "config-1",
      now: NOW,
    });

    expect(explanation).toBeDefined();
    expect(explanation!.verdict).toBe("blocked");
    expect(explanation!.blockedBy).toBe("paused-until");

    expect(gateOf(explanation!.gates, "enabled")?.passed).toBe(true);
    expect(gateOf(explanation!.gates, "trigger")?.passed).toBe(true);
    expect(gateOf(explanation!.gates, "schedule-type")?.passed).toBe(true);

    const pausedGate = gateOf(explanation!.gates, "paused-until");
    expect(pausedGate?.passed).toBe(false);
    expect(pausedGate?.detail).toContain("2026-08-01T12:00:00.000Z");

    // Later gates are still evaluated for maximum diagnostic value.
    expect(gateOf(explanation!.gates, "due")).toBeDefined();
    expect(gateOf(explanation!.gates, "quota")).toBeDefined();
    expect(gateOf(explanation!.gates, "mode")?.passed).toBe(true);
  });

  it("reports the next due time when a time-window agent is not due yet", async () => {
    state.configById = {
      ...baseConfig,
      // Outside the window at NOW (hour 10); next window opens at 20:00 UTC.
      scheduleConfig: { startHour: 20, endHour: 22, daysOfWeek: [] },
    };

    const [explanation] = await explainScheduledAgentDispatch({
      workspaceId: "workspace-1",
      configId: "config-1",
      now: NOW,
    });

    expect(explanation!.verdict).toBe("blocked");
    expect(explanation!.blockedBy).toBe("due");

    const dueGate = gateOf(explanation!.gates, "due");
    expect(dueGate?.passed).toBe(false);
    expect(dueGate?.detail).toContain("2026-08-01T20:00:00.000Z");
    expect(dueGate?.detail).toContain("No toca todavía");
  });

  it("blocks on board-columns when the target board has no column with role 'backlog'", async () => {
    state.configById = {
      ...baseConfig,
      jobType: "implementation",
      projectId: "project-1",
      targetConfig: { backlogDrain: { enabled: true } },
    };
    state.projects = [{ id: "project-1", name: "Flatzer" }];
    state.backlogDrainWorkItems = [
      {
        id: "wi-1",
        taskId: "MC-1",
        title: "Some backlog task",
        type: "task",
        parentId: null,
        projectId: "project-1",
        boardId: "board-1",
        columnRole: "other",
        columnIsDone: false,
      },
    ];
    state.boards = [
      {
        id: "board-1",
        name: "Desarrollo",
        columns: [
          { name: "Backlog", role: "other" },
          { name: "En curso", role: "other" },
        ],
      },
    ];

    const [explanation] = await explainScheduledAgentDispatch({
      workspaceId: "workspace-1",
      configId: "config-1",
      now: NOW,
    });

    expect(explanation!.verdict).toBe("blocked");
    expect(explanation!.blockedBy).toBe("board-columns");

    const rulesGate = gateOf(explanation!.gates, "project-rules");
    expect(rulesGate?.passed).toBe(true);
    expect(rulesGate?.detail).toContain("Flatzer");

    const boardGate = gateOf(explanation!.gates, "board-columns");
    expect(boardGate?.passed).toBe(false);
    expect(boardGate?.detail).toContain("el tablero 'Desarrollo' no tiene ninguna columna con role 'backlog'");
    expect(boardGate?.detail).toContain("Backlog(other)");
    expect(boardGate?.detail).toContain("En curso(other)");
    expect(boardGate?.detail).toContain("El filtro es por ROLE, no por nombre de columna");
  });

  it("blocks on project-rules when every explicit project rule is disabled", async () => {
    state.configById = {
      ...baseConfig,
      jobType: "implementation",
      projectId: null,
      targetConfig: {
        backlogDrain: {
          enabled: true,
          projects: [
            { projectId: "project-1", enabled: false },
            { projectId: "project-2", enabled: false },
          ],
        },
      },
    };
    state.projects = [
      { id: "project-1", name: "Alpha" },
      { id: "project-2", name: "Beta" },
    ];

    const [explanation] = await explainScheduledAgentDispatch({
      workspaceId: "workspace-1",
      configId: "config-1",
      now: NOW,
    });

    expect(explanation!.verdict).toBe("blocked");
    expect(explanation!.blockedBy).toBe("project-rules");

    const rulesGate = gateOf(explanation!.gates, "project-rules");
    expect(rulesGate?.passed).toBe(false);
    expect(rulesGate?.detail).toContain("Alpha");
    expect(rulesGate?.detail).toContain("Beta");
    expect(rulesGate?.detail).toContain("enabled=false");

    // Zero projects in scope also means board-columns has nothing to check.
    const boardGate = gateOf(explanation!.gates, "board-columns");
    expect(boardGate?.passed).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 'once' due gate (issue T2.2) — the three narrated states.
  // ---------------------------------------------------------------------------

  it("'once' — reports 'aún no toca' when runAt is still in the future", async () => {
    state.configById = {
      ...baseConfig,
      scheduleType: "once",
      scheduleConfig: { runAt: "2026-08-01T20:00:00.000Z" },
      enabled: true,
      lastRunAt: null,
    };

    const [explanation] = await explainScheduledAgentDispatch({
      workspaceId: "workspace-1",
      configId: "config-1",
      now: NOW,
    });

    expect(explanation!.verdict).toBe("blocked");
    expect(explanation!.blockedBy).toBe("due");
    const dueGate = gateOf(explanation!.gates, "due");
    expect(dueGate?.passed).toBe(false);
    expect(dueGate?.detail).toContain("No toca todavía");
    expect(dueGate?.detail).toContain("2026-08-01T20:00:00.000Z");
  });

  it("'once' — reports 'toca ahora' when runAt has passed and the agent is still enabled", async () => {
    state.configById = {
      ...baseConfig,
      scheduleType: "once",
      scheduleConfig: { runAt: "2026-08-01T09:00:00.000Z" },
      enabled: true,
      lastRunAt: null,
    };

    const [explanation] = await explainScheduledAgentDispatch({
      workspaceId: "workspace-1",
      configId: "config-1",
      now: NOW,
    });

    const dueGate = gateOf(explanation!.gates, "due");
    expect(dueGate?.passed).toBe(true);
    expect(dueGate?.detail).toContain("Toca ahora");
    expect(dueGate?.detail).toContain("2026-08-01T09:00:00.000Z");
  });

  it("'once' — reports 'ya ejecutado' when runAt has passed and the config auto-disabled after dispatch", async () => {
    state.configById = {
      ...baseConfig,
      scheduleType: "once",
      scheduleConfig: { runAt: "2026-08-01T09:00:00.000Z" },
      enabled: false,
      lastRunAt: new Date("2026-08-01T09:00:05.000Z"),
    };

    const [explanation] = await explainScheduledAgentDispatch({
      workspaceId: "workspace-1",
      configId: "config-1",
      now: NOW,
    });

    // The 'enabled' gate is still the FIRST failing gate in gate order.
    expect(explanation!.verdict).toBe("blocked");
    expect(explanation!.blockedBy).toBe("enabled");
    expect(gateOf(explanation!.gates, "enabled")?.passed).toBe(false);

    // But the 'due' gate's own detail explains WHY: already fired once.
    const dueGate = gateOf(explanation!.gates, "due");
    expect(dueGate?.passed).toBe(false);
    expect(dueGate?.detail).toContain("Ya ejecutado");
    expect(dueGate?.detail).toContain("2026-08-01T09:00:05.000Z");
  });

  it("'once' — an empty scheduleConfig fails the due gate with a clear message", async () => {
    state.configById = {
      ...baseConfig,
      scheduleType: "once",
      scheduleConfig: {} as never,
      enabled: true,
    };

    const [explanation] = await explainScheduledAgentDispatch({
      workspaceId: "workspace-1",
      configId: "config-1",
      now: NOW,
    });

    const dueGate = gateOf(explanation!.gates, "due");
    expect(dueGate?.passed).toBe(false);
    expect(dueGate?.detail).toContain("runAt");
  });

  it("would-dispatch when every gate passes (standalone mode, listed via workspace scan)", async () => {
    state.configsByWorkspace = [{ ...baseConfig, skillName: null }];
    state.quotaResult = { allowed: true };

    const explanations = await explainScheduledAgentDispatch({
      workspaceId: "workspace-1",
      now: NOW,
    });

    expect(explanations).toHaveLength(1);
    const explanation = explanations[0]!;
    expect(explanation.verdict).toBe("would-dispatch");
    expect(explanation.blockedBy).toBeNull();
    for (const gate of explanation.gates) {
      expect(gate.passed).toBe(true);
    }
    expect(gateOf(explanation.gates, "mode")?.detail).toContain("standalone");
  });

  // ---------------------------------------------------------------------------
  // Contract pin: gate 7 ("mode") must report the EXACT SAME automation
  // `resolveEnabledBuiltinAutomation` (the dispatcher's own resolver, from
  // @almirant/shared's builtin-automations catalog) would pick, including its
  // precedence when multiple built-in flags are enabled simultaneously. Before
  // this module delegated to that shared resolver, its `resolveMode` kept an
  // independent copy of the if/else-if precedence ladder — this test is what
  // would have caught that copy silently drifting from the dispatcher's real
  // routing.
  //
  // Nested INSIDE the outer describe (rather than a sibling top-level
  // describe) so it shares the outer block's mock.module lifecycle — the
  // outer `afterAll(() => restoreRealModules())` above only fires once, after
  // every test in this block (including these) has run. A sibling describe
  // declared after the outer one would see @almirant/database already
  // restored to its REAL implementation by the time these tests execute.
  // ---------------------------------------------------------------------------
  const scenarios: Array<{
    label: string;
    targetConfig: Record<string, { enabled: boolean }>;
  }> = [
    {
      label: "all four flags enabled — backlogDrain has the lowest dispatchPrecedence and must win",
      targetConfig: {
        backlogDrain: { enabled: true },
        dodRemediation: { enabled: true },
        dodReview: { enabled: true },
        releaseIntegration: { enabled: true },
      },
    },
    {
      label: "backlogDrain off, the rest enabled — dodRemediation must win",
      targetConfig: {
        backlogDrain: { enabled: false },
        dodRemediation: { enabled: true },
        dodReview: { enabled: true },
        releaseIntegration: { enabled: true },
      },
    },
    {
      label: "only dodReview and releaseIntegration enabled — dodReview must win",
      targetConfig: {
        backlogDrain: { enabled: false },
        dodRemediation: { enabled: false },
        dodReview: { enabled: true },
        releaseIntegration: { enabled: true },
      },
    },
    {
      label: "only releaseIntegration enabled",
      targetConfig: {
        backlogDrain: { enabled: false },
        dodRemediation: { enabled: false },
        dodReview: { enabled: false },
        releaseIntegration: { enabled: true },
      },
    },
  ];

  it.each(scenarios)(
    "reports the same active mode resolveEnabledBuiltinAutomation resolves ($label)",
    async ({ targetConfig }) => {
      const expectedAutomation = resolveEnabledBuiltinAutomation(targetConfig);
      expect(expectedAutomation).toBeDefined();

      state.configById = {
        ...baseConfig,
        jobType: "implementation",
        targetConfig,
      };

      const [explanation] = await explainScheduledAgentDispatch({
        workspaceId: "workspace-1",
        configId: "config-1",
        now: NOW,
      });

      const modeGate = gateOf(explanation!.gates, "mode");
      expect(modeGate).toBeDefined();
      // describeMode's switch is keyed by the ACTUAL mode value resolveMode
      // returns, so asserting the target automation's key appears in the
      // detail string is a direct read of what resolveMode computed — not
      // just a static description lookup.
      expect(modeGate!.detail).toContain(expectedAutomation!.targetConfigKey);
    },
  );
});
