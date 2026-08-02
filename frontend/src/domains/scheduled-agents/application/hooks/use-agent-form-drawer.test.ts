import { describe, expect, it } from "bun:test";
import {
  buildAgentToolingSelection,
  buildBuiltinAutomationTargetConfig,
  buildOnceScheduleConfig,
  mergeAgentToolingSelectionIntoTargetConfig,
  parseAgentToolingSelection,
  resolveOnceRunAtDefault,
  resolveScheduledAgentSubmitJobType,
  resolveScheduledAgentSubmitProjectId,
  resolveScheduledAgentSubmitProvider,
  resolveScheduledAgentSubmitRuntimeFields,
  scheduledAgentFormSchema,
} from "./use-agent-form-drawer";

const validScheduledAgentFormValues = {
  name: "Definition of Done Review",
  projectId: "",
  prompt: "",
  jobType: "scheduled" as const,
  provider: "claude-code" as const,
  trigger: "scheduled" as const,
  webhookId: undefined,
  webhookToken: undefined,
  webhookUrl: "",
  testWebhookUrl: "",
  skillId: null,
  scheduleType: "manual" as const,
  startHour: 9,
  endHour: 18,
  daysOfWeek: [1, 2, 3, 4, 5],
  cronExpression: "",
  timezone: "Europe/Madrid",
  enabled: false,
  maxJobsPerRun: 10,
  description: "",
  codingAgent: "claude-code" as const,
  aiProvider: "anthropic",
  aiModel: "",
  reasoningLevel: undefined,
  selectedPluginIds: [] as string[],
  selectedMcpServerIds: [] as string[],
  agentKind: "automation" as const,
  automationTargetKind: "builtin" as const,
  builtinAutomationId: "dod-review" as const,
  automationSkillSlug: undefined,
  automationProjectIds: [],
  automationQuietPeriodMinutes: 15,
  backlogDrainEnabled: false,
  backlogDrainProjectIds: [],
  backlogDrainDefaultMaxConcurrentJobs: 2,
  backlogDrainProjectConcurrency: {},
  backlogDrainExcludedWorkItemIds: [],
  backlogDrainExcludeDescendants: true,
};

describe("scheduledAgentFormSchema", () => {
  it("allows all-project Definition of Done review automations", () => {
    const result = scheduledAgentFormSchema.safeParse(validScheduledAgentFormValues);

    expect(result.success).toBe(true);
  });

  it("allows all-project backlog-drain automations", () => {
    const result = scheduledAgentFormSchema.safeParse({
      ...validScheduledAgentFormValues,
      builtinAutomationId: "backlog-drain",
      backlogDrainEnabled: true,
    });

    expect(result.success).toBe(true);
  });

  it("defaults the Agents v2 tooling selection to empty arrays when omitted", () => {
    const withoutSelection: Record<string, unknown> = {
      ...validScheduledAgentFormValues,
    };
    delete withoutSelection.selectedPluginIds;
    delete withoutSelection.selectedMcpServerIds;
    const result = scheduledAgentFormSchema.parse(withoutSelection);

    expect(result.selectedPluginIds).toEqual([]);
    expect(result.selectedMcpServerIds).toEqual([]);
  });
});

