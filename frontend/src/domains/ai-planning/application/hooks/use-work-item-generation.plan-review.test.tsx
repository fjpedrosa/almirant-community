import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, mock, test } from "bun:test";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  INITIAL_PLAN_REVIEW_LIFECYCLE_STATE,
  type GeneratedWorkItem,
  type PlanReviewLifecycleState,
} from "../../domain/types";
import type { PlanReviewApi } from "./use-work-item-generation";
import { buildPlanningPageGenerationOptions } from "./planning-page-generation-options";

process.env.NEXT_PUBLIC_BETTER_AUTH_URL = "http://localhost:3000";
const { useWorkItemGeneration } = await import("./use-work-item-generation");

const items: GeneratedWorkItem[] = [
  { tempId: "task-1", type: "task", title: "Task", priority: "medium" },
];

const queuedResponse = (reviewJobId: string, status: "queued" | "pending_review" | "applying" = "queued") => ({
  status,
  reviewJobId,
  reviewResolution: {
    status: "ready" as const,
    degradation: { status: "none" as const, reason: "ready" },
  },
});

const terminalResponse = (reviewJobId: string, status: "applied" | "completed" | "rejected" | "failed") => ({
  ...queuedResponse(reviewJobId),
  status,
  createdIds: status === "applied" || status === "completed" ? ["work-item-1"] : [],
  errors: [],
});

const createApi = (getPlanReviewStatus: PlanReviewApi["getPlanReviewStatus"]): PlanReviewApi => ({
  generateWorkItems: mock(async () => queuedResponse("review-1")),
  getPlanReviewStatus: mock(getPlanReviewStatus),
});

const createClient = () => new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: 0 } },
});

const createWrapper = (queryClient: QueryClient) => {
  const Wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  Wrapper.displayName = "PlanReviewQueryClientWrapper";
  return Wrapper;
};

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

const renderGeneration = (
  api: PlanReviewApi,
  planReviewState: PlanReviewLifecycleState,
  onPlanReviewStateChange: (next: PlanReviewLifecycleState) => void,
  queryClient = createClient(),
  planningSessionId: string | null = "session-a",
) => renderHook(
  ({ state, sessionId }: { state: PlanReviewLifecycleState; sessionId?: string | null }) => useWorkItemGeneration(
    items,
    "project-1",
    "board-1",
    {
      api,
      planReviewState: state,
      onPlanReviewStateChange,
      planningSessionId: sessionId === undefined ? planningSessionId : sessionId,
      pollingRetryDelay: () => 0,
    },
  ),
  {
    initialProps: { state: planReviewState, sessionId: planningSessionId },
    wrapper: createWrapper(queryClient),
  },
);

afterEach(() => {
  mock.restore();
});

