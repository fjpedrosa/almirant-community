import React from "react";
import { beforeAll, describe, expect, test, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectDevFlowCard } from "./project-dev-flow-card";
import { EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE } from "../../domain/dev-flow-automation-overrides";
import type {
  ProjectDevFlowAutomationEffective,
  ProjectDevFlowAutomationRow,
  ProjectDevFlowCardProps,
} from "../../domain/types";

mock.module("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

// Each row now renders a Radix Collapsible (project-dev-flow-automation-row.tsx)
// for its expand/collapse — same rAF shim as conversation-timeline.test.tsx.
beforeAll(() => {
  if (typeof globalThis.requestAnimationFrame === "undefined") {
    globalThis.requestAnimationFrame = (callback: FrameRequestCallback) =>
      setTimeout(() => callback(performance.now()), 0) as unknown as number;
  }
  if (typeof globalThis.cancelAnimationFrame === "undefined") {
    globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);
  }
});

const noop = () => {};

const defaultEffective: ProjectDevFlowAutomationEffective = {
  codingAgent: "claude-code",
  aiProvider: "anthropic",
  model: "claude-opus-5",
  reasoningLevel: "high",
  maxConcurrentJobs: 2,
  schedule: { expression: "*/5 * * * *", timezone: "UTC" },
};

const baseAutomations: ProjectDevFlowAutomationRow[] = [
  {
    automationId: "backlog-drain",
    name: "Backlog drain",
    description: "Picks ready Backlog work items on each tick and enqueues implementation jobs.",
    configId: "agent-1",
    enabled: true,
    lastRunAt: null,
    isSkippedForUserAgent: false,
    diagnosis: { status: "idle", result: null, error: null },
    effective: defaultEffective,
    override: EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE,
    hasChanges: false,
    isSaving: false,
    isAdopting: false,
  },
  {
    automationId: "dod-remediation",
    name: "DoD remediation",
    description: "Repairs Backlog work items that failed Definition of Done review, using the saved DoD report.",
    configId: null,
    enabled: false,
    lastRunAt: null,
    isSkippedForUserAgent: false,
    diagnosis: { status: "idle", result: null, error: null },
    effective: defaultEffective,
    override: EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE,
    hasChanges: false,
    isSaving: false,
    isAdopting: false,
  },
  {
    automationId: "dod-review",
    name: "Definition of Done review",
    description: "Reviews To Review tasks against their Definition of Done after a quiet period.",
    configId: null,
    enabled: false,
    lastRunAt: null,
    isSkippedForUserAgent: false,
    diagnosis: { status: "idle", result: null, error: null },
    effective: defaultEffective,
    override: EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE,
    hasChanges: false,
    isSaving: false,
    isAdopting: false,
  },
  {
    automationId: "release-integration",
    name: "Release integration",
    description: "Batches Validating tasks into the shared release integration PR.",
    configId: null,
    enabled: false,
    lastRunAt: null,
    isSkippedForUserAgent: false,
    diagnosis: { status: "idle", result: null, error: null },
    effective: defaultEffective,
    override: EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE,
    hasChanges: false,
    isSaving: false,
    isAdopting: false,
  },
];

const baseProps: ProjectDevFlowCardProps = {
  isLoading: false,
  errorMessage: null,
  settings: {
    enabled: true,
    codingAgent: "claude-code",
    aiProvider: "anthropic",
    model: "claude-opus-5",
    reasoningLevel: null,
    maxConcurrentJobs: 2,
  },
  isSaving: false,
  hasChanges: false,
  automations: baseAutomations,
  skippedExistingUserAgents: [],
  onToggleEnabled: noop,
  onCodingAgentChange: noop,
  onAiProviderChange: noop,
  onModelChange: noop,
  onReasoningLevelChange: noop,
  onMaxConcurrentJobsChange: noop,
  onSave: noop,
  onDiscard: noop,
  onDiagnose: noop,
  onAutomationFieldChange: noop,
  onAutomationScheduleChange: noop,
  onAutomationSave: noop,
  onAutomationDiscard: noop,
  onAutomationResetToDefaults: noop,
  onAutomationAdopt: noop,
};