describe("agent tooling selection", () => {
  const pluginId = "11111111-1111-1111-1111-111111111111";
  const mcpServerId = "22222222-2222-2222-2222-222222222222";

  it("normalizes and dedupes selected ids, dropping anything that is not a UUID", () => {
    expect(
      buildAgentToolingSelection({
        selectedPluginIds: [pluginId, pluginId],
        selectedMcpServerIds: [mcpServerId, "not-a-uuid"],
      }),
    ).toEqual({
      selectedPluginIds: [pluginId],
      selectedMcpServerIds: [mcpServerId],
    });
  });

  it("merges the selection into targetConfig without deleting existing fields", () => {
    const targetConfig = mergeAgentToolingSelectionIntoTargetConfig(
      {
        projectIds: ["project-1"],
        customFilters: { keep: true },
      },
      { selectedPluginIds: [pluginId], selectedMcpServerIds: [mcpServerId] },
    );

    expect(targetConfig).toEqual({
      projectIds: ["project-1"],
      customFilters: {
        keep: true,
        __agentTooling: {
          selectedPluginIds: [pluginId],
          selectedMcpServerIds: [mcpServerId],
        },
      },
    });
    expect(parseAgentToolingSelection(targetConfig)).toEqual({
      selectedPluginIds: [pluginId],
      selectedMcpServerIds: [mcpServerId],
    });
  });

  it("parses an empty selection for a config that never picked any tooling", () => {
    expect(parseAgentToolingSelection(null)).toEqual({
      selectedPluginIds: [],
      selectedMcpServerIds: [],
    });
    expect(parseAgentToolingSelection({ customFilters: { keep: true } })).toEqual({
      selectedPluginIds: [],
      selectedMcpServerIds: [],
    });
  });
});

describe("resolveScheduledAgentSubmitJobType", () => {
  it("forces implementation for built-in (backlog drain) automation", () => {
    expect(
      resolveScheduledAgentSubmitJobType({
        agentKind: "automation",
        automationTargetKind: "builtin",
        builtinAutomationId: "backlog-drain",
        jobType: "scheduled",
      }),
    ).toBe("implementation");
  });

  it("forces implementation for built-in DoD remediation automation", () => {
    expect(
      resolveScheduledAgentSubmitJobType({
        agentKind: "automation",
        automationTargetKind: "builtin",
        builtinAutomationId: "dod-remediation",
        jobType: "scheduled",
      }),
    ).toBe("implementation");
  });

  it("uses scheduled job type for user-skill automation", () => {
    expect(
      resolveScheduledAgentSubmitJobType({
        agentKind: "automation",
        automationTargetKind: "user-skill",
        builtinAutomationId: "backlog-drain",
        jobType: "implementation",
      }),
    ).toBe("scheduled");
  });

  it("uses review job type for Definition of Done automation", () => {
    expect(
      resolveScheduledAgentSubmitJobType({
        agentKind: "automation",
        automationTargetKind: "builtin",
        builtinAutomationId: "dod-review",
        jobType: "scheduled",
      }),
    ).toBe("review");
  });

  it("uses integration job type for release integration automation", () => {
    expect(
      resolveScheduledAgentSubmitJobType({
        agentKind: "automation",
        automationTargetKind: "builtin",
        builtinAutomationId: "release-integration",
        jobType: "scheduled",
      }),
    ).toBe("integration");
  });

  it("keeps the configured job type for repository agents", () => {
    expect(
      resolveScheduledAgentSubmitJobType({
        agentKind: "repository",
        automationTargetKind: "builtin",
        builtinAutomationId: "backlog-drain",
        jobType: "scheduled",
      }),
    ).toBe("scheduled");
  });

  it("keeps integration jobs for repository agents", () => {
    expect(
      resolveScheduledAgentSubmitJobType({
        agentKind: "repository",
        automationTargetKind: "builtin",
        builtinAutomationId: "backlog-drain",
        jobType: "integration",
      }),
    ).toBe("integration");
  });
});

describe("resolveScheduledAgentSubmitProjectId", () => {
  it("stores built-in automations without a direct project association", () => {
    expect(
      resolveScheduledAgentSubmitProjectId({
        agentKind: "automation",
        automationTargetKind: "builtin",
        projectId: "project-1",
      }),
    ).toBeNull();
  });

  it("allows repository agents to be saved without a project", () => {
    expect(
      resolveScheduledAgentSubmitProjectId({
        agentKind: "repository",
        automationTargetKind: "builtin",
        projectId: "",
      }),
    ).toBeNull();
  });
});

