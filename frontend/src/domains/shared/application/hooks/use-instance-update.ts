"use client";

import { useCallback, useEffect, useReducer } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, instanceVersionApi } from "@/lib/api/client";
import type {
  InstanceVersionInfo,
  StartUpdateResponse,
  UpdateJob,
} from "../../domain/instance-version-types";

// ─── State machine ────────────────────────────────────────────────────────────

export type UpdateView =
  | "idle"
  | "confirming"
  | "running"
  | "backend-down"
  | "success"
  | "failed";

interface State {
  view: UpdateView;
  jobId: string | null;
  job: UpdateJob | null;
  errorMessage: string | null;
  /** Wall-clock ms when we transitioned to backend-down (for timeout). */
  backendDownSince: number | null;
}

type Action =
  | { type: "open-confirm" }
  | { type: "cancel" }
  | { type: "start"; jobId: string }
  | { type: "poll-success"; job: UpdateJob; now: number }
  | { type: "poll-error"; now: number }
  | { type: "fail"; message: string }
  | { type: "dismiss" }
  | { type: "hydrate-active"; job: UpdateJob };

const INITIAL: State = {
  view: "idle",
  jobId: null,
  job: null,
  errorMessage: null,
  backendDownSince: null,
};

const BACKEND_DOWN_TIMEOUT_MS = 5 * 60 * 1_000;
const POLL_INTERVAL_MS = 1_500;

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case "open-confirm":
      return state.view === "idle" ? { ...state, view: "confirming" } : state;

    case "cancel":
      return state.view === "confirming" ? INITIAL : state;

    case "start":
      return {
        view: "running",
        jobId: action.jobId,
        job: null,
        errorMessage: null,
        backendDownSince: null,
      };

    case "hydrate-active":
      return {
        view: "running",
        jobId: action.job.id,
        job: action.job,
        errorMessage: null,
        backendDownSince: null,
      };

    case "poll-success": {
      // Successful response from the backend → if we were in backend-down,
      // recover. Then promote terminal job statuses to terminal views.
      const next: State = {
        ...state,
        job: action.job,
        view: state.view === "backend-down" ? "running" : state.view,
        backendDownSince: null,
      };
      if (action.job.status === "success") {
        return { ...next, view: "success" };
      }
      if (action.job.status === "failed") {
        return {
          ...next,
          view: "failed",
          errorMessage: action.job.errorMessage ?? "Update failed",
        };
      }
      return next;
    }

    case "poll-error": {
      if (state.view === "running") {
        return { ...state, view: "backend-down", backendDownSince: action.now };
      }
      if (state.view === "backend-down" && state.backendDownSince) {
        if (action.now - state.backendDownSince > BACKEND_DOWN_TIMEOUT_MS) {
          return {
            ...state,
            view: "failed",
            errorMessage:
              "Update timed out — the backend did not come back within 5 minutes. " +
              "Check `docker compose logs` on the host.",
          };
        }
      }
      return state;
    }

    case "fail":
      return {
        ...state,
        view: "failed",
        errorMessage: action.message,
      };

    case "dismiss":
      return INITIAL;
  }
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseInstanceUpdateResult {
  /** True when the updater sidecar is reachable and the banner should show "Update now". */
  isUpdaterAvailable: boolean;
  /** True while we don't yet know whether the updater is reachable. */
  isUpdaterAvailabilityLoading: boolean;
  /** Current modal state — drives UpdateProgressModal. */
  view: UpdateView;
  /** Job snapshot during running/success/failed. */
  job: UpdateJob | null;
  errorMessage: string | null;
  /** Called by the banner button to open the confirm modal. */
  triggerUpdate: () => void;
  /** Modal callbacks. */
  onConfirm: () => void;
  onCancel: () => void;
  onReload: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}

