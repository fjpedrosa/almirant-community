import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import type { AgentSessionDetail, TimelinePhase } from "../../domain/types";
import type { SessionDetailViewProps } from "./session-detail-view";

// happy-dom (the test DOM) doesn't implement requestAnimationFrame — guard
// against components (or their dependencies, e.g. recharts inside
// SessionResourceSidebar) that schedule one.
beforeAll(() => {
  if (typeof globalThis.requestAnimationFrame !== "function") {
    globalThis.requestAnimationFrame = (callback: FrameRequestCallback) =>
      setTimeout(() => callback(Date.now()), 0) as unknown as number;
  }
  if (typeof globalThis.cancelAnimationFrame !== "function") {
    globalThis.cancelAnimationFrame = (handle: number) => clearTimeout(handle);
  }
});

// ─── Capture the real modules BEFORE mocking them ──────────────────────
// `mock.module()` writes into Bun's shared, process-global registry and
// `mock.restore()` does NOT undo it, so leaving `@/lib/hooks` and
// `./session-transcript` un-restored would leak this file's mocks (forced
// desktop, stubbed transcript) into every other consumer that runs
// afterward in the same `bun test` process.
const realLibHooksExports = { ...(await import("@/lib/hooks")) };
const realSessionTranscriptExports = {
  ...(await import("./session-transcript")),
};

afterAll(() => {
  mock.module("@/lib/hooks", () => realLibHooksExports);
  mock.module("./session-transcript", () => realSessionTranscriptExports);
});

// Force the desktop branch of SessionDetailView — the one under test here.
mock.module("@/lib/hooks", () => ({
  useIsMobile: () => false,
}));

mock.module("./session-transcript", () => ({
  SessionTranscript: () => <div data-testid="session-transcript-stub" />,
}));

const { SessionDetailView } = await import("./session-detail-view");

const job: AgentSessionDetail["job"] = {
  id: "job-1234567890",
  workItemId: null,
  projectId: null,
  boardId: null,
  jobType: "implementation",
  status: "running",
  provider: "claude-code",
  codingAgent: "claude-code",
  model: "sonnet",
  priority: "medium",
  branchName: null,
  prUrl: null,
  prNumber: null,
  cost: null,
  tokensUsed: null,
  durationMs: null,
  errorMessage: null,
  sessionId: "session-1234567890",
  createdAt: "2026-01-01T00:00:00.000Z",
  startedAt: "2026-01-01T00:00:00.000Z",
  completedAt: null,
};

const detail: AgentSessionDetail = {
  job,
  workItem: null,
  project: null,
  board: null,
  planningSession: null,
  createdByUser: null,
};

const samplePhases: TimelinePhase[] = [
  {
    id: "phase-implement",
    label: "Implementing",
    status: "active",
    startedAt: "2026-01-01T00:00:01.000Z",
    eventCount: 3,
  },
];

const createBaseProps = (
  overrides: Partial<SessionDetailViewProps> = {},
): SessionDetailViewProps => ({
  detail,
  chunks: [],
  isLive: false,
  isLoading: false,
  currentTime: 0,
  duration: null,
  messages: [],
  transcript: "",
  isStreaming: false,
  isTranscriptLoading: false,
  phases: [],
  isActive: false,
  isCancelling: false,
  elapsedTime: "0s",
  onStop: () => {},
  ...overrides,
});

// Community kept its own "single right rail" redesign (progress + live
// resources) instead of adopting cloud's rail (which folded the session
// metadata fields into it and dropped the resource sidebar for a
// backoffice-only view — self-hosted has no separate backoffice, so the
// resource sidebar stays here). These assertions cover community's actual
// desktop structure rather than cloud's.
describe("SessionDetailView (desktop layout)", () => {
  it("renders the session metadata fields (Job ID, Session ID) in the header row", () => {
    render(<SessionDetailView {...createBaseProps()} />);

    expect(screen.getByText("Job ID")).toBeInTheDocument();
    expect(screen.getByText("Session ID")).toBeInTheDocument();
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
    expect(screen.getByTestId("session-transcript-stub")).toBeInTheDocument();
  });

  it("renders Pi with its label and coding-agent icon", () => {
    const piDetail: AgentSessionDetail = {
      ...detail,
      job: { ...job, codingAgent: "pi" },
    };
    const { container } = render(
      <SessionDetailView {...createBaseProps({ detail: piDetail })} />,
    );

    expect(screen.getByText("Pi")).toBeInTheDocument();
    expect(container.querySelector(".lucide-cpu")).toBeInTheDocument();
  });

  it("retains an unknown persisted coding-agent label with a safe fallback icon", () => {
    const unknownDetail: AgentSessionDetail = {
      ...detail,
      job: {
        ...job,
        codingAgent: "future-agent" as AgentSessionDetail["job"]["codingAgent"],
      },
    };
    const { container } = render(
      <SessionDetailView {...createBaseProps({ detail: unknownDetail })} />,
    );

    expect(screen.getByText("future-agent")).toBeInTheDocument();
    expect(container.querySelector(".lucide-cpu")).toBeInTheDocument();
  });

  it("shows the phase progress in the right rail when phases exist", () => {
    render(<SessionDetailView {...createBaseProps({ phases: samplePhases })} />);

    expect(screen.getByText("Progress")).toBeInTheDocument();
    expect(screen.getByText("Implementing")).toBeInTheDocument();
  });

  it("never renders the mobile Info/Resources/Transcript tabs", () => {
    render(<SessionDetailView {...createBaseProps()} />);

    expect(screen.queryByRole("tab", { name: "Info" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Resources" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Transcript" })).not.toBeInTheDocument();
  });
});
