import { describe, expect, it } from "bun:test";
import { mergeDevFlowAutomations, parseMaxConcurrentJobsInput } from "./dev-flow";
import { EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE } from "./dev-flow-automation-overrides";
import type { DevFlowDiagnosisState } from "./dev-flow";
import type { ProjectDevFlowAutomationEffective, ProjectDevFlowAutomationOverride, ProjectDevFlowAutomationStatus } from "./types";

const DEFAULT_EFFECTIVE: ProjectDevFlowAutomationEffective = {
  codingAgent: "claude-code",
  aiProvider: "anthropic",
  model: "claude-opus-5",
  reasoningLevel: "high",
  maxConcurrentJobs: 2,
  schedule: { expression: "*/5 * * * *", timezone: "UTC" },
};

const automation = (
  overrides: Partial<ProjectDevFlowAutomationStatus> = {},
): ProjectDevFlowAutomationStatus => ({
  automationId: "backlog-drain",
  targetConfigKey: "backlogDrain",
  name: "Backlog drain",
  description: "Picks ready Backlog work items on each tick and enqueues implementation jobs.",
  configId: null,
  managedBy: null,
  enabled: false,
  lastRunAt: null,
  skippedForExistingUserAgent: false,
  overrides: null,
  effective: DEFAULT_EFFECTIVE,
  ...overrides,
});

