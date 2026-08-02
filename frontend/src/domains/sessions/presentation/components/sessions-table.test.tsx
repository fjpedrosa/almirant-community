import { afterAll, describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import type { AgentSessionListItem } from "../../domain/types";

// ─── Capture the real modules BEFORE mocking them ──────────────────────
// `mock.module()` replaces the module in Bun's shared, process-global
// registry, and — confirmed against Bun 1.3.14 — `mock.restore()` does NOT
// undo it. Left un-restored, these overrides leak into every test file that
// runs afterward in the same `bun test` process — most notably
// `agent-job-status-badge`, which would leak a status-only stub into
// session-detail-sheet.test.tsx and any other consumer (agent-runs-table.tsx,
// sessions-tab-content.tsx, etc.) that expects the real component or its own
// stub.
//
// The exports are captured via object spread (a plain, one-time property
// copy), NOT by holding on to the `await import(...)` namespace object
// itself — an ES module namespace object is a live view, so its properties
// keep reflecting whatever the LATEST `mock.module()` call for that
// specifier returned, even for code that ran before the mock existed.
// Spreading into a fresh plain object breaks that live link and gives a
// true point-in-time snapshot, which is what afterAll needs to restore.
//
// `next-intl` is deliberately NOT captured/restored here: ~15 other test
// files across the codebase already mock it globally without restoring
// (settings, ai-planning, teams, github, onboarding, analytics, dashboard...),
// so by the time this file runs in the full suite, `await import("next-intl")`
// can already resolve to one of THEIR incomplete stubs instead of the true
// real module — capturing that and re-registering it in afterAll (verified
// empirically) then locks in a broken `next-intl` for whichever file runs
// next, e.g. `SyntaxError: Export named 'useLocale' not found`. Fixing that
// requires the same capture/restore treatment on every one of those other
// files, which is out of scope here (see task report).
//
// `use-formatted-date` is ALSO deliberately not captured/restored via the
// same mechanism, for a related reason (also verified empirically): the
// real `use-formatted-date.ts` itself statically imports `useLocale` from
// "next-intl". Evaluating the real module to snapshot it — which is what
// `await import(...)` does the first time a specifier is touched — runs
// into the exact same already-poisoned `next-intl` mock described above and
// throws `SyntaxError: Export named 'useLocale' not found` before this file
// even gets to its own tests. So this mock is left un-restored too; it has
// no in-scope victim (no other file in domains/sessions or domains/backoffice
// mocks or depends on the real `use-formatted-date` behavior).
const realAgentJobStatusBadgeExports = {
  ...(await import(
    "@/domains/agents/presentation/components/agent-job-status-badge"
  )),
};

afterAll(() => {
  mock.module(
    "@/domains/agents/presentation/components/agent-job-status-badge",
    () => realAgentJobStatusBadgeExports,
  );
});

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

  it("muestra el indicador de ejecución automática junto al usuario cuando el job viene del cron de un scheduled agent", () => {
    const { container } = render(
      <SessionsTable
        sessions={[
          {
            ...baseSession,
            id: "job-3",
            triggerType: "scheduled",
            createdByUserName: "Jane Doe",
            config: { skillName: "runner-implement", source: "scheduled", scheduledDispatchTrigger: "schedule" },
          },
        ]}
        isLoading={false}
        currentTime={Date.now()}
        onOpenSession={() => {}}
      />,
    );

    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(container.querySelector('[title="Ejecución automática"]')).toBeInTheDocument();
  });

  it("no muestra el indicador de ejecución automática para una sesión lanzada manualmente por un usuario", () => {
    const { container } = render(
      <SessionsTable
        sessions={[baseSession]}
        isLoading={false}
        currentTime={Date.now()}
        onOpenSession={() => {}}
      />,
    );

    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(container.querySelector('[title="Ejecución automática"]')).not.toBeInTheDocument();
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
