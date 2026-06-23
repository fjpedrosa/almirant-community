"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { useTranslations } from "next-intl";
import { agentJobsApi } from "@/lib/api/client";
import type { AgentProvider, EnqueueAgentJobData } from "../../domain/types";
import type { CodingAgent } from "../../domain/coding-agent-compatibility";
import { agentJobKeys } from "./use-agent-jobs";

export const useEnqueueAgentJob = () => {
  const queryClient = useQueryClient();
  const t = useTranslations("agents");

  return useMutation({
    mutationFn: (data: EnqueueAgentJobData) =>
      agentJobsApi.enqueue(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentJobKeys.all });
      showToast.success(t("jobQueued"));
    },
    onError: (err) => {
      showToast.error(err instanceof Error ? err.message : "Error al encolar job");
    },
  });
};

export const useBatchEnqueueAgentJobs = () => {
  const queryClient = useQueryClient();
  const t = useTranslations("agents");

  return useMutation({
    mutationFn: (data: { workItemIds: string[]; provider: AgentProvider; codingAgent?: CodingAgent; model?: string; priority?: string; repositoryId?: string }) =>
      agentJobsApi.batchEnqueue(data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: agentJobKeys.all });

      const created =
        result && typeof result === "object" && "created" in result
          ? Number((result as { created: unknown }).created)
          : 0;

      showToast.success(t("batchQueued", { count: created }));
    },
    onError: (err) => {
      showToast.error(err instanceof Error ? err.message : "Error al encolar jobs");
    },
  });
};

export const useCancelAgentJob = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (jobId: string) => agentJobsApi.cancel(jobId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentJobKeys.all });
      showToast.success("Job cancelado");
    },
    onError: (err) => {
      showToast.error(err instanceof Error ? err.message : "Error al cancelar job");
    },
  });
};

export const useResetStuckItems = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => agentJobsApi.resetStuck(),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: agentJobKeys.all });
      const reset = result && typeof result === "object" && "reset" in result
        ? Number((result as { reset: unknown }).reset)
        : 0;
      if (reset > 0) {
        showToast.success(`${reset} item(s) desbloqueados`);
      } else {
        showToast.info("No hay items bloqueados");
      }
    },
    onError: (err) => {
      showToast.error(err instanceof Error ? err.message : "Error al desbloquear items");
    },
  });
};
