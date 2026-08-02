import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { DuplicateSystemAutomationConfigError } from "@almirant/database";
import { createDatabaseMocks, restoreRealModules } from "../../../test/mocks";

// ---------------------------------------------------------------------------
// dev-flow-provisioning (issue #230) — idempotent per-project provisioning of
// the four built-in automations (backlog drain, DoD remediation, DoD review,
// release integration) as `managedBy='system'` scheduled_agent_configs rows.
// ---------------------------------------------------------------------------

const WORKSPACE_ID = "org-test-1";
const PROJECT_ID = "proj-test-1";

type FakeConfig = {
  id: string;
  workspaceId: string;
  projectId: string | null;
  ownerUserId: string | null;
  managedBy: "user" | "system";
  builtinAutomationId: string | null;
  targetConfig: Record<string, unknown>;
  enabled: boolean;
  lastRunAt: string | null;
  codingAgent: string | null;
  aiProvider: string | null;
  aiModel: string | null;
  reasoningLevel: string | null;
  jobType: string;
  provider: string;
  [key: string]: unknown;
};

const state = {
  // Backing store for listScheduledAgentConfigsByWorkspace, keyed by id.
  configs: [] as FakeConfig[],
  createCalls: [] as Array<Record<string, unknown>>,
  updateCalls: [] as Array<{ id: string; workspaceId: string; input: Record<string, unknown> }>,
  deleteCalls: [] as string[],
  createThrowOnceForAutomationId: null as string | null,
  nextId: 1,
};

const resetState = () => {
  state.configs = [];
  state.createCalls = [];
  state.updateCalls = [];
  state.deleteCalls = [];
  state.createThrowOnceForAutomationId = null;
  state.nextId = 1;
};

const dbMocks = createDatabaseMocks({
  listScheduledAgentConfigsByWorkspace: async (
    workspaceId: string,
    filters?: { projectId?: string },
  ) => {
    return state.configs.filter(
      (config) =>
        config.workspaceId === workspaceId &&
        (!filters?.projectId || config.projectId === filters.projectId),
    );
  },
  createScheduledAgentConfig: async (input: Record<string, unknown>) => {
    state.createCalls.push(input);
    const automationId = input.builtinAutomationId as string | null;
    if (automationId && state.createThrowOnceForAutomationId === automationId) {
      // Only throw once — simulates "the race already happened; a retry via
      // update should succeed". Also plant the "winning" concurrent writer's
      // row so the service's re-read-and-update retry has something to find.
      state.createThrowOnceForAutomationId = null;
      state.configs.push({
        id: "cfg-system-raced",
        workspaceId: input.workspaceId as string,
        projectId: (input.projectId as string) ?? null,
        ownerUserId: null,
        managedBy: "system",
        builtinAutomationId: automationId,
        targetConfig: { [automationId === "backlog-drain" ? "backlogDrain" : automationId]: { enabled: true } },
        enabled: false,
        lastRunAt: null,
        codingAgent: null,
        aiProvider: null,
        aiModel: null,
        reasoningLevel: null,
        jobType: input.jobType as string,
        provider: input.provider as string,
      });
      throw new DuplicateSystemAutomationConfigError(
        (input.projectId as string) ?? null,
        automationId,
      );
    }
    const created: FakeConfig = {
      id: `cfg-system-${state.nextId++}`,
      workspaceId: input.workspaceId as string,
      projectId: (input.projectId as string) ?? null,
      ownerUserId: (input.ownerUserId as string) ?? null,
      managedBy: (input.managedBy as "user" | "system") ?? "user",
      builtinAutomationId: automationId,
      targetConfig: (input.targetConfig as Record<string, unknown>) ?? {},
      enabled: Boolean(input.enabled),
      lastRunAt: null,
      codingAgent: (input.codingAgent as string) ?? null,
      aiProvider: (input.aiProvider as string) ?? null,
      aiModel: (input.aiModel as string) ?? null,
      reasoningLevel: (input.reasoningLevel as string) ?? null,
      jobType: input.jobType as string,
      provider: input.provider as string,
    };
    state.configs.push(created);
    return created;
  },
  updateScheduledAgentConfig: async (
    id: string,
    workspaceId: string,
    input: Record<string, unknown>,
  ) => {
    state.updateCalls.push({ id, workspaceId, input });
    const existing = state.configs.find((config) => config.id === id && config.workspaceId === workspaceId);
    if (!existing) return undefined;
    Object.assign(existing, input);
    return existing;
  },
  deleteScheduledAgentConfig: async (id: string) => {
    state.deleteCalls.push(id);
    state.configs = state.configs.filter((config) => config.id !== id);
    return true;
  },
});