describe("buildBuiltinAutomationTargetConfig", () => {
  it("stores multi-project scope for Definition of Done review", () => {
    expect(
      buildBuiltinAutomationTargetConfig({
        builtinAutomationId: "dod-review",
        automationProjectIds: ["project-1", "project-2", "project-1"],
        automationQuietPeriodMinutes: 15,
        backlogDrainDefaultMaxConcurrentJobs: 2,
        backlogDrainProjectIds: [],
        backlogDrainProjectConcurrency: { "project-2": 3 },
        backlogDrainExcludedWorkItemIds: [],
        backlogDrainExcludeDescendants: true,
        projectId: "",
      }),
    ).toEqual({
      projectIds: ["project-1", "project-2"],
      dodReview: {
        enabled: true,
        minAgeMinutes: 15,
        defaultMaxConcurrentJobs: 2,
        projects: [
          { projectId: "project-1", enabled: true, maxConcurrentJobs: 2 },
          { projectId: "project-2", enabled: true, maxConcurrentJobs: 3 },
        ],
      },
    });
  });

  it("persists an empty automation scope as empty so 'All projects' survives reload", () => {
    expect(
      buildBuiltinAutomationTargetConfig({
        builtinAutomationId: "dod-review",
        automationProjectIds: [],
        allProjectIds: ["project-1", "project-2"],
        automationQuietPeriodMinutes: 0,
        backlogDrainDefaultMaxConcurrentJobs: 2,
        backlogDrainProjectIds: [],
        backlogDrainProjectConcurrency: {},
        backlogDrainExcludedWorkItemIds: [],
        backlogDrainExcludeDescendants: true,
        projectId: "",
      }),
    ).toEqual({
      projectIds: undefined,
      dodReview: {
        enabled: true,
        minAgeMinutes: 0,
        defaultMaxConcurrentJobs: 2,
        projects: [],
      },
    });
  });

  it("stores release integration project limits", () => {
    expect(
      buildBuiltinAutomationTargetConfig({
        builtinAutomationId: "release-integration",
        automationProjectIds: ["project-1", "project-2"],
        automationQuietPeriodMinutes: 15,
        backlogDrainDefaultMaxConcurrentJobs: 2,
        backlogDrainProjectIds: [],
        backlogDrainProjectConcurrency: { "project-1": 4 },
        backlogDrainExcludedWorkItemIds: [],
        backlogDrainExcludeDescendants: true,
        projectId: "",
      }),
    ).toEqual({
      projectIds: ["project-1", "project-2"],
      releaseIntegration: {
        enabled: true,
        minAgeMinutes: 15,
        defaultMaxConcurrentJobs: 2,
        projects: [
          { projectId: "project-1", enabled: true, maxConcurrentJobs: 4 },
          { projectId: "project-2", enabled: true, maxConcurrentJobs: 2 },
        ],
      },
    });
  });

  it("stores backlog-style project rules for DoD remediation", () => {
    // automationProjectIds is the source of truth for every builtin: in the
    // real form, backlogDrainProjectIds is a computed mirror of
    // automationProjectIds (see selectedBacklogDrainProjectIds in the hook),
    // so the build helper must read project scope from automationProjectIds
    // only — otherwise an empty automationProjectIds (the "All projects"
    // signal) gets silently overwritten by a stale mirror.
    expect(
      buildBuiltinAutomationTargetConfig({
        builtinAutomationId: "dod-remediation",
        automationProjectIds: ["project-1", "project-2"],
        automationQuietPeriodMinutes: 15,
        backlogDrainDefaultMaxConcurrentJobs: 2,
        backlogDrainProjectIds: ["project-1", "project-2"],
        backlogDrainProjectConcurrency: { "project-2": 1 },
        backlogDrainExcludedWorkItemIds: ["wi-excluded"],
        backlogDrainExcludeDescendants: false,
        projectId: "",
      }),
    ).toEqual({
      dodRemediation: {
        enabled: true,
        minAgeMinutes: 15,
        defaultMaxConcurrentJobs: 2,
        projects: [
          {
            projectId: "project-1",
            enabled: true,
            maxConcurrentJobs: 2,
            excludedWorkItemIds: ["wi-excluded"],
            excludeDescendants: false,
          },
          {
            projectId: "project-2",
            enabled: true,
            maxConcurrentJobs: 1,
            excludedWorkItemIds: ["wi-excluded"],
            excludeDescendants: false,
          },
        ],
      },
    });
  });

  it("persists 'All projects' for DoD remediation even if backlogDrainProjectIds has stale values", () => {
    // Regression: an earlier version fell back to backlogDrainProjectIds when
    // automationProjectIds was empty, which silently turned "All projects"
    // into the stale mirror's contents. Ensure the empty signal wins.
    expect(
      buildBuiltinAutomationTargetConfig({
        builtinAutomationId: "dod-remediation",
        automationProjectIds: [],
        automationQuietPeriodMinutes: 15,
        backlogDrainDefaultMaxConcurrentJobs: 2,
        backlogDrainProjectIds: ["project-stale-1", "project-stale-2"],
        backlogDrainProjectConcurrency: {},
        backlogDrainExcludedWorkItemIds: [],
        backlogDrainExcludeDescendants: true,
        projectId: "",
      }),
    ).toEqual({
      dodRemediation: {
        enabled: true,
        minAgeMinutes: 15,
        defaultMaxConcurrentJobs: 2,
        projects: [],
      },
    });
  });
});