describe("mergeDevFlowAutomations", () => {
  it("maps each API automation entry to a row, passing through the catalog-sourced name/description as-is", () => {
    const automations: ProjectDevFlowAutomationStatus[] = [
      automation({ automationId: "backlog-drain", name: "Backlog drain", description: "d1" }),
      automation({ automationId: "dod-remediation", name: "DoD remediation", description: "d2" }),
      automation({ automationId: "dod-review", name: "Definition of Done review", description: "d3" }),
      automation({ automationId: "release-integration", name: "Release integration", description: "d4" }),
    ];

    const rows = mergeDevFlowAutomations(automations, {});

    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.automationId)).toEqual([
      "backlog-drain",
      "dod-remediation",
      "dod-review",
      "release-integration",
    ]);
    expect(rows[0]!.name).toBe("Backlog drain");
    expect(rows[0]!.description).toBe("d1");
  });

  it("preserves the API's own ordering instead of re-sorting against a local catalog", () => {
    const automations: ProjectDevFlowAutomationStatus[] = [
      automation({ automationId: "release-integration" }),
      automation({ automationId: "backlog-drain" }),
    ];

    const rows = mergeDevFlowAutomations(automations, {});

    expect(rows.map((r) => r.automationId)).toEqual(["release-integration", "backlog-drain"]);
  });

  it("passes through configId (null when not yet provisioned), enabled and lastRunAt", () => {
    const automations: ProjectDevFlowAutomationStatus[] = [
      automation({ automationId: "backlog-drain", configId: "agent-1", managedBy: "system", enabled: true, lastRunAt: "2026-07-30T00:00:00.000Z" }),
      automation({ automationId: "dod-remediation", configId: null, managedBy: null, enabled: false, lastRunAt: null }),
    ];

    const rows = mergeDevFlowAutomations(automations, {});

    const backlogDrain = rows.find((r) => r.automationId === "backlog-drain")!;
    expect(backlogDrain.configId).toBe("agent-1");
    expect(backlogDrain.enabled).toBe(true);
    expect(backlogDrain.lastRunAt).toBe("2026-07-30T00:00:00.000Z");

    const dodRemediation = rows.find((r) => r.automationId === "dod-remediation")!;
    expect(dodRemediation.configId).toBeNull();
    expect(dodRemediation.enabled).toBe(false);
  });

  it("maps the per-row skippedForExistingUserAgent flag onto isSkippedForUserAgent", () => {
    const automations: ProjectDevFlowAutomationStatus[] = [
      automation({ automationId: "release-integration", skippedForExistingUserAgent: true }),
      automation({ automationId: "backlog-drain", skippedForExistingUserAgent: false }),
    ];

    const rows = mergeDevFlowAutomations(automations, {});

    expect(rows.find((r) => r.automationId === "release-integration")!.isSkippedForUserAgent).toBe(true);
    expect(rows.find((r) => r.automationId === "backlog-drain")!.isSkippedForUserAgent).toBe(false);
  });

  it("attaches the lazy diagnosis state for a row when present in the diagnosis map, keyed by configId", () => {
    const automations: ProjectDevFlowAutomationStatus[] = [
      automation({ automationId: "backlog-drain", configId: "agent-1", enabled: true }),
    ];
    const diagnosisMap: Record<string, DevFlowDiagnosisState> = {
      "agent-1": {
        status: "loaded",
        result: {
          configId: "agent-1",
          name: "Backlog drain",
          projectId: "p1",
          projectName: "Project 1",
          verdict: "would-dispatch",
          blockedBy: null,
          gates: [{ gate: "enabled", passed: true, detail: "enabled=true" }],
        },
        error: null,
      },
    };

    const rows = mergeDevFlowAutomations(automations, diagnosisMap);

    const backlogDrain = rows.find((r) => r.automationId === "backlog-drain")!;
    expect(backlogDrain.diagnosis.status).toBe("loaded");
    expect(backlogDrain.diagnosis.result?.verdict).toBe("would-dispatch");
  });

  it("defaults to idle diagnosis for rows without a configId, even if the diagnosis map has unrelated entries", () => {
    const automations: ProjectDevFlowAutomationStatus[] = [
      automation({ automationId: "backlog-drain", configId: null }),
    ];

    const rows = mergeDevFlowAutomations(automations, {
      "some-unrelated-id": { status: "loading", result: null, error: null },
    });

    expect(rows[0]!.diagnosis).toEqual({ status: "idle", result: null, error: null });
  });

  it("passes the server-resolved effective runtime through unchanged", () => {
    const automations: ProjectDevFlowAutomationStatus[] = [automation({ effective: DEFAULT_EFFECTIVE })];

    const rows = mergeDevFlowAutomations(automations, {});

    expect(rows[0]!.effective).toEqual(DEFAULT_EFFECTIVE);
  });

  it("defaults the row's override to the fully-inherited override when the server returns overrides: null", () => {
    const automations: ProjectDevFlowAutomationStatus[] = [automation({ overrides: null })];

    const rows = mergeDevFlowAutomations(automations, {});

    expect(rows[0]!.override).toEqual(EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE);
  });

  it("passes the server's overrides through as the row's override when present", () => {
    const override: ProjectDevFlowAutomationOverride = {
      ...EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE,
      model: "claude-sonnet-5",
    };
    const automations: ProjectDevFlowAutomationStatus[] = [automation({ overrides: override })];

    const rows = mergeDevFlowAutomations(automations, {});

    expect(rows[0]!.override).toEqual(override);
  });

  it("starts hasChanges/isSaving/isAdopting at false — the container overlays draft/mutation state separately", () => {
    const automations: ProjectDevFlowAutomationStatus[] = [automation()];

    const rows = mergeDevFlowAutomations(automations, {});

    expect(rows[0]!.hasChanges).toBe(false);
    expect(rows[0]!.isSaving).toBe(false);
    expect(rows[0]!.isAdopting).toBe(false);
  });
});

describe("parseMaxConcurrentJobsInput", () => {
  it("parses a positive integer string", () => {
    expect(parseMaxConcurrentJobsInput("3")).toBe(3);
    expect(parseMaxConcurrentJobsInput("1")).toBe(1);
  });

  it("treats an empty/whitespace string as null (no limit override)", () => {
    expect(parseMaxConcurrentJobsInput("")).toBeNull();
    expect(parseMaxConcurrentJobsInput("   ")).toBeNull();
  });

  it("rejects zero, negative, non-integer and non-numeric input as null", () => {
    expect(parseMaxConcurrentJobsInput("0")).toBeNull();
    expect(parseMaxConcurrentJobsInput("-1")).toBeNull();
    expect(parseMaxConcurrentJobsInput("2.5")).toBeNull();
    expect(parseMaxConcurrentJobsInput("abc")).toBeNull();
  });
});
