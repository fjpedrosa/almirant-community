import { act, renderHook, waitFor } from "@testing-library/react";
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PlanningSession } from "../../domain/types";
import type { PlanReviewHydrationResponse } from "@/domains/ai-planning/domain/types";
import type { SeedWithRelations } from "../../domain/types";
import { ActiveOrgProvider } from "@/domains/teams/application/active-org-context";

mock.module("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const { usePlanningSession } = await import("./use-planning-session");
const { usePlanningSessionLifecycle } = await import(
  "@/domains/ai-planning/application/hooks/use-planning-session-lifecycle"
);

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

const makeSession = (id: string): PlanningSession => ({
  id,
  workspaceId: "workspace-1",
  status: "active",
  title: id,
  projectId: "project-1",
  boardId: "board-1",
  config: null,
  result: null,
  createdByUserId: "user-1",
  totalInputTokens: 0,
  totalOutputTokens: 0,
  estimatedCost: null,
  durationMs: null,
  completedAt: null,
  createdAt: "2026-08-22T00:00:00.000Z",
  updatedAt: "2026-08-22T00:00:00.000Z",
  seedCount: 0,
  workItemCount: 0,
  createdByUserName: null,
  createdByUserImage: null,
  projectName: "Project",
  boardName: "Board",
});

const makeReviewState = (
  sessionId: string,
  overrides: Partial<PlanReviewHydrationResponse> = {},
): PlanReviewHydrationResponse => ({
  planningSessionId: sessionId,
  originalPlanSha256: null,
  reviewJobId: null,
  status: "idle",
  error: null,
  createdItemIds: [],
  ...overrides,
});

const sessionResponses = new Map<string, PlanningSession>();
const reviewResponses = new Map<string, PlanReviewHydrationResponse>();
const sessionDeferreds = new Map<string, Deferred<PlanningSession>>();
const reviewDeferreds = new Map<string, Deferred<PlanReviewHydrationResponse>>();
const seedDeferreds = new Map<string, Deferred<SeedWithRelations[]>>();
const hydrationWireResponses: PlanReviewHydrationResponse[] = [];
const originalFetch = globalThis.fetch;

const jsonResponse = (data: unknown): Response => new Response(
  JSON.stringify({ success: true, data }),
  { status: 200, headers: { "Content-Type": "application/json" } },
);

const fetchMock = mock(async (input: RequestInfo | URL) => {
  const url = new URL(String(input), "http://localhost");
  const pathParts = url.pathname.split("/").filter(Boolean);
  const sessionId = pathParts[pathParts.indexOf("planning-sessions") + 1];

  if (url.pathname.endsWith("/plan-review") && sessionId) {
    const state = await (
      reviewDeferreds.get(sessionId)?.promise ??
      Promise.resolve(reviewResponses.get(sessionId) ?? makeReviewState(sessionId))
    );
    hydrationWireResponses.push(state);
    return jsonResponse(state);
  }

  if (url.pathname.endsWith("/seeds") && sessionId) {
    return jsonResponse(await (
      seedDeferreds.get(sessionId)?.promise ?? Promise.resolve([])
    ));
  }

  if (url.pathname.endsWith("/resume") && sessionId) {
    const session = await (
      sessionDeferreds.get(sessionId)?.promise ??
      Promise.resolve(sessionResponses.get(sessionId) ?? makeSession(sessionId))
    );
    return jsonResponse(session);
  }

  if (url.pathname.endsWith("/work-items") || url.pathname.endsWith("/session-events")) {
    return jsonResponse([]);
  }

  if (url.pathname === "/api/agent-jobs" || url.pathname === "/agent-jobs") {
    return jsonResponse([]);
  }

  if (sessionId) {
    const session = await (
      sessionDeferreds.get(sessionId)?.promise ??
      Promise.resolve(sessionResponses.get(sessionId) ?? makeSession(sessionId))
    );
    return jsonResponse(session);
  }

  throw new Error(`Unexpected test fetch: ${url.pathname}`);
});

const createWrapper = (queryClient: QueryClient) => {
  const Wrapper = ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={queryClient}>
      <ActiveOrgProvider initialActiveOrgId="workspace-1">{children}</ActiveOrgProvider>
    </QueryClientProvider>;
  Wrapper.displayName = "PlanningSessionHydrationQueryClientWrapper";
  return Wrapper;
};

const renderPlanningSession = () => renderHook(() => usePlanningSession(), {
  wrapper: createWrapper(new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })),
});

