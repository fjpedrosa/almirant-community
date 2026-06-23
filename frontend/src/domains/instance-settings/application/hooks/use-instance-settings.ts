"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTailscaleSetup } from "@/domains/onboarding/application/hooks/use-tailscale-setup";
import { useOnboardingStatus } from "@/domains/onboarding/application/hooks/use-onboarding-status";
import { useTailnetDatabaseAccess } from "./use-tailnet-database-access";
import { useInstanceServiceOperations } from "./use-instance-service-operations";
import { instanceCapacityApi } from "../api/instance-capacity-api";
import type {
  CapacitySectionProps,
  PublicUrlSectionProps,
  TailnetDatabaseSectionProps,
  TailscaleSectionProps,
} from "../../domain/types";

export const instanceCapacityKeys = {
  all: ["instance-capacity"] as const,
  diagnostics: () => [...instanceCapacityKeys.all, "diagnostics"] as const,
};

export const useInstanceSettings = () => {
  const queryClient = useQueryClient();
  const tailscale = useTailscaleSetup();
  const tailnetDatabaseAccess = useTailnetDatabaseAccess();
  const operations = useInstanceServiceOperations();
  const { data: onboardingState, isLoading: isLoadingOnboarding } =
    useOnboardingStatus();
  const capacityQuery = useQuery({
    queryKey: instanceCapacityKeys.diagnostics(),
    queryFn: () => instanceCapacityApi.get(),
    refetchInterval: 30_000,
  });
  const cancelOrphanedJobMutation = useMutation({
    mutationFn: (jobId: string) => instanceCapacityApi.cancelOrphanedJob(jobId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: instanceCapacityKeys.diagnostics(),
      });
    },
  });
  const cancelAllOrphanedJobsMutation = useMutation({
    mutationFn: async (jobIds: string[]) => {
      await Promise.all(
        jobIds.map((jobId) => instanceCapacityApi.cancelOrphanedJob(jobId)),
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: instanceCapacityKeys.diagnostics(),
      });
    },
  });
  const { manualUrl, setManualUrl } = tailscale;

  const currentPublicUrl = onboardingState?.tailscale.publicUrl ?? null;

  useEffect(() => {
    if (!currentPublicUrl || manualUrl) return;
    setManualUrl(currentPublicUrl);
  }, [currentPublicUrl, manualUrl, setManualUrl]);

  const publicUrl: PublicUrlSectionProps = {
    currentUrl: currentPublicUrl,
    inputUrl: manualUrl,
    onInputUrlChange: setManualUrl,
    isSaving: tailscale.isSavingUrl,
    onSave: tailscale.handleSaveManualUrl,
  };

  const tailscaleSection: TailscaleSectionProps = {
    available: tailscale.status?.available ?? false,
    hostname: tailscale.status?.hostname ?? null,
    suggestedUrl: tailscale.status?.suggestedUrl ?? null,
    reason: tailscale.status?.reason,
    servingHttps: tailscale.status?.serveStatus?.servingHttps ?? false,
    httpsTarget: tailscale.status?.serveStatus?.httpsTarget ?? null,
    isServing: tailscale.isServing,
    onServe: tailscale.handleServe,
    serveResult: tailscale.serveResult,
    isDisabling: tailscale.isDisabling,
    onDisable: tailscale.handleDisableServe,
  };

  const tailnetDatabase: TailnetDatabaseSectionProps = {
    status: tailnetDatabaseAccess.status,
    isLoading: tailnetDatabaseAccess.isLoading,
    isEditing: tailnetDatabaseAccess.isEditing,
    authMethod: tailnetDatabaseAccess.authMethod,
    onAuthMethodChange: tailnetDatabaseAccess.setAuthMethod,
    hostname: tailnetDatabaseAccess.hostname,
    onHostnameChange: tailnetDatabaseAccess.setHostname,
    tag: tailnetDatabaseAccess.tag,
    onTagChange: tailnetDatabaseAccess.setTag,
    authKey: tailnetDatabaseAccess.authKey,
    onAuthKeyChange: tailnetDatabaseAccess.setAuthKey,
    oauthClientId: tailnetDatabaseAccess.oauthClientId,
    onOauthClientIdChange: tailnetDatabaseAccess.setOauthClientId,
    oauthClientSecret: tailnetDatabaseAccess.oauthClientSecret,
    onOauthClientSecretChange: tailnetDatabaseAccess.setOauthClientSecret,
    isConnecting: tailnetDatabaseAccess.isConnecting,
    isTesting: tailnetDatabaseAccess.isTesting,
    isDisabling: tailnetDatabaseAccess.isDisabling,
    onEdit: tailnetDatabaseAccess.handleEdit,
    onCancelEdit: tailnetDatabaseAccess.handleCancelEdit,
    onConnect: tailnetDatabaseAccess.handleConnect,
    onTest: tailnetDatabaseAccess.handleTest,
    onDisable: tailnetDatabaseAccess.handleDisable,
  };

  const capacity: CapacitySectionProps = {
    diagnostics: capacityQuery.data ?? null,
    isLoading: capacityQuery.isLoading,
    isError: capacityQuery.isError,
    onRefresh: () => {
      void capacityQuery.refetch();
    },
    onCancelOrphanedJob: (jobId) => {
      cancelOrphanedJobMutation.mutate(jobId);
    },
    onCancelAllOrphanedJobs: () => {
      const jobIds = capacityQuery.data?.orphanedJobs.map((job) => job.id) ?? [];
      if (jobIds.length === 0) return;
      cancelAllOrphanedJobsMutation.mutate(jobIds);
    },
    cancellingOrphanedJobId: cancelOrphanedJobMutation.isPending
      ? cancelOrphanedJobMutation.variables ?? null
      : null,
    isCancellingAllOrphanedJobs: cancelAllOrphanedJobsMutation.isPending,
  };

  return {
    publicUrl,
    tailscale: tailscaleSection,
    tailnetDatabase,
    capacity,
    operations,
    isLoading:
      tailscale.isLoading ||
      tailnetDatabaseAccess.isLoading ||
      isLoadingOnboarding,
  };
};