export const useInstanceUpdate = (
  versionInfo: InstanceVersionInfo | undefined,
): UseInstanceUpdateResult => {
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(reducer, INITIAL);

  // 1. Detect whether the sidecar is reachable. Cached server-side 30s + 60s
  // here — cheap enough to call on every dashboard load.
  const availabilityQuery = useQuery({
    queryKey: ["instance", "updater-available"],
    queryFn: async () => {
      const result = await instanceVersionApi.isUpdaterAvailable();
      return result.available;
    },
    staleTime: 60 * 1_000,
    gcTime: 5 * 60 * 1_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  // 2. Resume an in-flight job after page reload. Only fires once on mount,
  // and only when we know the updater is reachable (otherwise the call would
  // return 404 silently).
  useEffect(() => {
    if (state.view !== "idle") return;
    if (!availabilityQuery.data) return;

    let cancelled = false;
    (async () => {
      try {
        const result = await instanceVersionApi.getActiveUpdateJob();
        if (cancelled || !result.job) return;
        if (result.job.status === "running" || result.job.status === "queued") {
          dispatch({ type: "hydrate-active", job: result.job });
        }
      } catch {
        // No active job, or call failed — leave us in idle.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state.view, availabilityQuery.data]);

  // 3. Mutation: kick off an update.
  const startMutation = useMutation<StartUpdateResponse, Error>({
    mutationFn: () => instanceVersionApi.startUpdate(),
    onSuccess: (data) => {
      dispatch({ type: "start", jobId: data.jobId });
    },
    onError: (error) => {
      // 409 with active job → hydrate it instead of failing.
      if (error instanceof ApiError && error.status === 409) {
        const body = error.body as
          | { data?: { activeJob?: UpdateJob } }
          | null;
        const active = body?.data?.activeJob;
        if (active) {
          dispatch({ type: "hydrate-active", job: active });
          return;
        }
      }
      dispatch({
        type: "fail",
        message:
          error instanceof Error
            ? error.message
            : "Failed to start update",
      });
    },
  });

  // 4. Polling loop — runs while view is running or backend-down. Same
  // endpoint serves both cases; the response (or its absence) drives the
  // state machine.
  useEffect(() => {
    if (state.view !== "running" && state.view !== "backend-down") return;
    if (!state.jobId) return;

    let cancelled = false;
    const tick = async (): Promise<void> => {
      const jobId = state.jobId;
      if (!jobId) return;
      try {
        const job = await instanceVersionApi.getUpdateJob(jobId);
        if (cancelled) return;
        dispatch({ type: "poll-success", job, now: Date.now() });
      } catch {
        if (cancelled) return;
        // Treat any error as "backend unreachable". 4xx is unlikely here
        // because we already have a jobId, but a 404 would also count
        // as missing the job — same UX (recover or timeout).
        dispatch({ type: "poll-error", now: Date.now() });
      }
    };

    void tick();
    const interval = setInterval(() => {
      void tick();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [state.view, state.jobId]);

  // 5. On terminal success, invalidate the version cache so the banner
  // re-evaluates with the new SHA and disappears.
  useEffect(() => {
    if (state.view === "success") {
      void queryClient.invalidateQueries({ queryKey: ["instance", "version"] });
    }
  }, [state.view, queryClient]);

  // ─── Stable callbacks ──────────────────────────────────────────────────────

  const triggerUpdate = useCallback(() => {
    if (!versionInfo?.updateAvailable) return;
    if (!availabilityQuery.data) return;
    dispatch({ type: "open-confirm" });
  }, [versionInfo?.updateAvailable, availabilityQuery.data]);

  const onConfirm = useCallback(() => {
    startMutation.mutate();
  }, [startMutation]);

  const onCancel = useCallback(() => {
    dispatch({ type: "cancel" });
  }, []);

  const onReload = useCallback(() => {
    if (typeof window !== "undefined") window.location.reload();
  }, []);

  const onRetry = useCallback(() => {
    dispatch({ type: "dismiss" });
    startMutation.mutate();
  }, [startMutation]);

  const onDismiss = useCallback(() => {
    dispatch({ type: "dismiss" });
  }, []);

  return {
    isUpdaterAvailable: availabilityQuery.data ?? false,
    isUpdaterAvailabilityLoading: availabilityQuery.isLoading,
    view: state.view,
    job: state.job,
    errorMessage: state.errorMessage,
    triggerUpdate,
    onConfirm,
    onCancel,
    onReload,
    onRetry,
    onDismiss,
  };
};