beforeEach(() => {
  sessionResponses.clear();
  reviewResponses.clear();
  sessionDeferreds.clear();
  reviewDeferreds.clear();
  seedDeferreds.clear();
  hydrationWireResponses.length = 0;
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  mock.restore();
});

describe("usePlanningSession durable plan-review hydration", () => {
  test("hydrates empty, queued, and applied outcomes from a cold query cache", async () => {
    const hook = renderPlanningSession();

    expect(hook.result.current.sessionId).toBeNull();
    expect(hook.result.current.planReview.status).toBe("idle");

    sessionResponses.set("session-1", makeSession("session-1"));
    reviewResponses.set("session-1", makeReviewState("session-1"));
    await act(async () => {
      expect(await hook.result.current.loadSession("session-1")).toBe(true);
    });
    expect(hook.result.current.sessionId).toBe("session-1");
    expect(hook.result.current.planReview.status).toBe("idle");
    expect(hook.result.current.planReview.originalPlanSha256).toBeNull();
    expect(fetchMock.mock.calls.some(([input]) =>
      new URL(String(input), "http://localhost").pathname.endsWith("/planning-sessions/session-1/plan-review"),
    )).toBe(true);

    reviewResponses.set("session-1", makeReviewState("session-1", {
      reviewJobId: "review-1",
      status: "pending_review",
      originalPlanSha256: "a".repeat(64),
    }));
    await act(async () => {
      expect(await hook.result.current.loadSession("session-1")).toBe(true);
    });
    expect(hook.result.current.planReview).toMatchObject({
      activeReviewJobId: "review-1",
      status: "pending_review",
      originalPlanSha256: "a".repeat(64),
    });

    reviewResponses.set("session-1", makeReviewState("session-1", {
      status: "completed",
      createdItemIds: ["work-item-1"],
      originalPlanSha256: "b".repeat(64),
    }));
    await act(async () => {
      expect(await hook.result.current.resumeSession("session-1")).not.toBeNull();
    });
    expect(hook.result.current.planReview).toMatchObject({
      activeReviewJobId: null,
      status: "completed",
      createdItemIds: ["work-item-1"],
      originalPlanSha256: "b".repeat(64),
    });

    expect(hydrationWireResponses).toContainEqual({
      planningSessionId: "session-1",
      reviewJobId: "review-1",
      originalPlanSha256: "a".repeat(64),
      status: "pending_review",
      error: null,
      createdItemIds: [],
    });
  });

  test("drops late session A responses after session B becomes authoritative", async () => {
    const sessionA = deferred<PlanningSession>();
    const reviewA = deferred<PlanReviewHydrationResponse>();
    const sessionB = deferred<PlanningSession>();
    const reviewB = deferred<PlanReviewHydrationResponse>();
    sessionDeferreds.set("session-a", sessionA);
    reviewDeferreds.set("session-a", reviewA);
    sessionDeferreds.set("session-b", sessionB);
    reviewDeferreds.set("session-b", reviewB);

    const hook = renderPlanningSession();
    const loadA = hook.result.current.loadSession("session-a");
    const loadB = hook.result.current.loadSession("session-b");

    await act(async () => {
      sessionB.resolve(makeSession("session-b"));
      reviewB.resolve(makeReviewState("session-b", {
        reviewJobId: "review-b",
        status: "pending_review",
        originalPlanSha256: "b".repeat(64),
      }));
      expect(await loadB).toBe(true);
    });

    await act(async () => {
      sessionA.resolve(makeSession("session-a"));
      reviewA.resolve(makeReviewState("session-a", {
        status: "completed",
        createdItemIds: ["wrong-item-a"],
        originalPlanSha256: "a".repeat(64),
      }));
      expect(await loadA).toBe(false);
    });

    expect(hook.result.current.sessionId).toBe("session-b");
    expect(hook.result.current.session?.id).toBe("session-b");
    expect(hook.result.current.planReview).toMatchObject({
      activeReviewJobId: "review-b",
      status: "pending_review",
      createdItemIds: [],
      originalPlanSha256: "b".repeat(64),
    });
  });

  test("drops late session A seed hydration after session B becomes authoritative", async () => {
    const seedA = deferred<SeedWithRelations[]>();
    const seedB = deferred<SeedWithRelations[]>();
    seedDeferreds.set("session-a", seedA);
    seedDeferreds.set("session-b", seedB);

    const sidebar: Parameters<typeof usePlanningSessionLifecycle>[2] = {
      isOpen: false,
      groups: [],
      activeSessionId: null,
      isLoading: false,
      onToggle: mock(),
      onNewSession: mock(),
      onSessionClick: mock(),
      onSessionDelete: mock(),
    };
    const projectBoard: Parameters<typeof usePlanningSessionLifecycle>[1] = {
      projects: [],
      boards: [],
      selectedProjectId: "",
      selectedBoardId: "",
      isLoadingProjects: false,
      isLoadingBoards: false,
      isReady: false,
      onProjectChange: mock(),
      onBoardChange: mock(),
    };
    const generation: Parameters<typeof usePlanningSessionLifecycle>[3] = {
      previewItems: [],
      updateItem: mock(),
      removeItem: mock(),
      confirmGeneration: mock(),
      isConfirming: false,
      isAlreadyCreated: false,
      error: null,
      planReviewError: null,
      planReviewStatus: "idle",
      createdItemIds: [],
      activeItemCount: 0,
      isPendingReview: false,
      resetGeneration: mock(),
    };
    const hook = renderHook(() => {
      const planningSession = usePlanningSession();
      const lifecycle = usePlanningSessionLifecycle(
        planningSession,
        projectBoard,
        sidebar,
        generation,
      );
      return { lifecycle };
    }, {
      wrapper: createWrapper(new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
      })),
    });

    let loadA = Promise.resolve();
    await act(async () => {
      loadA = hook.result.current.lifecycle.onSidebarSessionClick("session-a");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) =>
      new URL(String(input), "http://localhost").pathname.endsWith("/planning-sessions/session-a/seeds"),
    )).toBe(true));

    let loadB = Promise.resolve();
    await act(async () => {
      loadB = hook.result.current.lifecycle.onSidebarSessionClick("session-b");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) =>
      new URL(String(input), "http://localhost").pathname.endsWith("/planning-sessions/session-b/seeds"),
    )).toBe(true));

    await act(async () => {
      seedB.resolve([makeSeed("seed-b", "Seed B")]);
      await loadB;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const seedPrefixResult: { value: string | null } = { value: null };
    await act(async () => {
      seedPrefixResult.value = hook.result.current.lifecycle.consumeSeedContextPrefix();
    });

    await act(async () => {
      seedA.resolve([makeSeed("seed-a", "Seed A")]);
      await loadA;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const lateSeedPrefixResult: { value: string | null } = { value: null };
    await act(async () => {
      lateSeedPrefixResult.value = hook.result.current.lifecycle.consumeSeedContextPrefix();
    });
    expect(seedPrefixResult.value?.includes("Seed B") ?? false).toBe(true);
    expect(lateSeedPrefixResult.value).toBeNull();
  });
});

const makeSeed = (id: string, title: string): SeedWithRelations => ({
  id,
  workspaceId: "workspace-1",
  projectId: null,
  title,
  description: "Description",
  status: "active",
  source: "manual",
  priority: null,
  ownerUserId: null,
  selectedForIdeation: true,
  metadata: {},
  createdByUserId: null,
  createdAt: "2026-08-22T00:00:00.000Z",
  updatedAt: "2026-08-22T00:00:00.000Z",
  maturityLevel: 0,
  owner: null,
  createdBy: null,
  projectName: null,
  commentCount: 0,
  lastComment: null,
  feedbackLinks: [],
  workItemLinks: [],
  tags: [],
});
