import { describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ScheduledAgentConfig } from "../../domain/types";

// This component has no i18n coverage today except for the new 'once'
// strings introduced alongside this test — see messages/{en,es}.json under
// the "scheduledAgents.once" namespace. Returning the raw key (with any
// ICU-ish params inlined) keeps assertions readable without a real provider.
mock.module("next-intl", () => ({
  useTranslations: () =>
    (key: string, values?: Record<string, string | number>) => {
      if (!values) return key;
      return `${key}:${JSON.stringify(values)}`;
    },
}));

const { ScheduledAgentsList } = await import("./scheduled-agents-list");

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
        onRearm={noop}
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
        onRearm={noop}
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
        onRearm={noop}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Copy webhook endpoint" }));

    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/webhooks/agents/webhook-agent-1?token=copy-token`,
    );
  });

  it("etiqueta un agente manual como 'Manual', no como 'Scheduled'", () => {
    render(
      <ScheduledAgentsList
        items={[{
          ...baseScheduledAgent,
          scheduleType: "manual",
          scheduleConfig: null,
          enabled: false,
        }]}
        isLoading={false}
        triggeringId={null}
        onToggle={noop}
        onEdit={noop}
        onDelete={noop}
        onTrigger={noop}
        onRearm={noop}
      />,
    );

    expect(screen.getByText("Manual")).toBeInTheDocument();
    expect(screen.queryByText("Scheduled")).toBeNull();
    // El detalle "Run on demand" ya no contradice al badge.
    expect(screen.getByText("Run on demand")).toBeInTheDocument();
  });

  it("mantiene 'Scheduled' para agentes con una cadencia real", () => {
    render(
      <ScheduledAgentsList
        items={[baseScheduledAgent]}
        isLoading={false}
        triggeringId={null}
        onToggle={noop}
        onEdit={noop}
        onDelete={noop}
        onTrigger={noop}
        onRearm={noop}
      />,
    );

    expect(screen.getByText("Scheduled")).toBeInTheDocument();
    expect(screen.queryByText("Manual")).toBeNull();
  });

  it("explica cómo activar un agente manual deshabilitado", () => {
    render(
      <ScheduledAgentsList
        items={[{
          ...baseScheduledAgent,
          scheduleType: "manual",
          scheduleConfig: null,
          enabled: false,
        }]}
        isLoading={false}
        triggeringId={null}
        onToggle={noop}
        onEdit={noop}
        onDelete={noop}
        onTrigger={noop}
        onRearm={noop}
      />,
    );

    expect(
      screen.getByTitle(/add a .*schedule to enable/i),
    ).toBeInTheDocument();
  });

  it("muestra 'Runs once' con la fecha relativa para un once pendiente", () => {
    const inThreeDays = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

    render(
      <ScheduledAgentsList
        items={[{
          ...baseScheduledAgent,
          scheduleType: "once",
          scheduleConfig: { runAt: inThreeDays },
          enabled: true,
          lastRunAt: null,
        }]}
        isLoading={false}
        triggeringId={null}
        onToggle={noop}
        onEdit={noop}
        onDelete={noop}
        onTrigger={noop}
        onRearm={noop}
      />,
    );

    // 'once.pendingLabel' takes a {date} param — the mocked next-intl
    // renders key:JSON(values), so we just assert the right key fired with
    // a date param roughly 3 days out (Intl.RelativeTimeFormat -> "in 3 days").
    expect(screen.getByText(/^once\.pendingLabel:.*3 days/)).toBeInTheDocument();
    // Pending once agents keep the ordinary 'Scheduled' badge — only an
    // EXECUTED once gets a distinct badge (see the next test).
    expect(screen.getByText("Scheduled")).toBeInTheDocument();
  });

  it("muestra el badge 'Executed' y una accion de re-armar para un once ya ejecutado", async () => {
    const onRearm = mock(() => {});
    const executedItem: ScheduledAgentConfig = {
      ...baseScheduledAgent,
      scheduleType: "once",
      scheduleConfig: { runAt: "2026-04-10T09:00:00.000Z" },
      enabled: false,
      lastRunAt: "2026-04-10T09:00:05.000Z",
    };

    render(
      <ScheduledAgentsList
        items={[executedItem]}
        isLoading={false}
        triggeringId={null}
        onToggle={noop}
        onEdit={noop}
        onDelete={noop}
        onTrigger={noop}
        onRearm={onRearm}
      />,
    );

    expect(screen.getByText(/^once\.executedBadge:/)).toBeInTheDocument();
    expect(screen.queryByText("Scheduled")).toBeNull();

    const rearmButton = screen.getByRole("button", { name: "once.rearmAction" });
    await userEvent.click(rearmButton);

    expect(onRearm).toHaveBeenCalledWith(executedItem);
  });
});
