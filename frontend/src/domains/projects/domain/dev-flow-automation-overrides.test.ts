import { describe, expect, it } from "bun:test";
import {
  EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE,
  applyDevFlowAutomationDrafts,
  buildDevFlowAutomationOverrideDirtyPatch,
  buildDevFlowAutomationsPatchPayload,
  devFlowAutomationOverridesEqual,
  formatDevFlowEffectiveSummary,
  overridesByAutomationIdFromStatuses,
  serializeDevFlowAutomationOverride,
} from "./dev-flow-automation-overrides";
import type {
  ProjectDevFlowAutomationEffective,
  ProjectDevFlowAutomationOverride,
  ProjectDevFlowAutomationRow,
  ProjectDevFlowAutomationStatus,
} from "./types";

const effective: ProjectDevFlowAutomationEffective = {
  codingAgent: "claude-code",
  aiProvider: "anthropic",
  model: "claude-opus-5",
  reasoningLevel: "high",
  maxConcurrentJobs: 2,
  schedule: { expression: "*/5 * * * *", timezone: "UTC" },
};

const override = (
  overrides: Partial<ProjectDevFlowAutomationOverride> = {},
): ProjectDevFlowAutomationOverride => ({
  ...EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE,
  ...overrides,
});

describe("EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE", () => {
  it("has every field set to null (fully inherited)", () => {
    expect(EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE).toEqual({
      enabled: null,
      codingAgent: null,
      aiProvider: null,
      model: null,
      reasoningLevel: null,
      maxConcurrentJobs: null,
      schedule: null,
    });
  });
});

describe("devFlowAutomationOverridesEqual", () => {
  it("returns true for two empty overrides", () => {
    expect(
      devFlowAutomationOverridesEqual(EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE, EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE),
    ).toBe(true);
  });

  it("returns false when a scalar field differs", () => {
    expect(
      devFlowAutomationOverridesEqual(override({ model: "claude-opus-5" }), override({ model: "claude-sonnet-5" })),
    ).toBe(false);
  });

  it("returns true when schedules are deeply equal", () => {
    const a = override({ schedule: { expression: "*/5 * * * *", timezone: "UTC" } });
    const b = override({ schedule: { expression: "*/5 * * * *", timezone: "UTC" } });
    expect(devFlowAutomationOverridesEqual(a, b)).toBe(true);
  });

  it("returns false when one schedule is null and the other is set", () => {
    const a = override({ schedule: null });
    const b = override({ schedule: { expression: "*/5 * * * *", timezone: "UTC" } });
    expect(devFlowAutomationOverridesEqual(a, b)).toBe(false);
  });

  it("returns false when schedule timezones differ", () => {
    const a = override({ schedule: { expression: "*/5 * * * *", timezone: "UTC" } });
    const b = override({ schedule: { expression: "*/5 * * * *", timezone: "Europe/Madrid" } });
    expect(devFlowAutomationOverridesEqual(a, b)).toBe(false);
  });
});

describe("serializeDevFlowAutomationOverride", () => {
  it("omits every scalar field that is null (inherit)", () => {
    expect(serializeDevFlowAutomationOverride(EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE)).toEqual({
      schedule: null,
    });
  });

  it("includes only the scalar fields that are explicitly overridden", () => {
    const wire = serializeDevFlowAutomationOverride(
      override({ model: "claude-opus-5", reasoningLevel: "high" }),
    );

    expect(wire).toEqual({
      model: "claude-opus-5",
      reasoningLevel: "high",
      schedule: null,
    });
  });

  it("preserves raw persisted runtime values instead of normalizing them during serialization", () => {
    expect(serializeDevFlowAutomationOverride(
      override({
        codingAgent: "claude-code",
        aiProvider: "anthropic",
        model: "claude-haiku-4-5",
        reasoningLevel: "low",
      }),
    )).toEqual({
      codingAgent: "claude-code",
      aiProvider: "anthropic",
      model: "claude-haiku-4-5",
      reasoningLevel: "low",
      schedule: null,
    });
  });

  it("includes enabled: false explicitly (not dropped as falsy)", () => {
    const wire = serializeDevFlowAutomationOverride(override({ enabled: false }));
    expect(wire.enabled).toBe(false);
  });

  it("includes maxConcurrentJobs: 0 only if actually set (never happens in practice, but must not be treated as null)", () => {
    // maxConcurrentJobs overrides are always >= 1 by construction upstream,
    // but the serializer itself must not special-case falsy numbers.
    const wire = serializeDevFlowAutomationOverride(override({ maxConcurrentJobs: 3 }));
    expect(wire.maxConcurrentJobs).toBe(3);
  });

  it("sends schedule: null explicitly when there is no schedule override", () => {
    const wire = serializeDevFlowAutomationOverride(override({ model: "claude-opus-5" }));
    expect(wire.schedule).toBeNull();
  });

  it("sends the full schedule object, including timezone, when overridden", () => {
    const wire = serializeDevFlowAutomationOverride(
      override({ schedule: { expression: "0 * * * *", timezone: "Europe/Madrid" } }),
    );
    expect(wire.schedule).toEqual({ expression: "0 * * * *", timezone: "Europe/Madrid" });
  });

  it("preserves an explicit null schedule timezone on the merge-shaped wire contract", () => {
    const wire = serializeDevFlowAutomationOverride(
      override({ schedule: { expression: "0 * * * *", timezone: null } }),
    );
    expect(wire.schedule).toEqual({ expression: "0 * * * *", timezone: null });
  });

  it("resetting to the empty override always produces the ausente/null reset payload", () => {
    // This is exactly what the "Reset to defaults" row action sends.
    expect(serializeDevFlowAutomationOverride(EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE)).toEqual({
      schedule: null,
    });
  });
});

