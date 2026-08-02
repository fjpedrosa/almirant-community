import React from "react";
import { beforeAll, describe, expect, test, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DevFlowAutomationRow } from "./project-dev-flow-automation-row";
import { EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE } from "../../domain/dev-flow-automation-overrides";
import type { DevFlowAutomationRowProps, ProjectDevFlowAutomationRow } from "../../domain/types";

mock.module("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

// Radix's Collapsible (used for the row's expand/collapse) schedules a
// mount-animation rAF — same shim as conversation-timeline.test.tsx.
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

const baseRow: ProjectDevFlowAutomationRow = {
  automationId: "backlog-drain",
  name: "Backlog drain",
  description: "Picks ready Backlog work items on each tick and enqueues implementation jobs.",
  configId: "agent-1",
  enabled: true,
  lastRunAt: null,
  isSkippedForUserAgent: false,
  diagnosis: { status: "idle", result: null, error: null },
  effective: {
    codingAgent: "claude-code",
    aiProvider: "anthropic",
    model: "claude-opus-5",
    reasoningLevel: "high",
    maxConcurrentJobs: 2,
    schedule: { expression: "*/5 * * * *", timezone: "UTC" },
  },
  override: EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE,
  hasChanges: false,
  isSaving: false,
  isAdopting: false,
};

const baseProps: DevFlowAutomationRowProps = {
  row: baseRow,
  onDiagnose: noop,
  onFieldChange: noop,
  onScheduleChange: noop,
  onSave: noop,
  onDiscard: noop,
  onResetToDefaults: noop,
  onAdopt: noop,
};

describe("DevFlowAutomationRow", () => {
  test("renders collapsed by default: name, effective summary and enabled badge, but not the runtime editor", () => {
    render(<DevFlowAutomationRow {...baseProps} />);

    expect(screen.getByText("Backlog drain")).toBeInTheDocument();
    expect(screen.getByText("claude-code · claude-opus-5 · high · */5 * * * *")).toBeInTheDocument();
    expect(screen.getByText("enabledBadge")).toBeInTheDocument();
    expect(screen.queryByText("resetToDefaults")).toBeNull();
  });

  test("expanding the row reveals the runtime editor fields", async () => {
    const user = userEvent.setup();
    render(<DevFlowAutomationRow {...baseProps} />);

    await user.click(screen.getByRole("button", { name: "expand:{\"name\":\"Backlog drain\"}" }));

    expect(screen.getByText("resetToDefaults")).toBeInTheDocument();
  });

  test("clicking Reset to defaults calls onResetToDefaults with the automationId", async () => {
    const onResetToDefaults = mock(() => {});
    const user = userEvent.setup();
    render(<DevFlowAutomationRow {...baseProps} onResetToDefaults={onResetToDefaults} />);

    await user.click(screen.getByRole("button", { name: "expand:{\"name\":\"Backlog drain\"}" }));
    await user.click(screen.getByRole("button", { name: "resetToDefaults" }));

    expect(onResetToDefaults).toHaveBeenCalledWith("backlog-drain");
  });

  test("toggling the individual enabled switch calls onFieldChange with the flipped value", async () => {
    const onFieldChange = mock(() => {});
    const user = userEvent.setup();
    render(<DevFlowAutomationRow {...baseProps} onFieldChange={onFieldChange} />);

    await user.click(screen.getByRole("button", { name: "expand:{\"name\":\"Backlog drain\"}" }));
    await user.click(screen.getByRole("switch"));

    expect(onFieldChange).toHaveBeenCalledWith("backlog-drain", "enabled", false);
  });

  test("shows 'inherited' when the enabled override is null and 'overridden' once it's explicitly set", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<DevFlowAutomationRow {...baseProps} />);
    await user.click(screen.getByRole("button", { name: "expand:{\"name\":\"Backlog drain\"}" }));

    expect(screen.getByText("inherited")).toBeInTheDocument();

    rerender(
      <DevFlowAutomationRow
        {...baseProps}
        row={{ ...baseRow, override: { ...EMPTY_DEV_FLOW_AUTOMATION_OVERRIDE, enabled: false } }}
      />,
    );

    expect(screen.getByText("overridden")).toBeInTheDocument();
  });

  test("changing the max concurrent jobs input calls onFieldChange with the parsed number", async () => {
    const onFieldChange = mock(() => {});
    const user = userEvent.setup();
    render(<DevFlowAutomationRow {...baseProps} onFieldChange={onFieldChange} />);

    await user.click(screen.getByRole("button", { name: "expand:{\"name\":\"Backlog drain\"}" }));
    const input = screen.getByLabelText("fields.maxConcurrentJobs");
    await user.clear(input);
    await user.type(input, "5");

    expect(onFieldChange).toHaveBeenLastCalledWith("backlog-drain", "maxConcurrentJobs", 5);
  });

  test("does not render the Save/Discard footer when hasChanges is false", async () => {
    const user = userEvent.setup();
    render(<DevFlowAutomationRow {...baseProps} />);
    await user.click(screen.getByRole("button", { name: "expand:{\"name\":\"Backlog drain\"}" }));

    expect(screen.queryByRole("button", { name: "save" })).toBeNull();
  });

  test("renders Save/Discard and wires them to onSave/onDiscard when hasChanges is true", async () => {
    const onSave = mock(() => {});
    const onDiscard = mock(() => {});
    const user = userEvent.setup();
    render(<DevFlowAutomationRow {...baseProps} row={{ ...baseRow, hasChanges: true }} onSave={onSave} onDiscard={onDiscard} />);

    await user.click(screen.getByRole("button", { name: "expand:{\"name\":\"Backlog drain\"}" }));
    await user.click(screen.getByRole("button", { name: "save" }));
    await user.click(screen.getByRole("button", { name: "discard" }));

    expect(onSave).toHaveBeenCalledWith("backlog-drain");
    expect(onDiscard).toHaveBeenCalledWith("backlog-drain");
  });

  test("does not render the Adopt button when the row is not skipped for an existing user agent", () => {
    render(<DevFlowAutomationRow {...baseProps} />);
    expect(screen.queryByRole("button", { name: "adopt" })).toBeNull();
  });

  test("renders the Adopt button when skipped, and clicking it shows an inline confirm instead of calling onAdopt immediately", async () => {
    const onAdopt = mock(() => {});
    const user = userEvent.setup();
    render(
      <DevFlowAutomationRow {...baseProps} row={{ ...baseRow, isSkippedForUserAgent: true }} onAdopt={onAdopt} />,
    );

    await user.click(screen.getByRole("button", { name: "adopt" }));

    expect(onAdopt).not.toHaveBeenCalled();
    expect(screen.getByText("adoptConfirmBody")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "adoptConfirmAction" })).toBeInTheDocument();
  });

  test("confirming the inline adopt prompt calls onAdopt with the automationId", async () => {
    const onAdopt = mock(() => {});
    const user = userEvent.setup();
    render(
      <DevFlowAutomationRow {...baseProps} row={{ ...baseRow, isSkippedForUserAgent: true }} onAdopt={onAdopt} />,
    );

    await user.click(screen.getByRole("button", { name: "adopt" }));
    await user.click(screen.getByRole("button", { name: "adoptConfirmAction" }));

    expect(onAdopt).toHaveBeenCalledWith("backlog-drain");
  });

  test("cancelling the inline adopt prompt hides it without calling onAdopt", async () => {
    const onAdopt = mock(() => {});
    const user = userEvent.setup();
    render(
      <DevFlowAutomationRow {...baseProps} row={{ ...baseRow, isSkippedForUserAgent: true }} onAdopt={onAdopt} />,
    );

    await user.click(screen.getByRole("button", { name: "adopt" }));
    await user.click(screen.getByRole("button", { name: "adoptConfirmCancel" }));

    expect(onAdopt).not.toHaveBeenCalled();
    expect(screen.queryByText("adoptConfirmBody")).toBeNull();
  });

  test("disables the adopt confirm action while isAdopting is true", async () => {
    const user = userEvent.setup();
    render(
      <DevFlowAutomationRow
        {...baseProps}
        row={{ ...baseRow, isSkippedForUserAgent: true, isAdopting: true }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "adopt" }));

    expect(screen.getByRole("button", { name: "adopting" })).toBeDisabled();
  });

  test("disables Diagnose when there is no configId, and calls onDiagnose with the configId when present", async () => {
    const onDiagnose = mock(() => {});
    const user = userEvent.setup();
    const { rerender } = render(
      <DevFlowAutomationRow {...baseProps} row={{ ...baseRow, configId: null }} onDiagnose={onDiagnose} />,
    );
    expect(screen.getByRole("button", { name: 'diagnoseAria:{"name":"Backlog drain"}' })).toBeDisabled();

    rerender(<DevFlowAutomationRow {...baseProps} row={baseRow} onDiagnose={onDiagnose} />);
    await user.click(screen.getByRole("button", { name: 'diagnoseAria:{"name":"Backlog drain"}' }));

    expect(onDiagnose).toHaveBeenCalledWith("agent-1");
  });

  test("renders the would-dispatch verdict once diagnosis is loaded", () => {
    render(
      <DevFlowAutomationRow
        {...baseProps}
        row={{
          ...baseRow,
          diagnosis: {
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
        }}
      />,
    );

    expect(screen.getByText("verdictWouldDispatch")).toBeInTheDocument();
  });

  test("shows the generic 'Default runtime behavior' placeholder when the effective coding agent is null/absent", async () => {
    const user = userEvent.setup();
    render(
      <DevFlowAutomationRow
        {...baseProps}
        row={{ ...baseRow, effective: { ...baseRow.effective, codingAgent: null as unknown as string } }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "expand:{\"name\":\"Backlog drain\"}" }));

    // The Radix Select renders the placeholder text inside the trigger when no value is selected.
    expect(screen.getByText("defaultRuntimeBehavior")).toBeInTheDocument();
  });

  test("shows the 'No limit' placeholder (not the raw null) for max concurrent jobs when the card default is undefined", async () => {
    const user = userEvent.setup();
    render(
      <DevFlowAutomationRow
        {...baseProps}
        row={{ ...baseRow, effective: { ...baseRow.effective, maxConcurrentJobs: null as unknown as number } }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "expand:{\"name\":\"Backlog drain\"}" }));

    const input = screen.getByLabelText("fields.maxConcurrentJobs") as HTMLInputElement;
    expect(input.placeholder).toBe("noLimit");
    expect(input.placeholder).not.toContain("null");
  });
});
