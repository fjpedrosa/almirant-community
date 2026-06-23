"use client";

import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { useTranslations } from "next-intl";
import { workItemsApi, agentJobsApi } from "@/lib/api/client";
import { useAiProviderPreference } from "@/domains/integrations/application/hooks/use-ai-provider-preference";
import { workItemKeys } from "./use-work-items";
import { agentJobKeys } from "@/domains/agents/application/hooks/use-agent-jobs";
import type { AgentProvider } from "@/domains/agents/domain/types";
import type { GenerateDocsResult } from "../../domain/types";

export const useGenerateDocs = () => {
  const t = useTranslations("workItems");
  const queryClient = useQueryClient();
  const { selectedKeyId } = useAiProviderPreference();

  const [pendingWorkItem, setPendingWorkItem] = useState<{
    id: string;
    title: string;
  } | null>(null);

  const generateDocsMutation = useMutation({
    mutationFn: (workItemId: string) =>
      workItemsApi.generateDocs(workItemId, {
        providerKeyId: selectedKeyId || undefined,
      }),
    onSuccess: (data: GenerateDocsResult) => {
      queryClient.invalidateQueries({ queryKey: workItemKeys.all });
      showToast.success(t("generateDocs.success"), {
        action: {
          label: t("generateDocs.viewDocument"),
          onClick: () => {
            window.open(`/documents?docId=${data.document.id}`, "_blank");
          },
        },
      });
      setPendingWorkItem(null);
    },
    onError: () => {
      showToast.error(t("generateDocs.error"));
      setPendingWorkItem(null);
    },
  });

  const promptForDocs = useCallback(
    (workItemId: string, workItemTitle: string) => {
      setPendingWorkItem({ id: workItemId, title: workItemTitle });
    },
    []
  );

  const confirmGenerate = useCallback(() => {
    if (pendingWorkItem) {
      generateDocsMutation.mutate(pendingWorkItem.id);
    }
  }, [pendingWorkItem, generateDocsMutation]);

  const skipGenerate = useCallback(() => {
    setPendingWorkItem(null);
  }, []);

  return {
    pendingWorkItem,
    isDialogOpen: !!pendingWorkItem,
    isGenerating: generateDocsMutation.isPending,
    promptForDocs,
    confirmGenerate,
    skipGenerate,
  };
};

/**
 * Enqueue document generation via the runner pipeline (A-936).
 * Uses the standard AgentProvider flow (like implement/validate) instead of
 * the direct providerKeyId endpoint.
 */
export const useGenerateDocsViaRunner = () => {
  const queryClient = useQueryClient();
  const t = useTranslations("workItems");

  return useMutation({
    mutationFn: ({ workItemId, provider }: { workItemId: string; provider: AgentProvider }) =>
      agentJobsApi.enqueue({
        workItemId,
        provider,
        jobType: "implementation",
        skillName: "document",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workItemKeys.all });
      queryClient.invalidateQueries({ queryKey: agentJobKeys.all });
      showToast.success(t("generateDocs.queued"));
    },
    onError: () => {
      showToast.error(t("generateDocs.error"));
    },
  });
};
