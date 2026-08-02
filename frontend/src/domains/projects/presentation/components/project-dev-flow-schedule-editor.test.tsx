import React from "react";
import { describe, expect, test, mock } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { ProjectDevFlowScheduleEditor } from "./project-dev-flow-schedule-editor";

mock.module("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

const effective = { expression: "*/5 * * * *", timezone: "UTC" };

describe("ProjectDevFlowScheduleEditor", () => {
  test("renders a button for every cron preset", () => {
    render(
      <ProjectDevFlowScheduleEditor automationName="Backlog drain" value={null} effective={effective} onChange={() => {}} />,
    );

    expect(screen.getByRole("button", { name: "5m" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Daily" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Weekly" })).toBeInTheDocument();
  });

  test("clicking a preset overrides the schedule with that expression and no timezone override, when there was no prior override", async () => {
    const onChange = mock(() => {});
    render(
      <ProjectDevFlowScheduleEditor
        automationName="Backlog drain"
        value={null}
        effective={effective}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "15m" }));

    expect(onChange).toHaveBeenCalledWith({ expression: "*/15 * * * *", timezone: null });
  });

  test("clicking a preset preserves an already-overridden timezone", async () => {
    const onChange = mock(() => {});
    render(
      <ProjectDevFlowScheduleEditor
        automationName="Backlog drain"
        value={{ expression: "0 9 * * *", timezone: "Europe/Madrid" }}
        effective={effective}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "1h" }));

    expect(onChange).toHaveBeenCalledWith({ expression: "0 * * * *", timezone: "Europe/Madrid" });
  });

  test("shows the current override's expression as the input value", () => {
    render(
      <ProjectDevFlowScheduleEditor
        automationName="Backlog drain"
        value={{ expression: "0 9 * * *", timezone: null }}
        effective={effective}
        onChange={() => {}}
      />,
    );

    expect(screen.getByDisplayValue("0 9 * * *")).toBeInTheDocument();
  });

  test("leaves the input empty (placeholder shows the effective expression) when there is no override", () => {
    render(
      <ProjectDevFlowScheduleEditor automationName="Backlog drain" value={null} effective={effective} onChange={() => {}} />,
    );

    const input = screen.getByLabelText("fields.schedule") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(input.placeholder).toContain("*/5 * * * *");
  });

  test("typing a custom expression calls onChange with the trimmed expression, preserving any timezone override", () => {
    const onChange = mock(() => {});
    render(
      <ProjectDevFlowScheduleEditor
        automationName="Backlog drain"
        value={{ expression: "0 9 * * *", timezone: "Europe/Madrid" }}
        effective={effective}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("fields.schedule"), { target: { value: "0 10 * * *" } });

    expect(onChange).toHaveBeenCalledWith({ expression: "0 10 * * *", timezone: "Europe/Madrid" });
  });

  test("clearing the custom expression input clears the whole schedule override (back to inherit)", () => {
    const onChange = mock(() => {});
    render(
      <ProjectDevFlowScheduleEditor
        automationName="Backlog drain"
        value={{ expression: "0 9 * * *", timezone: "Europe/Madrid" }}
        effective={effective}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("fields.schedule"), { target: { value: "   " } });

    expect(onChange).toHaveBeenCalledWith(null);
  });

  test("disables the expression input and preset buttons when disabled is true", () => {
    render(
      <ProjectDevFlowScheduleEditor
        automationName="Backlog drain"
        value={null}
        effective={effective}
        onChange={() => {}}
        disabled
      />,
    );

    expect(screen.getByLabelText("fields.schedule")).toBeDisabled();
    expect(screen.getByRole("button", { name: "5m" })).toBeDisabled();
  });
});
