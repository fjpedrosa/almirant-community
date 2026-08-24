"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { aiApi, ApiError } from "@/lib/api/client";
import { workItemKeys } from "@/domains/work-items/application/hooks/use-work-items";
import { boardKeys } from "@/domains/boards/application/hooks/use-boards";
import {
  INITIAL_PLAN_REVIEW_LIFECYCLE_STATE,
  type GeneratedWorkItem,
  type PlanReviewLifecycleState,
  type WorkItemPreview,
  type GenerateWorkItemsResponse,
  type PlanReviewSelection,
} from "../../domain/types";

const UUID_PREFIX_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-/;
const PLAN_REVIEW_PENDING_STATUSES = ["queued", "pending_review", "applying"] as const;
const PLAN_REVIEW_TERMINAL_STATUSES = ["applied", "completed", "rejected", "failed"] as const;

type PlanReviewStatus = Awaited<ReturnType<typeof aiApi.getPlanReviewStatus>>;
export type PlanReviewApi = Pick<typeof aiApi, "generateWorkItems" | "getPlanReviewStatus">;
type GenerateWorkItemsVariables = {
  boardColumnId: string;
  planReview?: PlanReviewSelection;
  planningSessionId: string | null;
  sessionGeneration: number;
  requestGeneration: number;
};

class PlanReviewConsistencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanReviewConsistencyError";
  }
}

const toPreviewItems = (items: GeneratedWorkItem[]): WorkItemPreview[] =>
  items.map((item) => ({ ...item, isEditing: false, isRemoved: false }));

export const shouldRetryPlanReviewPolling = (failureCount: number, error: unknown): boolean => {
  if (error instanceof PlanReviewConsistencyError) return false;
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 3;
};

export const planReviewPollingRetryDelay = (attemptIndex: number): number =>
  Math.min(1_000 * 2 ** attemptIndex, 5_000);

const collectDescendantIds = (parentTempId: string, items: WorkItemPreview[]): Set<string> => {
  const result = new Set<string>();
  for (const child of items.filter((item) => item.parentTempId === parentTempId)) {
    result.add(child.tempId);
    for (const id of collectDescendantIds(child.tempId, items)) result.add(id);
  }
  return result;
};

