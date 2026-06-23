import { describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import type { AgentSessionListItem } from "../../domain/types";

mock.module("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));

mock.module("@/domains/shared/application/hooks/use-formatted-date", () => ({
  default: () => ({
    formatDateTime: (value: string) => `formatted:${value}`,
  }),
}));

mock.module("@/domains/agents/presentation/components/agent-job-status-badge", () => ({
  AgentJobStatusBadge: ({
    status,
    errorType,
    errorMessage,
  }: {
    status: string;
    errorType?: string | null;
    errorMessage?: string | null;
  }) => (
    <span data-testid="status-badge">
      {status}:{errorType ?? "none"}:{errorMessage ?? "none"}
    </span>
  ),
}));

const { SessionsTable } = await import("./sessions-table");

const baseSession: AgentSessionListItem = {
  id: "job-1",
  workItemId: "work-1",
  projectId: "project-1",
  boardId: "board-1",
  planningSessionId: null,
  jobType: "implementation",
  status: "running",
  provider: "claude-code",
  codingAgent: "claude-code",
  model: "claude-opus-4-1",
  priority: "medium",
  branchName: null,
  prUrl: null,
  prNumber: null,
  cost: null,
  tokensUsed: null,
  durationMs: 12_000,
  errorMessage: null,
  sessionId: null,
  config: { skillName: "implement" },
  result: null,
  createdAt: "2026-04-12T09:00:00.000Z",
  startedAt: "2026-04-12T09:00:05.000Z",
  completedAt: null,
  failedAt: null,
  workItemTitle: "Fix login bug",
  workItemTaskId: "A-123",
  projectName: "Almirant",
  boardName: "Main",
  planningSessionTitle: null,
  createdByUserName: "Jane Doe",
  createdByUserImage: null,
};

describe("SessionsTable", () => {
  it("muestra el usuario creador debajo de la ejecución", () => {
    render(
      <SessionsTable
        sessions={[baseSession]}
        isLoading={false}
        currentTime={Date.now()}
        projectColors={{ "project-1": "#ff5500" }}
        onOpenSession={() => {}}
      />,
    );

    expect(screen.getByText("Fix login bug")).toBeInTheDocument();
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("JD")).toBeInTheDocument();
    expect(screen.getByText("Almirant").getAttribute("style")).toContain(
      "color: #ff5500",
    );
    expect(screen.queryByText("A-123")).not.toBeInTheDocument();
  });

  it("usa iconos distintos para coding agent y modelo Claude", () => {
    render(
      <SessionsTable
        sessions={[baseSession]}
        isLoading={false}
        currentTime={Date.now()}
        onOpenSession={() => {}}
      />,
    );

    expect(screen.getByLabelText("Claude Code")).toBeInTheDocument();
    expect(screen.getByLabelText("Claude AI")).toBeInTheDocument();
    expect(screen.queryByLabelText("Anthropic")).not.toBeInTheDocument();
  });

  it("muestra Almirant[bot] cuando la sesión la lanza automatización interna", () => {
    const { container } = render(
      <SessionsTable
        sessions={[
          {
            ...baseSession,
            id: "job-2",
            config: { skillName: "feedback-bug-fix", source: "worker" },
            createdByUserName: null,
            createdByUserImage: null,
          },
        ]}
        isLoading={false}
        currentTime={Date.now()}
        onOpenSession={() => {}}
      />,
    );

    expect(screen.getByText("Almirant[bot]")).toBeInTheDocument();
    const botAvatarFallback = container.querySelector('[data-slot="avatar-fallback"]');
    expect(botAvatarFallback?.className).toContain("bg-white");
    expect(botAvatarFallback?.className).toContain("text-black");
  });

  it("agrupa proyecto y skill, normalizando runner-implement como implement", () => {
    render(
      <SessionsTable
        sessions={[
          {
            ...baseSession,
            id: "job-runner",
            provider: "codex",
            codingAgent: "codex",
            model: "gpt-5.2",
            config: { skillName: "runner-implement" },
          },
        ]}
        isLoading={false}
        currentTime={Date.now()}
        onOpenSession={() => {}}
      />,
    );

    expect(screen.getByText("Almirant")).toBeInTheDocument();
    expect(screen.getByText("implement")).toBeInTheDocument();
    expect(screen.queryByText("runner-implement")).not.toBeInTheDocument();
    expect(screen.getByText("Runner")).toBeInTheDocument();
    expect(screen.getByText("Codex")).toBeInTheDocument();
    expect(screen.getByText("gpt-5.2")).toBeInTheDocument();
  });

  it("muestra skills de sistema DoD e integración como ejecuciones Runner", () => {
    render(
      <SessionsTable
        sessions={[
          {
            ...baseSession,
            id: "job-dod-review",
            jobType: "review",
            config: { skillName: "dod-review" },
          },
          {
            ...baseSession,
            id: "job-release-integration",
            jobType: "integration",
            config: undefined,
          },
          {
            ...baseSession,
            id: "job-dod-remediation",
            config: { skillName: "dod-remediation" },
          },
        ]}
        isLoading={false}
        currentTime={Date.now()}
        onOpenSession={() => {}}
      />,
    );

    expect(screen.getByText("dod-review")).toBeInTheDocument();
    expect(screen.getByText("integration")).toBeInTheDocument();
    expect(screen.getByText("dod-remediation")).toBeInTheDocument();
    expect(screen.getAllByText("Runner")).toHaveLength(3);
    expect(screen.queryByText("Local")).not.toBeInTheDocument();
  });

  it("pasa la razón de pausa al badge para no confundir cuota con rate limit", () => {
    render(
      <SessionsTable
        sessions={[
          {
            ...baseSession,
            id: "job-paused-rate-limit",
            status: "paused",
            errorType: "rate_limit",
            errorMessage: "Session hit API rate limit",
          },
        ]}
        isLoading={false}
        currentTime={Date.now()}
        onOpenSession={() => {}}
      />,
    );

    expect(screen.getByTestId("status-badge")).toHaveTextContent(
      "paused:rate_limit:Session hit API rate limit",
    );
  });
});