mock.module("@almirant/database", () => dbMocks);

const {
  provisionDevFlowForProject,
  getDevFlowStatus,
  adoptDevFlowAutomation,
  DevFlowAutomationNotConflictedError,
} = await import("./dev-flow-provisioning");

const ALL_AUTOMATION_IDS = ["backlog-drain", "dod-remediation", "dod-review", "release-integration"];

describe("dev-flow-provisioning", () => {
  beforeEach(() => {
    resetState();
  });

  it("provisions all four built-in automations as system-managed configs when none exist yet", async () => {
    const result = await provisionDevFlowForProject({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      devFlow: { enabled: true, codingAgent: "claude-code", aiProvider: "anthropic", model: "claude-opus-4-8" },
      actorUserId: "user-1",
    });

    expect(state.createCalls).toHaveLength(4);
    expect(state.createCalls.every((call) => call.managedBy === "system")).toBe(true);
    expect(state.createCalls.every((call) => call.projectId === PROJECT_ID)).toBe(true);
    expect(state.createCalls.every((call) => call.enabled === true)).toBe(true);
    expect(
      state.createCalls.map((call) => call.builtinAutomationId).sort(),
    ).toEqual([...ALL_AUTOMATION_IDS].sort());

    expect(result.automations).toHaveLength(4);
    expect(result.skippedExistingUserAgents).toEqual([]);
    for (const automation of result.automations) {
      expect(automation.configId).not.toBeNull();
      expect(automation.enabled).toBe(true);
      expect(automation.managedBy).toBe("system");
    }
  });

  it("stamps each automation's own targetConfig mode key with enabled:true, distinct from the row-level enabled flag", async () => {
    await provisionDevFlowForProject({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      devFlow: { enabled: false },
      actorUserId: "user-1",
    });

    const backlogDrainCall = state.createCalls.find((call) => call.builtinAutomationId === "backlog-drain");
    expect(backlogDrainCall?.enabled).toBe(false);
    expect((backlogDrainCall?.targetConfig as Record<string, unknown>).backlogDrain).toMatchObject({
      enabled: true,
    });
  });

  it("is idempotent: calling it twice with the same input updates the existing four rows instead of duplicating them", async () => {
    await provisionDevFlowForProject({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      devFlow: { enabled: true, codingAgent: "claude-code" },
      actorUserId: "user-1",
    });
    const idsAfterFirstCall = state.configs.map((c) => c.id).sort();

    const result = await provisionDevFlowForProject({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      devFlow: { enabled: true, codingAgent: "codex", aiProvider: "openai" },
      actorUserId: "user-1",
    });

    expect(state.createCalls).toHaveLength(4); // no new creates on the 2nd call
    expect(state.updateCalls).toHaveLength(4);
    expect(state.configs).toHaveLength(4); // still exactly 4 rows, no duplicates
    expect(state.configs.map((c) => c.id).sort()).toEqual(idsAfterFirstCall);
    expect(state.configs.every((c) => c.codingAgent === "codex")).toBe(true);
    expect(result.automations.every((a) => a.configId !== null)).toBe(true);
  });

  it("disabling devFlow flips enabled=false on all four existing rows without deleting them", async () => {
    await provisionDevFlowForProject({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      devFlow: { enabled: true },
      actorUserId: "user-1",
    });
    expect(state.configs.every((c) => c.enabled === true)).toBe(true);

    const result = await provisionDevFlowForProject({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      devFlow: { enabled: false },
      actorUserId: "user-1",
    });

    expect(state.deleteCalls).toEqual([]);
    expect(state.configs).toHaveLength(4);
    expect(state.configs.every((c) => c.enabled === false)).toBe(true);
    expect(result.automations.every((a) => a.enabled === false)).toBe(true);
    expect(result.automations.every((a) => a.configId !== null)).toBe(true);
  });

  it("does not create (or touch) a system config for a mode already active on an existing user-owned agent for this project, and reports it", async () => {
    state.configs.push({
      id: "cfg-user-backlog-drain",
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      ownerUserId: "user-1",
      managedBy: "user",
      builtinAutomationId: null,
      targetConfig: { backlogDrain: { enabled: true } },
      enabled: true,
      lastRunAt: null,
      codingAgent: null,
      aiProvider: null,
      aiModel: null,
      reasoningLevel: null,
      jobType: "implementation",
      provider: "claude-code",
    });

    const result = await provisionDevFlowForProject({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      devFlow: { enabled: true },
      actorUserId: "user-1",
    });

    expect(state.createCalls.map((call) => call.builtinAutomationId)).not.toContain("backlog-drain");
    expect(state.createCalls).toHaveLength(3); // the other three automations still get provisioned

    expect(result.skippedExistingUserAgents).toEqual([
      { configId: "cfg-user-backlog-drain", automationId: "backlog-drain" },
    ]);
    const backlogDrainStatus = result.automations.find((a) => a.automationId === "backlog-drain");
    expect(backlogDrainStatus?.configId).toBeNull();
    expect(backlogDrainStatus?.managedBy).toBeNull();
    expect(backlogDrainStatus?.skippedForExistingUserAgent).toBe(true);
  });

  it("Fix 3 (review): a disabled user-owned config does not count as a conflict even if its targetConfig mode flag is still enabled:true", async () => {
    // Disabling a user's own scheduled agent (config.enabled=false) does NOT
    // by itself clear its targetConfig.<mode>.enabled flag — plain disables
    // through the generic scheduled-agent routes only ever touch the
    // top-level `enabled` column. Either way, a disabled agent isn't actually
    // running, so it must not be treated as "already covering" the
    // automation — conflict detection must require BOTH signals.
    state.configs.push({
      id: "cfg-user-backlog-drain-disabled",
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      ownerUserId: "user-1",
      managedBy: "user",
      builtinAutomationId: null,
      targetConfig: { backlogDrain: { enabled: true } },
      enabled: false,
      lastRunAt: null,
      codingAgent: null,
      aiProvider: null,
      aiModel: null,
      reasoningLevel: null,
      jobType: "implementation",
      provider: "claude-code",
    });

    const result = await provisionDevFlowForProject({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      devFlow: { enabled: true },
      actorUserId: "user-1",
    });

    expect(result.skippedExistingUserAgents).toEqual([]);
    expect(state.createCalls.map((call) => call.builtinAutomationId)).toContain("backlog-drain");
  });

  it("Fix 2 (review): a conflict that arrives AFTER a system row was already provisioned must disable that row, not leave it silently enabled forever", async () => {
    // 1. Provision normally: backlog-drain gets a system-managed row,
    //    enabled=true, like any other successful first provisioning.
    const firstResult = await provisionDevFlowForProject({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      devFlow: { enabled: true },
      actorUserId: "user-1",
    });
    const backlogDrainId = firstResult.automations.find(
      (a) => a.automationId === "backlog-drain",
    )?.configId;
    expect(backlogDrainId).toBeTruthy();
    expect(state.configs.find((c) => c.id === backlogDrainId)?.enabled).toBe(true);

    // 2. A conflict shows up AFTER the fact: the user creates their own
    //    backlog-drain-activating agent for this exact project.
    state.configs.push({
      id: "cfg-user-backlog-drain-late",
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      ownerUserId: "user-1",
      managedBy: "user",
      builtinAutomationId: null,
      targetConfig: { backlogDrain: { enabled: true } },
      enabled: true,
      lastRunAt: null,
      codingAgent: null,
      aiProvider: null,
      aiModel: null,
      reasoningLevel: null,
      jobType: "implementation",
      provider: "claude-code",
    });
    state.updateCalls = [];
    state.createCalls = [];

    // 3. Re-provisioning (e.g. the user re-saves the project's AI config)
    //    must now report the conflict AND force the stale system row off —
    //    it must never be left enabled=true forever, and its real state
    //    (configId, managedBy) must be reported, not hidden as "never
    //    provisioned".
    const result = await provisionDevFlowForProject({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      devFlow: { enabled: true },
      actorUserId: "user-1",
    });

    expect(state.createCalls).toHaveLength(0); // no new system row created for backlog-drain
    const disableCall = state.updateCalls.find((call) => call.id === backlogDrainId);
    expect(disableCall).toBeTruthy();
    expect(disableCall?.input).toMatchObject({ enabled: false });

    const persistedSystemRow = state.configs.find((c) => c.id === backlogDrainId);
    expect(persistedSystemRow?.enabled).toBe(false);
    expect(persistedSystemRow?.managedBy).toBe("system");

    const backlogDrainStatus = result.automations.find((a) => a.automationId === "backlog-drain");
    // The row's REAL state must be reported — not the "never provisioned"
    // (configId: null) shape the buggy version reported.
    expect(backlogDrainStatus?.configId).toBe(backlogDrainId);
    expect(backlogDrainStatus?.managedBy).toBe("system");
    expect(backlogDrainStatus?.enabled).toBe(false);
    expect(backlogDrainStatus?.skippedForExistingUserAgent).toBe(true);

    expect(result.skippedExistingUserAgents).toEqual([
      { configId: "cfg-user-backlog-drain-late", automationId: "backlog-drain" },
    ]);

    // The other three automations are unaffected.
    expect(state.configs.filter((c) => c.managedBy === "system" && c.enabled)).toHaveLength(3);
  });

  it("Fix 2 (review): a conflict where no system row was EVER provisioned still reports configId: null (no spurious update)", async () => {
    state.configs.push({
      id: "cfg-user-backlog-drain",
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      ownerUserId: "user-1",
      managedBy: "user",
      builtinAutomationId: null,
      targetConfig: { backlogDrain: { enabled: true } },
      enabled: true,
      lastRunAt: null,
      codingAgent: null,
      aiProvider: null,
      aiModel: null,
      reasoningLevel: null,
      jobType: "implementation",
      provider: "claude-code",
    });

    const result = await provisionDevFlowForProject({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      devFlow: { enabled: true },
      actorUserId: "user-1",
    });

    expect(state.updateCalls).toEqual([]);
    const backlogDrainStatus = result.automations.find((a) => a.automationId === "backlog-drain");
    expect(backlogDrainStatus?.configId).toBeNull();
    expect(backlogDrainStatus?.managedBy).toBeNull();
    expect(backlogDrainStatus?.skippedForExistingUserAgent).toBe(true);
  });

  it("Fix 2 (review): a conflict against a system row that was ALREADY disabled does not issue a redundant update", async () => {
    // System row provisioned, then dev-flow disabled (existing "disable"
    // flow) — the row is already enabled=false before the conflict appears.
    await provisionDevFlowForProject({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      devFlow: { enabled: false },
      actorUserId: "user-1",
    });
    const backlogDrainId = state.configs.find((c) => c.builtinAutomationId === "backlog-drain")?.id;
    expect(state.configs.find((c) => c.id === backlogDrainId)?.enabled).toBe(false);

    state.configs.push({
      id: "cfg-user-backlog-drain-late-2",
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      ownerUserId: "user-1",
      managedBy: "user",
      builtinAutomationId: null,
      targetConfig: { backlogDrain: { enabled: true } },
      enabled: true,
      lastRunAt: null,
      codingAgent: null,
      aiProvider: null,
      aiModel: null,
      reasoningLevel: null,
      jobType: "implementation",
      provider: "claude-code",
    });
    state.updateCalls = [];

    const result = await provisionDevFlowForProject({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      devFlow: { enabled: true },
      actorUserId: "user-1",
    });

    // Already disabled — no need to write again.
    expect(state.updateCalls.some((call) => call.id === backlogDrainId)).toBe(false);
    const backlogDrainStatus = result.automations.find((a) => a.automationId === "backlog-drain");
    expect(backlogDrainStatus?.configId).toBe(backlogDrainId);
    expect(backlogDrainStatus?.enabled).toBe(false);
    expect(backlogDrainStatus?.managedBy).toBe("system");
  });

  it("recovers from a concurrent-provisioning race: a duplicate-create error re-reads and updates the winning row instead of failing", async () => {
    // Simulate: another concurrent call creates the backlog-drain system
    // config for this project in the window between our read and our
    // insert — our insert loses the race and must fall back to updating
    // the row the other writer created, not raise an error.
    state.createThrowOnceForAutomationId = "backlog-drain";

    const result = await provisionDevFlowForProject({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      devFlow: { enabled: true, codingAgent: "claude-code" },
      actorUserId: "user-1",
    });

    // No duplicate row: the raced-in config plus the update, not a second create.
    expect(state.configs.filter((c) => c.builtinAutomationId === "backlog-drain")).toHaveLength(1);
    expect(state.configs.find((c) => c.id === "cfg-system-raced")?.enabled).toBe(true);
    expect(state.configs.find((c) => c.id === "cfg-system-raced")?.codingAgent).toBe("claude-code");
    expect(state.updateCalls.some((call) => call.id === "cfg-system-raced")).toBe(true);

    const backlogDrainStatus = result.automations.find((a) => a.automationId === "backlog-drain");
    expect(backlogDrainStatus?.configId).toBe("cfg-system-raced");
    expect(backlogDrainStatus?.enabled).toBe(true);
  });

  it("getDevFlowStatus is read-only and reflects persisted state without writing", async () => {
    state.configs.push({
      id: "cfg-system-existing",
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      ownerUserId: null,
      managedBy: "system",
      builtinAutomationId: "dod-review",
      targetConfig: { dodReview: { enabled: true } },
      enabled: true,
      lastRunAt: "2026-07-01T00:00:00.000Z",
      codingAgent: null,
      aiProvider: null,
      aiModel: null,
      reasoningLevel: null,
      jobType: "review",
      provider: "claude-code",
    });

    const result = await getDevFlowStatus({ workspaceId: WORKSPACE_ID, projectId: PROJECT_ID });

    expect(state.createCalls).toEqual([]);
    expect(state.updateCalls).toEqual([]);
    const dodReview = result.automations.find((a) => a.automationId === "dod-review");
    expect(dodReview?.configId).toBe("cfg-system-existing");
    expect(dodReview?.enabled).toBe(true);
    expect(dodReview?.lastRunAt).toBe("2026-07-01T00:00:00.000Z");
    const backlogDrain = result.automations.find((a) => a.automationId === "backlog-drain");
    expect(backlogDrain?.configId).toBeNull();
    expect(result.skippedExistingUserAgents).toEqual([]);
  });

  it("getDevFlowStatus surfaces conflicting user-owned agents even when dev-flow was never provisioned", async () => {
    state.configs.push({
      id: "cfg-user-release-integration",
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      ownerUserId: "user-1",
      managedBy: "user",
      builtinAutomationId: null,
      targetConfig: { releaseIntegration: { enabled: true } },
      enabled: true,
      lastRunAt: null,
      codingAgent: null,
      aiProvider: null,
      aiModel: null,
      reasoningLevel: null,
      jobType: "integration",
      provider: "claude-code",
    });

    const result = await getDevFlowStatus({ workspaceId: WORKSPACE_ID, projectId: PROJECT_ID });

    expect(result.skippedExistingUserAgents).toEqual([
      { configId: "cfg-user-release-integration", automationId: "release-integration" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Per-automation config (issue #235): each of the 4 built-ins can override
// runtime (codingAgent/aiProvider/model/reasoningLevel), concurrency and
// schedule independently, inheriting from the card-level devFlow defaults
// when a field is absent. Provisioning writes the EFFECTIVE (merged) values
// to each row on every call — create AND update — so a later save actually
// changes an already-provisioned row's schedule/runtime, not just at
// creation time.
// ---------------------------------------------------------------------------

describe("dev-flow-provisioning — per-automation overrides (issue #235)", () => {
  beforeEach(() => {
    resetState();
  });

  it("writes the automation's own runtime override instead of the card default when present", async () => {
    await provisionDevFlowForProject({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      devFlow: {
        enabled: true,
        codingAgent: "claude-code",
        aiProvider: "anthropic",
        model: "claude-opus-4-8",
        automations: {
          "dod-review": { codingAgent: "opencode", aiProvider: "zai", model: "glm-5.2", reasoningLevel: "max" },
        },
      },
      actorUserId: "user-1",
    });

    const dodReviewCall = state.createCalls.find((call) => call.builtinAutomationId === "dod-review");
    expect(dodReviewCall?.codingAgent).toBe("opencode");
    expect(dodReviewCall?.aiProvider).toBe("zai");
    expect(dodReviewCall?.aiModel).toBe("glm-5.2");
    expect(dodReviewCall?.reasoningLevel).toBe("max");

    // Untouched automations keep inheriting the card-level default.
    const backlogDrainCall = state.createCalls.find((call) => call.builtinAutomationId === "backlog-drain");
    expect(backlogDrainCall?.codingAgent).toBe("claude-code");
    expect(backlogDrainCall?.aiProvider).toBe("anthropic");
    expect(backlogDrainCall?.aiModel).toBe("claude-opus-4-8");
    expect(backlogDrainCall?.reasoningLevel).toBeFalsy();
  });

  it("writes the automation's own schedule override instead of the default cron expression/timezone", async () => {
    await provisionDevFlowForProject({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      devFlow: {
        enabled: true,
        automations: {
          "release-integration": { schedule: { expression: "0 9 * * 1-5", timezone: "America/New_York" } },
        },
      },
      actorUserId: "user-1",
    });

    const releaseCall = state.createCalls.find((call) => call.builtinAutomationId === "release-integration");
    expect(releaseCall?.scheduleType).toBe("cron");
    expect(releaseCall?.scheduleConfig).toEqual({ expression: "0 9 * * 1-5" });
    expect(releaseCall?.timezone).toBe("America/New_York");

    // Untouched automations keep the default cron expression/timezone.
    const backlogDrainCall = state.createCalls.find((call) => call.builtinAutomationId === "backlog-drain");
    expect(backlogDrainCall?.scheduleType).toBe("cron");
    expect(backlogDrainCall?.scheduleConfig).toEqual({ expression: "*/5 * * * *" });
    expect(backlogDrainCall?.timezone).toBe("Europe/Madrid");
  });

  it("re-writes the effective schedule on an UPDATE too, not only at creation", async () => {
    await provisionDevFlowForProject({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      devFlow: { enabled: true },
      actorUserId: "user-1",
    });
    const backlogDrainId = state.configs.find((c) => c.builtinAutomationId === "backlog-drain")?.id;
    state.updateCalls = [];

    await provisionDevFlowForProject({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      devFlow: {
        enabled: true,
        automations: { "backlog-drain": { schedule: { expression: "*/10 * * * *", timezone: "UTC" } } },
      },
      actorUserId: "user-1",
    });

    const backlogDrainUpdate = state.updateCalls.find((call) => call.id === backlogDrainId);
    expect(backlogDrainUpdate?.input.scheduleConfig).toEqual({ expression: "*/10 * * * *" });
    expect(backlogDrainUpdate?.input.timezone).toBe("UTC");
  });

  it("per-automation enabled:false keeps that one automation off even with the master flag on", async () => {
    await provisionDevFlowForProject({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      devFlow: {
        enabled: true,
        automations: { "dod-remediation": { enabled: false } },
      },
      actorUserId: "user-1",
    });

    const dodRemediationCall = state.createCalls.find((call) => call.builtinAutomationId === "dod-remediation");
    expect(dodRemediationCall?.enabled).toBe(false);
    const backlogDrainCall = state.createCalls.find((call) => call.builtinAutomationId === "backlog-drain");
    expect(backlogDrainCall?.enabled).toBe(true);
  });

  it("master enabled:false turns all four off even when one automation explicitly overrides enabled:true", async () => {
    await provisionDevFlowForProject({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      devFlow: {
        enabled: false,
        automations: { "dod-remediation": { enabled: true } },
      },
      actorUserId: "user-1",
    });

    const dodRemediationCall = state.createCalls.find((call) => call.builtinAutomationId === "dod-remediation");
    expect(dodRemediationCall?.enabled).toBe(false);
  });

  it("per-automation maxConcurrentJobs override wins over the card default", async () => {
    await provisionDevFlowForProject({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      devFlow: {
        enabled: true,
        maxConcurrentJobs: 3,
        automations: { "backlog-drain": { maxConcurrentJobs: 7 } },
      },
      actorUserId: "user-1",
    });

    type ModeTargetConfig = { defaultMaxConcurrentJobs?: number };
    const backlogDrainCall = state.createCalls.find((call) => call.builtinAutomationId === "backlog-drain");
    const backlogDrainTargetConfig = backlogDrainCall?.targetConfig as { backlogDrain: ModeTargetConfig };
    expect(backlogDrainTargetConfig.backlogDrain.defaultMaxConcurrentJobs).toBe(7);
    const dodReviewCall = state.createCalls.find((call) => call.builtinAutomationId === "dod-review");
    const dodReviewTargetConfig = dodReviewCall?.targetConfig as { dodReview: ModeTargetConfig };
    expect(dodReviewTargetConfig.dodReview.defaultMaxConcurrentJobs).toBe(3);
  });

  it("is idempotent when re-run with the same per-automation overrides: still exactly 4 rows, updated not duplicated", async () => {
    const devFlow = {
      enabled: true,
      codingAgent: "claude-code" as const,
      automations: {
        "backlog-drain": { schedule: { expression: "*/10 * * * *" } },
        "dod-review": { codingAgent: "opencode" as const, aiProvider: "zai" as const, model: "glm-5.2" },
      },
    };

    await provisionDevFlowForProject({ workspaceId: WORKSPACE_ID, projectId: PROJECT_ID, devFlow, actorUserId: "user-1" });
    const idsAfterFirstCall = state.configs.map((c) => c.id).sort();

    await provisionDevFlowForProject({ workspaceId: WORKSPACE_ID, projectId: PROJECT_ID, devFlow, actorUserId: "user-1" });

    expect(state.configs).toHaveLength(4);
    expect(state.configs.map((c) => c.id).sort()).toEqual(idsAfterFirstCall);
    expect(state.createCalls).toHaveLength(4); // only the first call created rows
  });
});

// ---------------------------------------------------------------------------
// getDevFlowStatus's overrides/effective view (issue #235): `overrides` is
// the raw persisted per-automation override (null when absent), `effective`
// is the computed override-over-card-default merge (including the
// schedule's DEFAULT_CRON_EXPRESSION/timezone fallback) — independent of
// whether a system row was ever actually provisioned.
// ---------------------------------------------------------------------------

describe("getDevFlowStatus — overrides and effective runtime view (issue #235)", () => {
  beforeEach(() => {
    resetState();
  });

  it("returns overrides: null and a card-default-derived effective view for an automation with no override", async () => {
    const result = await getDevFlowStatus({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      devFlow: { enabled: true, codingAgent: "claude-code", aiProvider: "anthropic", model: "claude-opus-4-8" },
    });

    const backlogDrain = result.automations.find((a) => a.automationId === "backlog-drain")!;
    expect(backlogDrain.overrides).toBeNull();
    expect(backlogDrain.effective).toEqual({
      codingAgent: "claude-code",
      aiProvider: "anthropic",
      model: "claude-opus-4-8",
      reasoningLevel: null,
      maxConcurrentJobs: null,
      schedule: { expression: "*/5 * * * *", timezone: "Europe/Madrid" },
    });
  });

  it("returns the raw override plus the merged effective runtime for an automation WITH an override", async () => {
    const result = await getDevFlowStatus({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      devFlow: {
        enabled: true,
        codingAgent: "claude-code",
        aiProvider: "anthropic",
        model: "claude-opus-4-8",
        automations: {
          "dod-review": {
            codingAgent: "opencode",
            aiProvider: "zai",
            model: "glm-5.2",
            schedule: { expression: "0 */2 * * *" },
          },
        },
      },
    });

    const dodReview = result.automations.find((a) => a.automationId === "dod-review")!;
    expect(dodReview.overrides).toEqual({
      enabled: null,
      codingAgent: "opencode",
      aiProvider: "zai",
      model: "glm-5.2",
      reasoningLevel: null,
      maxConcurrentJobs: null,
      schedule: { expression: "0 */2 * * *", timezone: null },
    });
    expect(dodReview.effective).toEqual({
      codingAgent: "opencode",
      aiProvider: "zai",
      model: "glm-5.2",
      reasoningLevel: null,
      maxConcurrentJobs: null,
      schedule: { expression: "0 */2 * * *", timezone: "Europe/Madrid" },
    });
  });

  it("effective falls back to null runtime fields and the default schedule for every automation when devFlow was never configured", async () => {
    const result = await getDevFlowStatus({ workspaceId: WORKSPACE_ID, projectId: PROJECT_ID });

    for (const automation of result.automations) {
      expect(automation.overrides).toBeNull();
      expect(automation.effective).toEqual({
        codingAgent: null,
        aiProvider: null,
        model: null,
        reasoningLevel: null,
        maxConcurrentJobs: null,
        schedule: { expression: "*/5 * * * *", timezone: "Europe/Madrid" },
      });
    }
  });
});

// ---------------------------------------------------------------------------
// adoptDevFlowAutomation (issue #235): the POST /projects/:id/dev-flow/adopt
// service. Disables every conflicting user-owned config covering the given
// automation for this project (still managedBy='user', not deleted) and
// turns the system-managed automation ON with its effective runtime —
// regardless of the project's master devFlow.enabled flag, since adopting
// is an explicit "activate this automation now" action.
// ---------------------------------------------------------------------------

describe("adoptDevFlowAutomation (issue #235)", () => {
  beforeEach(() => {
    resetState();
  });

  it("throws DevFlowAutomationNotConflictedError (409 signal) when there is no conflicting user agent for that automation", async () => {
    await expect(
      adoptDevFlowAutomation({
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
        automationId: "backlog-drain",
        devFlow: { enabled: true },
      }),
    ).rejects.toThrow(DevFlowAutomationNotConflictedError);
  });

  it("disables the conflicting user-owned config (still managedBy user) and enables the system automation, even with the master flag off", async () => {
    state.configs.push({
      id: "cfg-user-backlog-drain",
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      ownerUserId: "user-1",
      managedBy: "user",
      builtinAutomationId: null,
      targetConfig: { backlogDrain: { enabled: true } },
      enabled: true,
      lastRunAt: null,
      codingAgent: null,
      aiProvider: null,
      aiModel: null,
      reasoningLevel: null,
      jobType: "implementation",
      provider: "claude-code",
    });

    const result = await adoptDevFlowAutomation({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      automationId: "backlog-drain",
      devFlow: { enabled: false },
    });

    expect(result.disabledUserConfigIds).toEqual(["cfg-user-backlog-drain"]);
    expect(state.configs.find((c) => c.id === "cfg-user-backlog-drain")?.enabled).toBe(false);
    expect(state.configs.find((c) => c.id === "cfg-user-backlog-drain")?.managedBy).toBe("user");

    expect(result.automation.automationId).toBe("backlog-drain");
    expect(result.automation.enabled).toBe(true);
    expect(result.automation.managedBy).toBe("system");
    expect(result.automation.skippedForExistingUserAgent).toBe(false);
    expect(result.automation.configId).not.toBeNull();
  });

  it("Fix 3 (review): also clears the adopted user config's OWN targetConfig mode flag, keeping the JSONB internally coherent", async () => {
    state.configs.push({
      id: "cfg-user-backlog-drain",
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      ownerUserId: "user-1",
      managedBy: "user",
      builtinAutomationId: null,
      targetConfig: { backlogDrain: { enabled: true } },
      enabled: true,
      lastRunAt: null,
      codingAgent: null,
      aiProvider: null,
      aiModel: null,
      reasoningLevel: null,
      jobType: "implementation",
      provider: "claude-code",
    });

    await adoptDevFlowAutomation({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      automationId: "backlog-drain",
      devFlow: { enabled: true },
    });

    const adoptedUserConfig = state.configs.find((c) => c.id === "cfg-user-backlog-drain");
    expect(adoptedUserConfig?.enabled).toBe(false);
    expect((adoptedUserConfig?.targetConfig as Record<string, unknown>)?.backlogDrain).toMatchObject({
      enabled: false,
    });
  });

  it("Fix 3 (review): the adopted automation survives the NEXT provisioning call instead of being silently re-disabled", async () => {
    state.configs.push({
      id: "cfg-user-backlog-drain",
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      ownerUserId: "user-1",
      managedBy: "user",
      builtinAutomationId: null,
      targetConfig: { backlogDrain: { enabled: true } },
      enabled: true,
      lastRunAt: null,
      codingAgent: null,
      aiProvider: null,
      aiModel: null,
      reasoningLevel: null,
      jobType: "implementation",
      provider: "claude-code",
    });

    await adoptDevFlowAutomation({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      automationId: "backlog-drain",
      devFlow: { enabled: true },
    });

    // Simulates the next PATCH /projects/:id/ai-config (any devFlow save) —
    // must NOT treat the disabled user config as a conflict again and must
    // NOT re-disable the just-adopted system automation.
    const nextResult = await provisionDevFlowForProject({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      devFlow: { enabled: true },
      actorUserId: "user-1",
    });

    const backlogDrainStatus = nextResult.automations.find((a) => a.automationId === "backlog-drain");
    expect(backlogDrainStatus?.enabled).toBe(true);
    expect(backlogDrainStatus?.skippedForExistingUserAgent).toBe(false);
    expect(nextResult.skippedExistingUserAgents).toEqual([]);
  });

  it("disables EVERY conflicting user config covering that automation, not just the first", async () => {
    state.configs.push(
      {
        id: "cfg-user-a",
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
        ownerUserId: "user-1",
        managedBy: "user",
        builtinAutomationId: null,
        targetConfig: { dodReview: { enabled: true } },
        enabled: true,
        lastRunAt: null,
        codingAgent: null,
        aiProvider: null,
        aiModel: null,
        reasoningLevel: null,
        jobType: "review",
        provider: "claude-code",
      },
      {
        id: "cfg-user-b",
        workspaceId: WORKSPACE_ID,
        projectId: null, // workspace-wide scope also covers this project.
        ownerUserId: "user-2",
        managedBy: "user",
        builtinAutomationId: null,
        targetConfig: { dodReview: { enabled: true } },
        enabled: true,
        lastRunAt: null,
        codingAgent: null,
        aiProvider: null,
        aiModel: null,
        reasoningLevel: null,
        jobType: "review",
        provider: "claude-code",
      },
    );

    const result = await adoptDevFlowAutomation({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      automationId: "dod-review",
      devFlow: { enabled: true },
    });

    expect(result.disabledUserConfigIds.sort()).toEqual(["cfg-user-a", "cfg-user-b"]);
  });

  it("upserts (does not duplicate) an already-provisioned-but-disabled system row, forcing it enabled", async () => {
    // First: normal provisioning with master OFF creates the row disabled.
    await provisionDevFlowForProject({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      devFlow: { enabled: false },
      actorUserId: "user-1",
    });
    const existingId = state.configs.find((c) => c.builtinAutomationId === "release-integration")?.id ?? null;
    expect(existingId).toBeTruthy();
    expect(state.configs.find((c) => c.id === existingId)?.enabled).toBe(false);

    // Then: a conflicting user agent shows up, and gets adopted.
    state.configs.push({
      id: "cfg-user-release",
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      ownerUserId: "user-1",
      managedBy: "user",
      builtinAutomationId: null,
      targetConfig: { releaseIntegration: { enabled: true } },
      enabled: true,
      lastRunAt: null,
      codingAgent: null,
      aiProvider: null,
      aiModel: null,
      reasoningLevel: null,
      jobType: "integration",
      provider: "claude-code",
    });

    const result = await adoptDevFlowAutomation({
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      automationId: "release-integration",
      devFlow: { enabled: false },
    });

    expect(state.configs.filter((c) => c.builtinAutomationId === "release-integration")).toHaveLength(1);
    expect(result.automation.configId).toBe(existingId);
    expect(state.configs.find((c) => c.id === existingId)?.enabled).toBe(true);
  });
});

afterAll(() => {
  restoreRealModules();
});
