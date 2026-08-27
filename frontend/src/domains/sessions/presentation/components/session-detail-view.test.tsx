import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import type { AgentSessionDetail } from "../../domain/types";
import type { SessionDetailViewProps } from "./session-detail-view";

beforeAll(() => {
  if (typeof globalThis.requestAnimationFrame !== "function") {
    globalThis.requestAnimationFrame = (callback: FrameRequestCallback) =>
      setTimeout(() => callback(Date.now()), 0) as unknown as number;
  }
  if (typeof globalThis.cancelAnimationFrame !== "function") {
    globalThis.cancelAnimationFrame = (handle: number) => clearTimeout(handle);
  }
});

const realLibHooksExports = { ...(await import("@/lib/hooks")) };
const realSessionTranscriptExports = {
  ...(await import("./session-transcript")),
};

afterAll(() => {
  mock.module("@/lib/hooks", () => realLibHooksExports);
  mock.module("./session-transcript", () => realSessionTranscriptExports);
});

mock.module("@/lib/hooks", () => ({
  useIsMobile: () => true,
}));

mock.module("./session-transcript", () => ({
  SessionTranscript: () => <div data-testid="session-transcript-stub" />,
}));

const { SessionDetailView } = await import("./session-detail-view");

const job: AgentSessionDetail["job"] = {
  id: "job-mobile-1234567890",
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
  sessionId: "session-mobile-1234567890",
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

const openInfoTab = () => {
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Info" }));
};

describe("SessionDetailView (mobile layout)", () => {
  it("preserves Community's Info, Resources, and Transcript tabs", () => {
    render(<SessionDetailView {...createBaseProps()} />);

    expect(screen.getByRole("tab", { name: "Info" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Resources" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Transcript" })).toBeInTheDocument();
    expect(screen.getByTestId("session-transcript-stub")).toBeInTheDocument();
  });

  it("keeps the existing Claude Code display unchanged", () => {
    render(<SessionDetailView {...createBaseProps()} />);
    openInfoTab();

    expect(screen.getByText("Claude Code")).toBeInTheDocument();
  });

  it("renders Pi with its label and coding-agent icon", () => {
    const piDetail: AgentSessionDetail = {
      ...detail,
      job: { ...job, codingAgent: "pi" },
    };
    const { container } = render(
      <SessionDetailView {...createBaseProps({ detail: piDetail })} />,
    );
    openInfoTab();

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
    openInfoTab();

    expect(screen.getByText("future-agent")).toBeInTheDocument();
    expect(container.querySelector(".lucide-cpu")).toBeInTheDocument();
  });
});