describe("useWorkItemGeneration plan-review lifecycle", () => {
  test("treats a non-terminal foreign review ID as a persistent mismatch and unlocks retry", async () => {
    let state = { ...INITIAL_PLAN_REVIEW_LIFECYCLE_STATE };
    const api = createApi(async () => queuedResponse("foreign-review", "applying"));
    const hook = renderGeneration(api, state, (next) => { state = next; });

    await act(async () => {
      hook.result.current.confirmGeneration("column-1", { enabled: true, requestedCriticCount: 2 });
    });
    hook.rerender({ state, sessionId: "session-a" });
    await waitFor(() => expect(state.status).toBe("mismatch"));
    hook.rerender({ state, sessionId: "session-a" });

    expect(state.activeReviewJobId).toBeNull();
    expect(hook.result.current.isPendingReview).toBe(false);
    expect(hook.result.current.planReviewError).toContain("foreign-review");
    expect(hook.result.current.isAlreadyCreated).toBe(false);
  });

  test("persists polling exhaustion as an actionable failure and stops polling", async () => {
    let state = { ...INITIAL_PLAN_REVIEW_LIFECYCLE_STATE };
    const getPlanReviewStatus = mock(async () => {
      throw new Error("network unavailable");
    });
    const api = createApi(getPlanReviewStatus);
    const hook = renderGeneration(api, state, (next) => { state = next; });

    await act(async () => {
      hook.result.current.confirmGeneration("column-1", { enabled: true, requestedCriticCount: 2 });
    });
    hook.rerender({ state, sessionId: "session-a" });
    await waitFor(() => expect(state.status).toBe("polling_failed"));
    hook.rerender({ state, sessionId: "session-a" });

    expect(state.activeReviewJobId).toBeNull();
    expect(hook.result.current.isPendingReview).toBe(false);
    expect(hook.result.current.planReviewError).toContain("several attempts");
    expect(getPlanReviewStatus).toHaveBeenCalledTimes(4);
  });

  test("restores queued polling after the generation hook remounts with a new query cache", async () => {
    let state: PlanReviewLifecycleState = {
      ...INITIAL_PLAN_REVIEW_LIFECYCLE_STATE,
      activeReviewJobId: "review-queued",
      status: "queued",
    };
    const getPlanReviewStatus = mock(async () => queuedResponse("review-queued", "applying"));
    const api = createApi(getPlanReviewStatus);
    const first = renderGeneration(api, state, (next) => { state = next; });
    first.unmount();

    const queryClient = createClient();
    const second = renderGeneration(api, state, (next) => { state = next; }, queryClient);
    await waitFor(() => expect(getPlanReviewStatus).toHaveBeenCalled());
    await waitFor(() => expect(state.status).toBe("applying"));
    second.rerender({ state, sessionId: "session-a" });

    expect(second.result.current.isPendingReview).toBe(true);
    expect(second.result.current.isAlreadyCreated).toBe(false);
    expect(queryClient.getQueryCache().findAll({ queryKey: ["plan-review-status", "review-queued"] })).toHaveLength(1);
    expect(queryClient.getQueryCache().getAll().map((query) => query.queryKey)).not.toContainEqual([
      "plan-review-status",
      undefined,
    ]);
  });

  test("drops a late session A polling response after session B becomes authoritative", async () => {
    const reviewA = deferred<ReturnType<typeof terminalResponse>>();
    const reviewB = deferred<ReturnType<typeof terminalResponse>>();
    let state: PlanReviewLifecycleState = {
      ...INITIAL_PLAN_REVIEW_LIFECYCLE_STATE,
      activeReviewJobId: "review-a",
      status: "queued",
    };
    const getPlanReviewStatus = mock(async (reviewJobId: string) =>
      reviewJobId === "review-a" ? reviewA.promise : reviewB.promise,
    );
    const hook = renderGeneration(
      createApi(getPlanReviewStatus),
      state,
      (next) => { state = next; },
      createClient(),
      "session-a",
    );

    await waitFor(() => expect(getPlanReviewStatus).toHaveBeenCalledWith("review-a"));
    state = {
      ...INITIAL_PLAN_REVIEW_LIFECYCLE_STATE,
      activeReviewJobId: "review-b",
      status: "queued",
    };
    hook.rerender({ state, sessionId: "session-b" });
    await waitFor(() => expect(getPlanReviewStatus).toHaveBeenCalledWith("review-b"));

    await act(async () => {
      reviewA.resolve(terminalResponse("review-a", "completed"));
      await Promise.resolve();
    });

    expect(state).toMatchObject({
      activeReviewJobId: "review-b",
      status: "queued",
      createdItemIds: [],
    });
  });

  test("drops a late session A generation response after session B becomes authoritative", async () => {
    const generationA = deferred<ReturnType<typeof queuedResponse>>();
    let state: PlanReviewLifecycleState = { ...INITIAL_PLAN_REVIEW_LIFECYCLE_STATE };
    const generateWorkItems = mock(async () => generationA.promise);
    const api: PlanReviewApi = {
      generateWorkItems,
      getPlanReviewStatus: mock(async () => queuedResponse("review-b")),
    };
    const hook = renderGeneration(api, state, (next) => { state = next; }, createClient(), "session-a");

    await act(async () => {
      hook.result.current.confirmGeneration("column-1", { enabled: true, requestedCriticCount: 2 });
    });
    state = { ...INITIAL_PLAN_REVIEW_LIFECYCLE_STATE };
    hook.rerender({ state, sessionId: "session-b" });

    await act(async () => {
      generationA.resolve(queuedResponse("review-a"));
      await Promise.resolve();
    });

    expect(state).toEqual(INITIAL_PLAN_REVIEW_LIFECYCLE_STATE);
  });

  test("restores an applied preview as read-only and blocks duplicate submission", async () => {
    const state: PlanReviewLifecycleState = {
      ...INITIAL_PLAN_REVIEW_LIFECYCLE_STATE,
      status: "applied",
      createdItemIds: ["work-item-1"],
    };
    const generateWorkItems = mock(async () => terminalResponse("review-applied", "applied"));
    const api: PlanReviewApi = {
      generateWorkItems,
      getPlanReviewStatus: mock(async () => terminalResponse("review-applied", "applied")),
    };
    const hook = renderGeneration(api, state, () => {}, createClient());

    expect(hook.result.current.isAlreadyCreated).toBe(true);
    expect(hook.result.current.createdItemIds).toEqual(["work-item-1"]);
    await act(async () => {
      hook.result.current.confirmGeneration("column-1", { enabled: true, requestedCriticCount: 2 });
    });
    expect(generateWorkItems).not.toHaveBeenCalled();
    expect(hook.result.current.updateItem("task-1", { title: "Changed" }));
    expect(hook.result.current.previewItems[0]?.title).toBe("Task");
  });

  test("disables plan review when generation has no planning session", async () => {
    let state: PlanReviewLifecycleState = { ...INITIAL_PLAN_REVIEW_LIFECYCLE_STATE };
    const generateWorkItems = mock(async (request: Parameters<PlanReviewApi["generateWorkItems"]>[0]) => {
      expect(request.planningSessionId).toBe("");
      expect(request.planReview).toBeUndefined();
      return { createdIds: [], errors: [] };
    });
    const api: PlanReviewApi = {
      generateWorkItems,
      getPlanReviewStatus: mock(async () => queuedResponse("unused-review")),
    };
    const hook = renderGeneration(api, state, (next) => { state = next; }, createClient(), null);

    await act(async () => {
      hook.result.current.confirmGeneration("column-1", { enabled: true, requestedCriticCount: 2 });
    });
    await waitFor(() => expect(generateWorkItems).toHaveBeenCalledTimes(1));

    expect(state).toEqual(INITIAL_PLAN_REVIEW_LIFECYCLE_STATE);
    expect(hook.result.current.isPendingReview).toBe(false);
  });

  test("passes the real planning session ID through the alternate page wiring", () => {
    const state: PlanReviewLifecycleState = {
      ...INITIAL_PLAN_REVIEW_LIFECYCLE_STATE,
      activeReviewJobId: "review-session-a",
      status: "queued",
    };
    const options = buildPlanningPageGenerationOptions({
      sessionId: "session-a",
      planReview: state,
      setPlanReviewState: () => {},
    });

    expect(options).toMatchObject({
      planningSessionId: "session-a",
      planReviewState: state,
      createdItemIds: [],
    });
  });
});
