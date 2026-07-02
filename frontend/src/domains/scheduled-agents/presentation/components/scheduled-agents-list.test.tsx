import { describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ScheduledAgentsList } from "./scheduled-agents-list";
import type { ScheduledAgentConfig } from "../../domain/types";

const noop = () => {};

const baseScheduledAgent: ScheduledAgentConfig = {
  id: "scheduled-agent-1",
  workspaceId: "org-1",
  projectId: "project-1",
  projectName: "Proyecto Demo",
  skillId: null,
  skillName: null,
  name: "Daily follow-up",
  description: null,
  prompt: null,
  jobType: "scheduled",
  provider: "codex",
  codingAgent: "codex",
  aiProvider: "openai",
  aiModel: "gpt-5",
  reasoningLevel: "medium",
  trigger: "scheduled",
  webhookToken: null,
  scheduleType: "time_window",
  scheduleConfig: {
    startHour: 9,
    endHour: 17,
    daysOfWeek: [1, 3, 5],
  },
  timezone: "Europe/Madrid",
  enabled: true,
  targetConfig: {},
  mcpServers: null,
  maxJobsPerRun: 1,
  lastRunAt: null,
  createdAt: "2026-04-15T00:00:00.000Z",
  updatedAt: "2026-04-15T00:00:00.000Z",
};

describe("ScheduledAgentsList", () => {
  it("muestra solo la hora de inicio para ventanas horarias", () => {
    render(
      <ScheduledAgentsList
        items={[baseScheduledAgent]}
        isLoading={false}
        triggeringId={null}
        onToggle={noop}
        onEdit={noop}
        onDelete={noop}
        onTrigger={noop}
      />,
    );

    expect(screen.getByText("09:00 (Mon, Wed, Fri)")).toBeInTheDocument();
    expect(screen.queryByText(/17:00/)).toBeNull();
  });

  it("muestra proyecto/skill y agente/modelo en columnas compactas", () => {
    render(
      <ScheduledAgentsList
        items={[{
          ...baseScheduledAgent,
          skillName: "nightly-fix",
          projectName: "Flatzer",
          name: "Nightly Backlog Implementation",
        }]}
        isLoading={false}
        triggeringId={null}
        onToggle={noop}
        onEdit={noop}
        onDelete={noop}
        onTrigger={noop}
      />,
    );

    expect(screen.getByText("Project / Skill")).toBeInTheDocument();
    expect(screen.getByText("Coding Agent / Model")).toBeInTheDocument();
    expect(screen.getByText("Flatzer")).toBeInTheDocument();
    expect(screen.getByText("nightly-fix")).toBeInTheDocument();
    expect(screen.getByText("Codex")).toBeInTheDocument();
    expect(screen.getByText("gpt-5")).toBeInTheDocument();
  });

  it("copia el endpoint cuando el trigger es webhook", async () => {
    const writeText = mock(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <ScheduledAgentsList
        items={[{
          ...baseScheduledAgent,
          id: "webhook-agent-1",
          trigger: "webhook",
          webhookToken: "copy-token",
          scheduleType: "manual",
          scheduleConfig: null,
        }]}
        isLoading={false}
        triggeringId={null}
        onToggle={noop}
        onEdit={noop}
        onDelete={noop}
        onTrigger={noop}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Copy webhook endpoint" }));

    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/webhooks/agents/webhook-agent-1?token=copy-token`,
    );
  });
});