describe("resolveScheduledAgentSubmitProvider", () => {
  it("keeps direct repository agents on the selected provider", () => {
    expect(
      resolveScheduledAgentSubmitProvider({
        agentKind: "repository",
        automationTargetKind: "builtin",
        builtinAutomationId: "backlog-drain",
        provider: "claude-code",
        codingAgent: "codex",
        aiProvider: "openai",
      }),
    ).toBe("claude-code");
  });

  it("keeps user-skill automation on the selected provider", () => {
    expect(
      resolveScheduledAgentSubmitProvider({
        agentKind: "automation",
        automationTargetKind: "user-skill",
        builtinAutomationId: "backlog-drain",
        provider: "claude-code",
        codingAgent: "codex",
      }),
    ).toBe("claude-code");
  });

  it("routes built-in (backlog drain) automation to Codex when Codex is selected", () => {
    expect(
      resolveScheduledAgentSubmitProvider({
        agentKind: "automation",
        automationTargetKind: "builtin",
        builtinAutomationId: "backlog-drain",
        provider: "claude-code",
        codingAgent: "codex",
        aiProvider: "openai",
      }),
    ).toBe("codex");
  });

  it("routes built-in automation to the xAI-backed provider when Codex uses xAI", () => {
    expect(
      resolveScheduledAgentSubmitProvider({
        agentKind: "automation",
        automationTargetKind: "builtin",
        builtinAutomationId: "backlog-drain",
        provider: "grok",
        codingAgent: "codex",
        aiProvider: "xai",
      }),
    ).toBe("grok");
  });

  it("routes built-in automation to z.ai when OpenCode is selected", () => {
    expect(
      resolveScheduledAgentSubmitProvider({
        agentKind: "automation",
        automationTargetKind: "builtin",
        builtinAutomationId: "backlog-drain",
        provider: "claude-code",
        codingAgent: "opencode",
        aiProvider: "zai",
      }),
    ).toBe("zipu");
  });

  it("routes built-in automation to the xAI-backed provider when OpenCode uses xAI", () => {
    expect(
      resolveScheduledAgentSubmitProvider({
        agentKind: "automation",
        automationTargetKind: "builtin",
        builtinAutomationId: "backlog-drain",
        provider: "grok",
        codingAgent: "opencode",
        aiProvider: "xai",
      }),
    ).toBe("grok");
  });

  it("preserves z.ai for built-in automation using Claude Code with z.ai models", () => {
    expect(
      resolveScheduledAgentSubmitProvider({
        agentKind: "automation",
        automationTargetKind: "builtin",
        builtinAutomationId: "backlog-drain",
        provider: "zipu",
        codingAgent: "claude-code",
        aiProvider: "zai",
      }),
    ).toBe("zipu");
  });
});