describe("buildDevFlowAutomationOverrideDirtyPatch", () => {
  it("returns an empty patch when the draft matches the server override", () => {
    const server = override({
      model: "future-model",
      reasoningLevel: "future-effort",
      schedule: { expression: "0 9 * * *", timezone: null },
    });

    expect(buildDevFlowAutomationOverrideDirtyPatch({ ...server }, server)).toEqual({});
  });

  it("emits only changed scalar fields and uses explicit null to clear an override", () => {
    const server = override({
      enabled: true,
      codingAgent: "future-agent",
      aiProvider: "future-provider",
      model: "future-model",
      reasoningLevel: "future-effort",
      maxConcurrentJobs: 3,
    });
    const draft = { ...server, enabled: false, model: null, reasoningLevel: null };

    expect(buildDevFlowAutomationOverrideDirtyPatch(draft, server)).toEqual({
      enabled: false,
      model: null,
      reasoningLevel: null,
    });
  });

  it("omits a deeply equal schedule and emits changed or cleared schedules", () => {
    const server = override({
      schedule: { expression: "0 9 * * *", timezone: "UTC" },
    });

    expect(buildDevFlowAutomationOverrideDirtyPatch(
      override({ schedule: { expression: "0 9 * * *", timezone: "UTC" } }),
      server,
    )).toEqual({});
    expect(buildDevFlowAutomationOverrideDirtyPatch(
      override({ schedule: { expression: "0 10 * * *", timezone: null } }),
      server,
    )).toEqual({
      schedule: { expression: "0 10 * * *", timezone: null },
    });
    expect(buildDevFlowAutomationOverrideDirtyPatch(
      EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE,
      server,
    )).toEqual({ schedule: null });
  });
});

describe("buildDevFlowAutomationsPatchPayload", () => {
  it("omits every automationId whose override is fully empty (fully inherited)", () => {
    const payload = buildDevFlowAutomationsPatchPayload({
      "backlog-drain": EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE,
      "dod-review": EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE,
    });

    expect(payload).toEqual({});
  });

  it("includes an automationId with its serialized override when it has any override at all", () => {
    const payload = buildDevFlowAutomationsPatchPayload({
      "backlog-drain": override({ model: "claude-sonnet-5" }),
    });

    expect(payload).toEqual({
      "backlog-drain": { model: "claude-sonnet-5", schedule: null },
    });
  });

  it("PRESERVES an untouched automation's existing override when building the payload for a different automation's save (wholesale-replace safety)", () => {
    // This is the exact regression the coordinator flagged: saving row X must
    // not silently wipe out row Y's persisted override, because the backend
    // replaces the whole `devFlow.automations` map with whatever we send.
    const payload = buildDevFlowAutomationsPatchPayload({
      "backlog-drain": override({ model: "claude-sonnet-5" }), // row X being saved
      "dod-review": override({ reasoningLevel: "low" }), // row Y, untouched this save, already had a server override
      "dod-remediation": EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE, // row Z, never overridden
    });

    expect(payload).toEqual({
      "backlog-drain": { model: "claude-sonnet-5", schedule: null },
      "dod-review": { reasoningLevel: "low", schedule: null },
    });
    expect(payload).not.toHaveProperty("dod-remediation");
  });

  it("resetting one automation to defaults omits ONLY that automationId's entry, preserving every other automation's override", () => {
    // Simulates handleResetToDefaults("backlog-drain") when dod-review already
    // has a persisted override: the caller forces backlog-drain's entry to
    // EMPTY before calling this function.
    const payload = buildDevFlowAutomationsPatchPayload({
      "backlog-drain": EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE, // just reset
      "dod-review": override({ model: "claude-opus-5", schedule: { expression: "0 9 * * *", timezone: "UTC" } }),
    });

    expect(payload).not.toHaveProperty("backlog-drain");
    expect(payload).toEqual({
      "dod-review": { model: "claude-opus-5", schedule: { expression: "0 9 * * *", timezone: "UTC" } },
    });
  });

  it("a partial reset (clearing only the schedule) keeps the automation's entry with its other fields intact", () => {
    const payload = buildDevFlowAutomationsPatchPayload({
      "backlog-drain": override({ model: "claude-sonnet-5", schedule: null }),
    });

    expect(payload).toEqual({
      "backlog-drain": { model: "claude-sonnet-5", schedule: null },
    });
  });

  it("returns an empty object when given an empty map", () => {
    expect(buildDevFlowAutomationsPatchPayload({})).toEqual({});
  });
});

