"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { feedbackTriageApi, parseClusterTransitionError } from "@/lib/api/client";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { feedbackTriageKeys } from "./use-triage-keys";
import type { ClusterStatus } from "../../domain/types";

interface TransitionClusterVariables {
  clusterId: string;
  toStatus: ClusterStatus;
  reason?: string;
}

/**
 * Hook for performing an inline status transition on a cluster.
 *
 * On success: shows a localized toast and invalidates the clusters list so the
 * row reflects its new status.
 *
 * On error: if the backend responded with 409 `INVALID_TRANSITION` (parsed via
 * `parseClusterTransitionError`), surfaces a detailed toast listing the
 * allowed target statuses. Otherwise falls back to the generic error message.
 */
export const useTransitionCluster = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ clusterId, toStatus, reason }: TransitionClusterVariables) =>
      feedbackTriageApi.transitionCluster(clusterId, { toStatus, reason }),
    onSuccess: (_data, variables) => {
      showToast.success("Estado actualizado", {
        description: `Cluster movido a ${variables.toStatus}`,
      });
      queryClient.invalidateQueries({ queryKey: feedbackTriageKeys.clusters() });
    },
    onError: (err: Error) => {
      const parsed = parseClusterTransitionError(err);
      if (parsed) {
        showToast.error("Transición no permitida", {
          description: `${parsed.currentStatus} → ${parsed.toStatus} no está permitido. Permitidos: ${parsed.allowed.join(", ")}`,
        });
      } else {
        showToast.error("Error al cambiar estado", {
          description: err.message,
        });
      }
    },
  });
};
