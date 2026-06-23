"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { serviceAccountsApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import { useActiveTeam } from "@/domains/teams/application/hooks/use-active-team";
import type { ServiceAccount } from "../../domain/types";

export const serviceAccountKeys = {
  all: ["service-accounts"] as const,
  lists: () => [...serviceAccountKeys.all, "list"] as const,
};

export const useServiceAccounts = () => {
  const { activeTeamId } = useActiveTeam();
  const scopedKey = useOrgScopedKey(serviceAccountKeys.lists());

  return useQuery({
    queryKey: scopedKey,
    queryFn: () =>
      serviceAccountsApi.list(activeTeamId!) as Promise<ServiceAccount[]>,
    enabled: !!activeTeamId,
  });
};

export const useRotateServiceAccountKey = () => {
  const queryClient = useQueryClient();
  const { activeTeamId } = useActiveTeam();

  return useMutation({
    mutationFn: (id: string) =>
      serviceAccountsApi.rotateKey(activeTeamId!, id) as Promise<{
        key: string;
        keyPrefix: string;
      }>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: serviceAccountKeys.lists() });
    },
  });
};