describe("ProjectDevFlowCard", () => {
  test("disables the runtime fields and the max concurrent jobs input when the master switch is off", () => {
    globalThis.DocumentFragment = window.DocumentFragment;

    render(<ProjectDevFlowCard {...baseProps} settings={{ ...baseProps.settings, enabled: false }} />);

    const selects = screen.getAllByRole("combobox");
    expect(selects.length).toBeGreaterThanOrEqual(4);
    for (const select of selects) {
      expect(select).toBeDisabled();
    }
    expect(screen.getByLabelText("fields.maxConcurrentJobs")).toBeDisabled();
  });

  test("keeps the runtime fields enabled when the switch is on and not saving", () => {
    globalThis.DocumentFragment = window.DocumentFragment;

    render(<ProjectDevFlowCard {...baseProps} />);

    const selects = screen.getAllByRole("combobox");
    for (const select of selects) {
      expect(select).not.toBeDisabled();
    }
    expect(screen.getByLabelText("fields.maxConcurrentJobs")).not.toBeDisabled();
  });

  test("calls onToggleEnabled with the flipped value when the master switch is clicked", async () => {
    globalThis.DocumentFragment = window.DocumentFragment;
    const onToggleEnabled = mock(() => {});
    const user = userEvent.setup();

    render(<ProjectDevFlowCard {...baseProps} onToggleEnabled={onToggleEnabled} />);

    await user.click(screen.getByRole("switch", { name: "enableAria" }));

    expect(onToggleEnabled).toHaveBeenCalledWith(false);
  });

  test("renders a conflict warning with a link to the scheduled agents list when automations were skipped", () => {
    render(
      <ProjectDevFlowCard
        {...baseProps}
        skippedExistingUserAgents={[{ configId: "user-agent-1", automationId: "release-integration" }]}
      />,
    );

    expect(screen.getByText('conflictWarning:{"count":1}')).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "viewScheduledAgents" });
    expect(link).toHaveAttribute("href", "/agents");
  });

  test("does not render the conflict warning when nothing was skipped", () => {
    render(<ProjectDevFlowCard {...baseProps} skippedExistingUserAgents={[]} />);

    expect(screen.queryByRole("link", { name: "viewScheduledAgents" })).toBeNull();
  });

  test("renders a loading skeleton and nothing else when isLoading is true", () => {
    render(<ProjectDevFlowCard {...baseProps} isLoading />);

    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByText("Backlog drain")).toBeNull();
  });

  test("renders the error message when errorMessage is set", () => {
    render(<ProjectDevFlowCard {...baseProps} errorMessage="Failed to load dev flow config" />);

    expect(screen.getByText("Failed to load dev flow config")).toBeInTheDocument();
  });

  test("only renders the Save/Discard footer when hasChanges is true", () => {
    const { rerender } = render(<ProjectDevFlowCard {...baseProps} hasChanges={false} />);
    expect(screen.queryByRole("button", { name: "saveChanges" })).toBeNull();

    rerender(<ProjectDevFlowCard {...baseProps} hasChanges />);
    expect(screen.getByRole("button", { name: "saveChanges" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "discard" })).toBeInTheDocument();
  });

  test("lists all four catalog automations with their enabled/disabled state", () => {
    render(<ProjectDevFlowCard {...baseProps} />);

    expect(screen.getByText("Backlog drain")).toBeInTheDocument();
    expect(screen.getByText("DoD remediation")).toBeInTheDocument();
    expect(screen.getByText("Definition of Done review")).toBeInTheDocument();
    expect(screen.getByText("Release integration")).toBeInTheDocument();
  });

  test("disables Diagnose for an automation that hasn't been provisioned yet (no configId)", () => {
    render(<ProjectDevFlowCard {...baseProps} />);

    expect(
      screen.getByRole("button", { name: 'diagnoseAria:{"name":"DoD remediation"}' }),
    ).toBeDisabled();
  });

  test("calls onDiagnose with the automation's configId when Diagnose is clicked", async () => {
    const onDiagnose = mock(() => {});
    const user = userEvent.setup();

    render(<ProjectDevFlowCard {...baseProps} onDiagnose={onDiagnose} />);

    await user.click(screen.getByRole("button", { name: 'diagnoseAria:{"name":"Backlog drain"}' }));

    expect(onDiagnose).toHaveBeenCalledWith("agent-1");
  });

  test("renders a green would-dispatch verdict once diagnosis is loaded", () => {
    const automations = baseAutomations.map((row) =>
      row.automationId === "backlog-drain"
        ? {
            ...row,
            diagnosis: {
              status: "loaded" as const,
              result: {
                configId: "agent-1",
                name: "Backlog drain",
                projectId: "p1",
                projectName: "Project 1",
                verdict: "would-dispatch" as const,
                blockedBy: null,
                gates: [{ gate: "enabled", passed: true, detail: "enabled=true" }],
              },
              error: null,
            },
          }
        : row,
    );

    render(<ProjectDevFlowCard {...baseProps} automations={automations} />);

    expect(screen.getByText("verdictWouldDispatch")).toBeInTheDocument();
  });

  test("renders an amber blocked verdict with the blocking gate once diagnosis is loaded", () => {
    const automations = baseAutomations.map((row) =>
      row.automationId === "backlog-drain"
        ? {
            ...row,
            diagnosis: {
              status: "loaded" as const,
              result: {
                configId: "agent-1",
                name: "Backlog drain",
                projectId: "p1",
                projectName: "Project 1",
                verdict: "blocked" as const,
                blockedBy: "quota",
                gates: [{ gate: "quota", passed: false, detail: "Workspace quota exhausted" }],
              },
              error: null,
            },
          }
        : row,
    );

    render(<ProjectDevFlowCard {...baseProps} automations={automations} />);

    expect(screen.getByText(/verdictBlocked/)).toBeInTheDocument();
    expect(screen.getByText(/workspace quota exhausted/i)).toBeInTheDocument();
  });

  test("explains why Pi is unavailable for the read-only dev-flow default", () => {
    render(<ProjectDevFlowCard {...baseProps} />);

    expect(screen.getByText("piReadOnlyUnavailable")).toBeInTheDocument();
  });

  test("renders retained notices for raw future card defaults", () => {
    const { container } = render(
      <ProjectDevFlowCard
        {...baseProps}
        settings={{
          ...baseProps.settings,
          codingAgent: "future-agent",
          aiProvider: "future-provider",
          model: "future-model",
          reasoningLevel: "future-effort",
        }}
      />,
    );

    const retainedNotices = [...container.querySelectorAll("p")]
      .filter((element) => element.textContent?.includes("retainedValue"));
    const noticeText = retainedNotices.map((element) => element.textContent).join(" ");
    expect(retainedNotices).toHaveLength(4);
    expect(noticeText).toContain("future-agent");
    expect(noticeText).toContain("future-provider");
    expect(noticeText).toContain("future-model");
    expect(noticeText).toContain("future-effort");
  });
});
