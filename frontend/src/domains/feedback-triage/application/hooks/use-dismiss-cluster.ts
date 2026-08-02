"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  feedbackTriageApi,
  parseDismissClusterError,
} from "@/lib/api/client";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { feedbackTriageKeys } from "./use-triage-keys";
import { bugFixAttemptKeys } from "./bug-fix-attempt-keys";
import type {
  DismissClusterInput,
  DismissClusterResponse,
} from "../../domain/types";

interface DismissClusterVariables extends DismissClusterInput {
  clusterId: string;
}

interface UseDismissClusterOptions {
  onSuccess?: (data: DismissClusterResponse) => void;
  onError?: (error: Error) => void;
}

/**
 * Hook for dismissing a cluster through the backend state-machine.
 *
 * Wires the `POST /admin/feedback/feedback-clusters/:id/dismiss` endpoint
 * (A-1911) with React Query invalidations and toast feedback.
 *
 * Invalidates (on success):
 *   1. `feedbackTriageKeys.cluster(clusterId)`  — detail view + nested scopes
 *   2. `feedbackTriageKeys.clusters()`          — clusters list
 *   3. `feedbackTriageKeys.inbox()`             — items may have been cancelled
 *   4. `bugFixAttemptKeys.byCluster(clusterId)` — attempts status derives from
 *      the cluster; keep the two views consistent
 *
 * Error mapping:
 *   - `ApiError`(404)               -> "Cluster no encontrado"
 *   - `ApiError`(422) INVALID_STATE -> "No se puede descartar desde X. Permitidos: …"
 *   - anything else                 -> "Error descartando el cluster" + `err.message`
 *
 * The hook exposes the raw mutation via `mutateAsync` so containers can decide
 * whether to close a dialog or keep it open based on the promise settling.
 */
export const useDismissCluster = (options?: UseDismissClusterOptions) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ clusterId, reason }: DismissClusterVariables) =>
      feedbackTriageApi.dismissCluster(clusterId, { reason }),
    onSuccess: (data, variables) => {
      const { clusterId } = variables;

      queryClient.invalidateQueries({
        queryKey: feedbackTriageKeys.cluster(clusterId),
      });
      queryClient.invalidateQueries({
        queryKey: feedbackTriageKeys.clusters(),
      });
      queryClient.invalidateQueries({
        queryKey: feedbackTriageKeys.inbox(),
      });
      queryClient.invalidateQueries({
        queryKey: bugFixAttemptKeys.byCluster(clusterId),
      });

      if (data.alreadyDismissed) {
        showToast.info("Cluster ya descartado", {
          description: "No se realizaron cambios.",
        });
      } else {
        const itemLabel =
          data.dismissedItemCount === 1 ? "ticket" : "tickets";
        showToast.success("Cluster descartado", {
          description: `Se cancelaron ${data.dismissedItemCount} ${itemLabel}.`,
        });
      }

      options?.onSuccess?.(data);
    },
    onError: (error: Error) => {
      const invalidState = parseDismissClusterError(error);
      if (invalidState) {
        const allowed = invalidState.allowedStatuses.length
          ? invalidState.allowedStatuses.join(", ")
          : "ninguno";
        showToast.error("No se puede descartar", {
          description: `Estado actual: ${invalidState.currentStatus}. Permitidos: ${allowed}.`,
        });
      } else if (error instanceof ApiError && error.status === 404) {
        showToast.error("Cluster no encontrado", {
          description: "El cluster fue eliminado o no existe.",
        });
      } else {
        showToast.error("Error descartando el cluster", {
          description: error.message,
        });
      }
      options?.onError?.(error);
    },
  });
};