export const useWorkItemGeneration = (
  generatedItems: GeneratedWorkItem[],
  projectId: string,
  boardId: string,
  options?: {
    createdItemIds?: string[];
    onCreatedItemIdsChange?: (createdItemIds: string[]) => void;
    planReviewState?: PlanReviewLifecycleState;
    onPlanReviewStateChange?: (planReviewState: PlanReviewLifecycleState) => void;
    planningSessionId?: string | null;
    api?: PlanReviewApi;
    pollingRetryDelay?: (attemptIndex: number) => number;
  },
) => {
  const queryClient = useQueryClient();
  const api = options?.api ?? aiApi;
  const externalCreatedItemIds = options?.createdItemIds ?? [];
  const onCreatedItemIdsChange = options?.onCreatedItemIdsChange;
  const onPlanReviewStateChange = options?.onPlanReviewStateChange;
  const planningSessionId = options?.planningSessionId ?? null;
  const externalPlanReviewState = options?.planReviewState;
  const [internalPlanReviewState, setInternalPlanReviewState] = useState<PlanReviewLifecycleState>(
    () => externalPlanReviewState ?? { ...INITIAL_PLAN_REVIEW_LIFECYCLE_STATE },
  );
  const planReviewState = externalPlanReviewState ?? internalPlanReviewState;
  const [prevGeneratedItems, setPrevGeneratedItems] = useState<GeneratedWorkItem[]>(generatedItems);
  const [previewItems, setPreviewItems] = useState<WorkItemPreview[]>(() => toPreviewItems(generatedItems));
  const [createdItemIds, setCreatedItemIds] = useState<string[]>(externalCreatedItemIds);
  const activeReviewJobIdRef = useRef<string | null>(planReviewState.activeReviewJobId);
  const planReviewSessionIdRef = useRef<string | null>(planningSessionId);
  const planReviewSessionGenerationRef = useRef(0);
  const planReviewRequestGenerationRef = useRef(0);

  useEffect(() => {
    if (planReviewSessionIdRef.current === planningSessionId) return;
    planReviewSessionIdRef.current = planningSessionId;
    planReviewSessionGenerationRef.current += 1;
    activeReviewJobIdRef.current = planReviewState.activeReviewJobId;
  }, [planReviewState.activeReviewJobId, planningSessionId]);

  const isCurrentPlanReviewSession = useCallback(
    (requestSessionId: string | null, requestSessionGeneration: number) =>
      requestSessionId === planReviewSessionIdRef.current &&
      requestSessionGeneration === planReviewSessionGenerationRef.current,
    [],
  );
  const isCurrentPlanReviewRequest = useCallback(
    (
      requestSessionId: string | null,
      requestSessionGeneration: number,
      requestGeneration: number,
    ) =>
      isCurrentPlanReviewSession(requestSessionId, requestSessionGeneration) &&
      requestGeneration === planReviewRequestGenerationRef.current,
    [isCurrentPlanReviewSession],
  );

  const persistPlanReviewState = useCallback((next: PlanReviewLifecycleState) => {
    const normalized = { ...next, createdItemIds: [...next.createdItemIds] };
    setInternalPlanReviewState(normalized);
    onPlanReviewStateChange?.(normalized);
  }, [onPlanReviewStateChange]);

  useEffect(() => {
    activeReviewJobIdRef.current = planReviewState.activeReviewJobId;
  }, [planReviewState.activeReviewJobId]);

  const setDurableCreatedItemIds = useCallback((next: string[]) => {
    setCreatedItemIds(next);
    onCreatedItemIdsChange?.(next);
  }, [onCreatedItemIdsChange]);

  const settleReviewStatus = useCallback((
    reviewJobId: string,
    data: PlanReviewStatus,
    requestSessionId: string | null,
    requestSessionGeneration: number,
    requestGeneration: number,
  ) => {
    if (
      !isCurrentPlanReviewRequest(requestSessionId, requestSessionGeneration, requestGeneration) ||
      activeReviewJobIdRef.current !== reviewJobId
    ) return;
    if (data.reviewJobId && data.reviewJobId !== reviewJobId) {
      activeReviewJobIdRef.current = null;
      persistPlanReviewState({
        ...planReviewState,
        activeReviewJobId: null,
        status: "mismatch",
        error: "The returned plan-review status belongs to another review. Review the plan and retry.",
      });
      return;
    }

    if (!PLAN_REVIEW_TERMINAL_STATUSES.includes(data.status as typeof PLAN_REVIEW_TERMINAL_STATUSES[number])) {
      persistPlanReviewState({
        ...planReviewState,
        activeReviewJobId: reviewJobId,
        status: data.status as PlanReviewLifecycleState["status"],
        error: null,
      });
      return;
    }

    activeReviewJobIdRef.current = null;
    if (data.status === "rejected" || data.status === "failed") {
      persistPlanReviewState({
        ...planReviewState,
        activeReviewJobId: null,
        status: data.status,
        error: data.status === "rejected"
          ? "The plan review rejected this plan. Review the findings and retry."
          : "The plan review failed before creating work items. Review the plan and retry.",
        createdItemIds: [],
      });
      showToast.error(data.status === "rejected" ? "Plan review rejected the plan." : "Plan review failed before creating work items.");
      return;
    }

    const nextCreatedItemIds = data.createdIds ?? [];
    persistPlanReviewState({
      ...planReviewState,
      activeReviewJobId: null,
      status: data.status,
      error: null,
      createdItemIds: nextCreatedItemIds,
    });
    setDurableCreatedItemIds(nextCreatedItemIds);
    queryClient.invalidateQueries({ queryKey: workItemKeys.all });
    queryClient.invalidateQueries({ queryKey: boardKeys.all });
    if ((data.errors?.length ?? 0) > 0) {
      showToast.warning(`Created ${(data.createdIds ?? []).length} items, but ${data.errors!.length} failed.`);
    } else {
      showToast.success(`${(data.createdIds ?? []).length} work items created successfully.`);
    }
  }, [isCurrentPlanReviewRequest, persistPlanReviewState, planReviewState, queryClient, setDurableCreatedItemIds]);

  const handleReviewConsistencyFailure = useCallback((
    reviewJobId: string,
    returnedReviewJobId: string,
    requestSessionId: string | null,
    requestSessionGeneration: number,
    requestGeneration: number,
  ) => {
    if (
      !isCurrentPlanReviewRequest(requestSessionId, requestSessionGeneration, requestGeneration) ||
      activeReviewJobIdRef.current !== reviewJobId
    ) return;
    activeReviewJobIdRef.current = null;
    persistPlanReviewState({
      ...planReviewState,
      activeReviewJobId: null,
      status: "mismatch",
      error: `Plan review status mismatch: expected ${reviewJobId}, received ${returnedReviewJobId}. Review the plan and retry.`,
    });
  }, [isCurrentPlanReviewRequest, persistPlanReviewState, planReviewState]);

  const handlePollingRetry = useCallback((failureCount: number, error: unknown) => {
    const shouldRetry = shouldRetryPlanReviewPolling(failureCount, error);
    if (
      !shouldRetry &&
      isCurrentPlanReviewRequest(
        planningSessionId,
        planReviewSessionGenerationRef.current,
        planReviewRequestGenerationRef.current,
      ) &&
      activeReviewJobIdRef.current === planReviewState.activeReviewJobId
    ) {
      activeReviewJobIdRef.current = null;
      persistPlanReviewState({
        ...planReviewState,
        activeReviewJobId: null,
        status: "polling_failed",
        error: "Plan review status could not be retrieved after several attempts. Review the plan and retry.",
      });
    }
    return shouldRetry;
  }, [
    isCurrentPlanReviewRequest,
    persistPlanReviewState,
    planReviewState,
    planningSessionId,
  ]);

  const pendingReviewJobId =
    planningSessionId === null ? null : planReviewState.activeReviewJobId;

  const reviewStatusQuery = useQuery({
    queryKey: ["plan-review-status", pendingReviewJobId] as const,
    queryFn: async ({ queryKey }) => {
      const reviewJobId = queryKey[1];
      if (!reviewJobId) throw new Error("Missing plan review job ID");
      const requestSessionId = planningSessionId;
      const requestSessionGeneration = planReviewSessionGenerationRef.current;
      const requestGeneration = planReviewRequestGenerationRef.current;
      const data = await api.getPlanReviewStatus(reviewJobId);
      if (!isCurrentPlanReviewRequest(requestSessionId, requestSessionGeneration, requestGeneration)) return data;
      if (data.reviewJobId && data.reviewJobId !== reviewJobId) {
        handleReviewConsistencyFailure(
          reviewJobId,
          data.reviewJobId,
          requestSessionId,
          requestSessionGeneration,
          requestGeneration,
        );
        throw new PlanReviewConsistencyError(
          `Plan review status mismatch: expected ${reviewJobId}, received ${data.reviewJobId}.`,
        );
      }
      settleReviewStatus(
        reviewJobId,
        data,
        requestSessionId,
        requestSessionGeneration,
        requestGeneration,
      );
      return data;
    },
    enabled: pendingReviewJobId !== null,
    refetchInterval: (query) => PLAN_REVIEW_TERMINAL_STATUSES.includes(query.state.data?.status as typeof PLAN_REVIEW_TERMINAL_STATUSES[number]) ? false : 2_000,
    retry: handlePollingRetry,
    retryDelay: options?.pollingRetryDelay ?? planReviewPollingRetryDelay,
    staleTime: 0,
  });

  const isAlreadyCreated = generatedItems.length > 0 && generatedItems.every((item) => UUID_PREFIX_RE.test(item.tempId));
  const isPendingReview = pendingReviewJobId !== null && PLAN_REVIEW_PENDING_STATUSES.includes(planReviewState.status as typeof PLAN_REVIEW_PENDING_STATUSES[number]) && !reviewStatusQuery.isError;
  const durableCreatedItemIds = externalCreatedItemIds.length > 0
    ? externalCreatedItemIds
    : planReviewState.createdItemIds.length > 0
      ? planReviewState.createdItemIds
      : createdItemIds;
  const isDurablyReadOnly = isAlreadyCreated || durableCreatedItemIds.length > 0 || planReviewState.status === "applied" || planReviewState.status === "completed";
  const effectiveCreatedItemIds = durableCreatedItemIds;
  const isReadOnly = isPendingReview || isDurablyReadOnly;

  if (prevGeneratedItems !== generatedItems) {
    setPrevGeneratedItems(generatedItems);
    if (generatedItems.length > 0) {
      setPreviewItems(toPreviewItems(generatedItems));
      if (!isDurablyReadOnly) setCreatedItemIds(isAlreadyCreated ? generatedItems.map((item) => item.tempId) : []);
    } else {
      setCreatedItemIds([]);
    }
  }

  const updateItem = useCallback((tempId: string, changes: Partial<GeneratedWorkItem>) => {
    if (isReadOnly) return;
    setPreviewItems((prev) => prev.map((item) => item.tempId === tempId ? { ...item, ...changes } : item));
  }, [isReadOnly]);

  const removeItem = useCallback((tempId: string) => {
    if (isReadOnly) return;
    setPreviewItems((prev) => {
      const descendants = collectDescendantIds(tempId, prev);
      return prev.map((item) => item.tempId === tempId || descendants.has(item.tempId) ? { ...item, isRemoved: true } : item);
    });
  }, [isReadOnly]);

  const generateMutation = useMutation<GenerateWorkItemsResponse, Error, GenerateWorkItemsVariables>({
    mutationFn: ({ boardColumnId, planReview }) => api.generateWorkItems({
      items: previewItems.filter((item) => !item.isRemoved).map(({ tempId, type, title, description, priority, parentTempId }) => ({ tempId, type, title, description, priority, parentTempId })),
      projectId,
      boardId,
      boardColumnId,
      planningSessionId: planningSessionId ?? "",
      planReview,
    }),
    onSuccess: (data, variables) => {
      if (!isCurrentPlanReviewRequest(
        variables.planningSessionId,
        variables.sessionGeneration,
        variables.requestGeneration,
      )) return;
      if ("reviewJobId" in data) {
        activeReviewJobIdRef.current = data.reviewJobId;
        if (PLAN_REVIEW_TERMINAL_STATUSES.includes(data.status as typeof PLAN_REVIEW_TERMINAL_STATUSES[number])) {
          settleReviewStatus(
            data.reviewJobId,
            data,
            variables.planningSessionId,
            variables.sessionGeneration,
            variables.requestGeneration,
          );
        }
        else {
          persistPlanReviewState({
            ...planReviewState,
            activeReviewJobId: data.reviewJobId,
            status: data.status,
            error: null,
            createdItemIds: [],
          });
          showToast.success("Plan submitted for review before work items are created.");
        }
        return;
      }
      setDurableCreatedItemIds(data.createdIds);
      queryClient.invalidateQueries({ queryKey: workItemKeys.all });
      queryClient.invalidateQueries({ queryKey: boardKeys.all });
      if (data.errors.length > 0) showToast.warning(`Created ${data.createdIds.length} items, but ${data.errors.length} failed.`);
      else showToast.success(`${data.createdIds.length} work items created successfully.`);
    },
    onError: (error, variables) => {
      if (!isCurrentPlanReviewRequest(
        variables.planningSessionId,
        variables.sessionGeneration,
        variables.requestGeneration,
      )) return;
      persistPlanReviewState({
        ...planReviewState,
        activeReviewJobId: null,
        status: "failed",
        error: error.message || "Failed to submit the plan for review. Review the plan and retry.",
      });
      showToast.error(error.message || "Failed to create work items.");
    },
  });

  const confirmGeneration = useCallback((boardColumnId: string, planReview?: PlanReviewSelection) => {
    if (isPendingReview) return;
    if (isDurablyReadOnly) {
      queryClient.invalidateQueries({ queryKey: workItemKeys.all });
      queryClient.invalidateQueries({ queryKey: boardKeys.all });
      showToast.success(`${generatedItems.length} work items created during planning.`);
      return;
    }
    const requestGeneration = ++planReviewRequestGenerationRef.current;
    const effectivePlanReview = planningSessionId === null ? undefined : planReview;
    generateMutation.mutate({
      boardColumnId,
      planReview: effectivePlanReview,
      planningSessionId,
      sessionGeneration: planReviewSessionGenerationRef.current,
      requestGeneration,
    });
  }, [generateMutation, generatedItems.length, isDurablyReadOnly, isPendingReview, planningSessionId, queryClient]);

  const resetGeneration = useCallback(() => {
    setPreviewItems([]);
    setDurableCreatedItemIds([]);
    activeReviewJobIdRef.current = null;
    planReviewRequestGenerationRef.current += 1;
    persistPlanReviewState({ ...INITIAL_PLAN_REVIEW_LIFECYCLE_STATE });
    generateMutation.reset();
  }, [generateMutation, persistPlanReviewState, setDurableCreatedItemIds]);

  return {
    previewItems,
    updateItem,
    removeItem,
    confirmGeneration,
    isConfirming: generateMutation.isPending,
    isAlreadyCreated: isDurablyReadOnly,
    error: generateMutation.error,
    planReviewError: planReviewState.error,
    planReviewStatus: planReviewState.status,
    createdItemIds: effectiveCreatedItemIds,
    activeItemCount: previewItems.filter((item) => !item.isRemoved).length,
    isPendingReview,
    resetGeneration,
  };
};
