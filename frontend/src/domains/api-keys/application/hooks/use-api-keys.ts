"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { agentsApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import type { ApiKey, ApiKeyCreated } from "../../domain/types";

// Query keys
export const apiKeyKeys = {
  all: ["api-keys"] as const,
  lists: () => [...apiKeyKeys.all, "list"] as const,
};

// List all API keys
export const useApiKeys = () => {
  const scopedKey = useOrgScopedKey(apiKeyKeys.lists());
  return useQuery({
    queryKey: scopedKey,
    queryFn: () => agentsApi.listApiKeys() as Promise<ApiKey[]>,
  });
};

// Create API key
export const useCreateApiKey = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) =>
      agentsApi.generateApiKey(name) as Promise<ApiKeyCreated>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: apiKeyKeys.lists() });
    },
  });
};

// Revoke API key
export const useRevokeApiKey = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => agentsApi.revokeApiKey(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: apiKeyKeys.lists() });
    },
  });
};
