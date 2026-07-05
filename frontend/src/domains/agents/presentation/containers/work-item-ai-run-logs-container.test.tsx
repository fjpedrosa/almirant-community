import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { render, screen, fireEvent } from "@testing-library/react";
import { Window } from "happy-dom";

// ─── Polyfills for happy-dom ────────────────────────────────────────────
const happyWindow = new Window();

beforeAll(() => {
  globalThis.requestAnimationFrame ??= ((callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(0), 0)) as unknown as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame ??= ((id: number) =>
    window.clearTimeout(id)) as unknown as typeof cancelAnimationFrame;

  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  if (typeof globalThis.MouseEvent === "undefined") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).MouseEvent = happyWindow.MouseEvent;
  }
  if (typeof globalThis.CustomEvent === "undefined") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).CustomEvent = happyWindow.CustomEvent;
  }
});

afterAll(() => {
  mock.restore();
});

// ─── Mock the agent-run-logs hooks module ───────────────────────────────
mock.module("../../application/hooks/use-agent-run-logs", () => ({
  useAgentRunsByWorkItem: () => ({
    runs: [
      {
        id: "run-1",
        provider: "claude-code",
        status: "completed",
        createdAt: "2026-04-17T12:00:00.000Z",
        startedAt: "2026-04-17T12:00:00.000Z",
        completedAt: "2026-04-17T12:05:00.000Z",
        failedAt: null,
        errorMessage: null,
        sessionId: null,
        config: { model: "claude-sonnet-5" },
      },
    ],
    total: 1,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: () => Promise.resolve(),
  }),
  useInfiniteAgentJobLogs: () => ({
    logs: [],
    meta: { hasMore: false, nextCursor: null },
    hasMore: false,
    fetchNextPage: () => Promise.resolve(),
    isLoading: false,
    isFetching: false,
    isFetchingNextPage: false,
    isError: false,
    error: null,
    refetch: () => Promise.resolve(),
  }),
  useAgentTranscript: () => ({
    transcript: "hello from fake transcript",
    chunks: [
      { seq: 1, message: "hello", timestamp: "2026-04-17T12:00:00Z" },
    ],
    hasMore: false,
    nextCursor: null,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: () => Promise.resolve(),
  }),
}));

// ─── Mock the live timer (just returns Date.now()) ──────────────────────
mock.module("../../application/hooks/use-live-timer", () => ({
  useLiveTimer: () => Date.now(),
}));

// ─── Mock the timeline component so we don't care about its DOM ─────────
mock.module("../components/agent-job-logs-timeline", () => ({
  AgentJobLogsTimeline: () => <div data-testid="logs-timeline" />,
}));

// ─── Mock Radix Select so we don't need full Radix runtime ──────────────
mock.module("@/components/ui/select", () => ({
  Select: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  SelectContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  SelectItem: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  SelectTrigger: ({ children }: React.PropsWithChildren) => (
    <div>{children}</div>
  ),
  SelectValue: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
}));

// ─── Mock next/link to avoid Next runtime ───────────────────────────────
mock.module("next/link", () => ({
  default: ({
    children,
    href,
  }: React.PropsWithChildren<{ href: string }>) => (
    <a href={href}>{children}</a>
  ),
}));

const { WorkItemAiRunLogsContainer } = await import(
  "./work-item-ai-run-logs-container"
);

// ─── Tests ──────────────────────────────────────────────────────────────

describe("WorkItemAiRunLogsContainer", () => {
  it("renders SessionTranscript with adapted messages when Transcript tab is active", () => {
    render(<WorkItemAiRunLogsContainer workItemId="wi-test" />);

    // Switch to the transcript tab
    fireEvent.click(screen.getByRole("button", { name: "Transcript" }));

    expect(screen.getByText("hello")).toBeInTheDocument();
  });
});
