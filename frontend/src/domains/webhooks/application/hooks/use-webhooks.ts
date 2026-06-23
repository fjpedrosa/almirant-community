"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { webhooksApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import type {
  Webhook,
  CreateWebhookRequest,
} from "../../domain/types";

export const webhookKeys = {
  all: ["webhooks"] as const,
  lists: () => [...webhookKeys.all, "list"] as const,
};

export const useWebhooks = () => {
  const scopedKey = useOrgScopedKey(webhookKeys.lists());
  return useQuery({
    queryKey: scopedKey,
    queryFn: () => webhooksApi.list() as Promise<Webhook[]>,
  });
};

export const useCreateWebhook = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateWebhookRequest) => webhooksApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: webhookKeys.lists() });
    },
  });
};

export const useDeleteWebhook = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => webhooksApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: webhookKeys.lists() });
    },
  });
};

export const useToggleWebhook = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      webhooksApi.update(id, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: webhookKeys.lists() });
    },
  });
};

export const useTestWebhook = () => {
  return useMutation({
    mutationFn: (id: string) =>
      webhooksApi.test(id) as Promise<{ success: boolean; error?: string }>,
  });
};
