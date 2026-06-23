"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { projectsApi, discordApi } from "@/lib/api/client";
import type { ProjectDiscordChannelData, DiscordChannelOption } from "../../domain/types";
import { projectKeys } from "./use-projects";

export const useProjectDiscord = (projectId: string) => {
  const queryClient = useQueryClient();

  const {
    data: channelData,
    isLoading: isLoadingChannelData,
    error: queryError,
  } = useQuery({
    queryKey: projectKeys.discordChannel(projectId),
    queryFn: async () => {
      const result = await projectsApi.getDiscordChannel(projectId);
      return result as ProjectDiscordChannelData;
    },
    enabled: !!projectId,
  });

  const {
    data: channels,
    isLoading: isLoadingChannels,
  } = useQuery({
    queryKey: ["discord", "channels"],
    queryFn: async () => {
      const result = await discordApi.getChannels();
      return result as DiscordChannelOption[];
    },
    enabled: !!channelData?.connection,
  });

  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);

  const serverChannelId = channelData?.projectChannel?.channelId ?? null;

  const hasChanges =
    selectedChannelId !== null && selectedChannelId !== serverChannelId;

  const mutation = useMutation({
    mutationFn: (data: { channelId: string; channelName: string }) =>
      projectsApi.updateDiscordChannel(projectId, data),
    onSuccess: () => {
      setSelectedChannelId(null);
      showToast.success("Discord channel updated");
      queryClient.invalidateQueries({
        queryKey: projectKeys.discordChannel(projectId),
      });
    },
    onError: (error) => {
      showToast.error(
        error instanceof Error
          ? error.message
          : "Failed to save Discord channel"
      );
    },
  });

  const handleChannelSelect = useCallback(
    (channelId: string) => {
      setSelectedChannelId(channelId);
    },
    []
  );

  const handleSave = useCallback(() => {
    if (!selectedChannelId) return;
    const channel = channels?.find((c) => c.id === selectedChannelId);
    if (!channel) return;
    mutation.mutate({ channelId: channel.id, channelName: channel.name });
  }, [selectedChannelId, channels, mutation]);

  const handleDiscard = useCallback(() => {
    setSelectedChannelId(null);
  }, []);

  return {
    channelData: channelData ?? null,
    channels: channels ?? [],
    isLoading: isLoadingChannelData || isLoadingChannels,
    isSaving: mutation.isPending,
    selectedChannelId: selectedChannelId ?? serverChannelId,
    handleChannelSelect,
    handleSave,
    handleDiscard,
    hasChanges,
  };
};