describe("overridesByAutomationIdFromStatuses", () => {
  const effective: ProjectDevFlowAutomationEffective = {
    codingAgent: "claude-code",
    aiProvider: "anthropic",
    model: "claude-opus-5",
    reasoningLevel: "high",
    maxConcurrentJobs: 2,
    schedule: { expression: "*/5 * * * *", timezone: "UTC" },
  };

  const status = (
    overrides: Partial<ProjectDevFlowAutomationStatus> = {},
  ): ProjectDevFlowAutomationStatus => ({
    automationId: "backlog-drain",
    targetConfigKey: "backlogDrain",
    name: "Backlog drain",
    description: "d",
    configId: null,
    managedBy: null,
    enabled: false,
    lastRunAt: null,
    skippedForExistingUserAgent: false,
    overrides: null,
    effective,
    ...overrides,
  });

  it("defaults a null server override to fully inherited, keyed by automationId", () => {
    const result = overridesByAutomationIdFromStatuses([
      status({ automationId: "backlog-drain", overrides: null }),
    ]);

    expect(result).toEqual({ "backlog-drain": EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE });
  });

  it("passes through an existing server override verbatim", () => {
    const override = { ...EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE, model: "claude-sonnet-5" };
    const result = overridesByAutomationIdFromStatuses([
      status({ automationId: "dod-review", overrides: override }),
    ]);

    expect(result).toEqual({ "dod-review": override });
  });

  it("maps every automation in the array, not just the first", () => {
    const result = overridesByAutomationIdFromStatuses([
      status({ automationId: "backlog-drain", overrides: null }),
      status({ automationId: "dod-remediation", overrides: { ...EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE, reasoningLevel: "low" } }),
    ]);

    expect(Object.keys(result).sort()).toEqual(["backlog-drain", "dod-remediation"]);
    expect(result["dod-remediation"]!.reasoningLevel).toBe("low");
  });

  it("preserves an unsupported legacy override while hydrating for read-open display", () => {
    const result = overridesByAutomationIdFromStatuses([
      status({
        overrides: { ...EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE, reasoningLevel: "low" },
        effective: { ...effective, model: "claude-haiku-4-5", reasoningLevel: "low" },
      }),
    ]);

    expect(result["backlog-drain"]!.reasoningLevel).toBe("low");
  });

  it("returns an empty object for an empty automations array", () => {
    expect(overridesByAutomationIdFromStatuses([])).toEqual({});
  });
});

describe("formatDevFlowEffectiveSummary", () => {
  it("joins codingAgent, model, reasoningLevel and the cron expression with a middle dot", () => {
    expect(formatDevFlowEffectiveSummary(effective)).toBe("claude-code · claude-opus-5 · high · */5 * * * *");
  });
});

describe("applyDevFlowAutomationDrafts", () => {
  const baseRow: ProjectDevFlowAutomationRow = {
    automationId: "backlog-drain",
    name: "Backlog drain",
    description: "d",
    configId: "agent-1",
    enabled: true,
    lastRunAt: null,
    isSkippedForUserAgent: false,
    diagnosis: { status: "idle", result: null, error: null },
    effective,
    override: EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE,
    hasChanges: false,
    isSaving: false,
    isAdopting: false,
  };

  it("leaves a row untouched when there is no matching draft entry", () => {
    const [row] = applyDevFlowAutomationDrafts([baseRow], {});
    expect(row).toEqual(baseRow);
  });

  it("overlays the draft's override/hasChanges/isSaving onto the matching row", () => {
    const draftOverride = override({ model: "claude-sonnet-5" });

    const [row] = applyDevFlowAutomationDrafts([baseRow], {
      "backlog-drain": { override: draftOverride, hasChanges: true, isSaving: true },
    });

    expect(row!.override).toEqual(draftOverride);
    expect(row!.hasChanges).toBe(true);
    expect(row!.isSaving).toBe(true);
    // Everything else on the row is preserved as-is.
    expect(row!.name).toBe("Backlog drain");
    expect(row!.effective).toEqual(effective);
  });

  it("only overlays rows present in the drafts map, leaving others untouched", () => {
    const otherRow: ProjectDevFlowAutomationRow = { ...baseRow, automationId: "dod-review", name: "DoD review" };

    const rows = applyDevFlowAutomationDrafts([baseRow, otherRow], {
      "dod-review": { override: override({ enabled: false }), hasChanges: true, isSaving: false },
    });

    expect(rows[0]).toEqual(baseRow);
    expect(rows[1]!.hasChanges).toBe(true);
    expect(rows[1]!.override.enabled).toBe(false);
  });
});
