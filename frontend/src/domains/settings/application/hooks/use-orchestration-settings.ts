"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { organizationSettingsApi } from "@/lib/api/client";
import { useConnections } from "@/domains/integrations/application/hooks/use-connections";
import type {
  OrchestrationStrategy,
  OrchestrationSettingsData,
  OrchestrationConnectionInfo,
} from "../../domain/types";

const orchestrationKeys = {
  all: ["orchestration-settings"] as const,
  settings: () => [...orchestrationKeys.all] as const,
};

export const useOrchestrationSettings = () => {
  const queryClient = useQueryClient();

  const { data: orgSettings, isLoading } = useQuery({
    queryKey: orchestrationKeys.settings(),
    queryFn: async () => {
      const result = await organizationSettingsApi.get();
      return result as OrchestrationSettingsData;
    },
  });

  const mutation = useMutation({
    mutationFn: (data: { orchestrationStrategy: OrchestrationStrategy | null }) =>
      organizationSettingsApi.update(data),
    onMutate: async (newData) => {
      await queryClient.cancelQueries({
        queryKey: orchestrationKeys.settings(),
      });

      const previous = queryClient.getQueryData<OrchestrationSettingsData>(
        orchestrationKeys.settings()
      );

      if (previous) {
        queryClient.setQueryData<OrchestrationSettingsData>(
          orchestrationKeys.settings(),
          { ...previous, ...newData }
        );
      }

      return { previous };
    },
    onError: (_err, _newData, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          orchestrationKeys.settings(),
          context.previous
        );
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: orchestrationKeys.settings(),
      });
    },
  });

  const orchestrationParams = useMemo(() => {
    const params = new URLSearchParams();
    params.set("orchestrationEnabled", "true");
    return params;
  }, []);

  const { data: connectionsData, isLoading: isLoadingConnections } =
    useConnections(orchestrationParams);

  const connections: OrchestrationConnectionInfo[] = useMemo(
    () =>
      (connectionsData ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        provider: c.provider,
        isActive: c.isActive,
        orchestrationEnabled: c.orchestrationEnabled,
        suspendedAt: c.suspendedAt,
      })),
    [connectionsData]
  );

  const handleStrategyChange = useCallback(
    (strategy: OrchestrationStrategy | null) => {
      mutation.mutate({ orchestrationStrategy: strategy });
    },
    [mutation]
  );

  return {
    strategy: orgSettings?.orchestrationStrategy ?? null,
    isLoading,
    isSaving: mutation.isPending,
    connections,
    isLoadingConnections,
    handleStrategyChange,
  };
};