describe("scheduledAgentFormSchema — once", () => {
  const onceValues = {
    ...validScheduledAgentFormValues,
    scheduleType: "once" as const,
    agentKind: "repository" as const,
  };

  it("accepts a run-once schedule with a filled-in date/time", () => {
    const result = scheduledAgentFormSchema.safeParse({
      ...onceValues,
      onceRunAtLocal: "2026-08-15T14:30",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a run-once schedule with no date/time picked", () => {
    const result = scheduledAgentFormSchema.safeParse({
      ...onceValues,
      onceRunAtLocal: "",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes("onceRunAtLocal"))).toBe(true);
    }
  });

  it("rejects a run-once schedule with a malformed date/time", () => {
    const result = scheduledAgentFormSchema.safeParse({
      ...onceValues,
      onceRunAtLocal: "not-a-date",
    });

    expect(result.success).toBe(false);
  });

  it("does NOT reject a run-once schedule whose date/time is in the past (non-blocking by design)", () => {
    // The backend explicitly allows a past runAt — it just dispatches on the
    // next tick instead of rejecting the config. The UI surfaces this as a
    // warning, not a form validation error.
    const result = scheduledAgentFormSchema.safeParse({
      ...onceValues,
      onceRunAtLocal: "2000-01-01T00:00",
    });

    expect(result.success).toBe(true);
  });
});

describe("buildOnceScheduleConfig", () => {
  it("converts the local date/time picked in the agent's timezone into an absolute ISO runAt", () => {
    expect(
      buildOnceScheduleConfig({
        onceRunAtLocal: "2026-08-15T14:30",
        timezone: "Europe/Madrid",
      }),
    ).toEqual({ runAt: "2026-08-15T12:30:00.000Z" });
  });

  it("returns null when no date/time was picked", () => {
    expect(
      buildOnceScheduleConfig({
        onceRunAtLocal: "",
        timezone: "Europe/Madrid",
      }),
    ).toBeNull();
  });

  it("returns null when the date/time is malformed", () => {
    expect(
      buildOnceScheduleConfig({
        onceRunAtLocal: "not-a-date",
        timezone: "Europe/Madrid",
      }),
    ).toBeNull();
  });
});

describe("resolveOnceRunAtDefault", () => {
  it("returns an empty string when creating a new agent (no config)", () => {
    expect(resolveOnceRunAtDefault(null)).toBe("");
  });

  it("returns an empty string when the edited config isn't a run-once schedule", () => {
    expect(
      resolveOnceRunAtDefault({
        scheduleType: "cron",
        scheduleConfig: { expression: "0 9 * * 1-5" },
        timezone: "Europe/Madrid",
      }),
    ).toBe("");
  });

  it("round-trips a persisted runAt back into the agent's local wall-clock value", () => {
    // Regression: editing a saved 'once' agent must show the SAME local date
    // and time the user originally picked, not a UTC- or browser-shifted one.
    expect(
      resolveOnceRunAtDefault({
        scheduleType: "once",
        scheduleConfig: { runAt: "2026-08-15T12:30:00.000Z" },
        timezone: "Europe/Madrid",
      }),
    ).toBe("2026-08-15T14:30");
  });
});

describe("resolveScheduledAgentSubmitRuntimeFields", () => {
  it("persists runtime/model fields for built-in automation processes", () => {
    expect(
      resolveScheduledAgentSubmitRuntimeFields({
        codingAgent: "codex",
        aiProvider: "openai",
        aiModel: "gpt-5.5",
        reasoningLevel: "xhigh",
      }),
    ).toEqual({
      codingAgent: "codex",
      aiProvider: "openai",
      aiModel: "gpt-5.5",
      reasoningLevel: "xhigh",
    });
  });

  it("keeps runtime/model fields for direct repository agents", () => {
    expect(
      resolveScheduledAgentSubmitRuntimeFields({
        codingAgent: "codex",
        aiProvider: "openai",
        aiModel: "gpt-5.5",
        reasoningLevel: "xhigh",
      }),
    ).toEqual({
      codingAgent: "codex",
      aiProvider: "openai",
      aiModel: "gpt-5.5",
      reasoningLevel: "xhigh",
    });
  });
});
