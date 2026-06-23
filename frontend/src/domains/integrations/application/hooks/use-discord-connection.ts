"use client";

import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { discordApi } from "@/lib/api/client";
import { useConfirmDialog } from "@/domains/shared/application/hooks/use-confirm-dialog";
import type { DiscordChannelOption } from "@/domains/projects/domain/types";
import type { UseDiscordConnectionReturn } from "../../domain/types";

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const discordKeys = {
  all: ["discord"] as const,
  connection: () => [...discordKeys.all, "connection"] as const,
  channels: () => [...discordKeys.all, "channels"] as const,
};

// ---------------------------------------------------------------------------
// useDiscordConnection - Manages Discord OAuth, channel selection, test & disconnect
// ---------------------------------------------------------------------------

export const useDiscordConnection = (): UseDiscordConnectionReturn & {
  confirmDialogProps: {
    isOpen: boolean;
    options: import("@/domains/shared/domain/types").ConfirmDialogOptions | null;
    handleConfirm: () => void;
    handleCancel: () => void;
  };
} => {
  const t = useTranslations("integrations.toasts");
  const queryClient = useQueryClient();
  const { confirm, ...confirmDialogProps } = useConfirmDialog();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [hasChannelChanges, setHasChannelChanges] = useState(false);
  const [testResult, setTestResult] = useState<{ sent: boolean; error?: string } | null>(null);

  // --- Queries ---------------------------------------------------------------

  const {
    data: connectionData,
    isLoading: isLoadingConnection,
  } = useQuery({
    queryKey: discordKeys.connection(),
    queryFn: () => discordApi.getConnection(),
  });

  const connection = connectionData ?? null;

  const {
    data: channelsData,
    isLoading: isLoadingChannels,
  } = useQuery({
    queryKey: discordKeys.channels(),
    queryFn: () => discordApi.getChannels(),
    enabled: !!connection,
  });

  const channels: DiscordChannelOption[] = useMemo(
    () => channelsData ?? [],
    [channelsData],
  );

  // --- Mutations -------------------------------------------------------------

  const authorizeMutation = useMutation({
    mutationFn: () => discordApi.authorize(),
    onSuccess: (response) => {
      if (response?.url) {
        window.location.href = response.url;
      }
    },
    onError: () => {
      showToast.error(t("discordAuthFailed"));
    },
  });

  const updateConnectionMutation = useMutation({
    mutationFn: (data: { defaultChannelId: string; defaultChannelName: string }) => {
      if (!connection) throw new Error("No connection");
      return discordApi.updateConnection(connection.id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: discordKeys.connection() });
      setHasChannelChanges(false);
      showToast.success(t("discordChannelUpdated"));
    },
    onError: () => {
      showToast.error(t("discordChannelFailed"));
    },
  });

  const testConnectionMutation = useMutation({
    mutationFn: () => {
      if (!connection) throw new Error("No connection");
      return discordApi.testConnection(connection.id, {
        channelId: selectedChannelId ?? connection.defaultChannelId ?? undefined,
      });
    },
    onSuccess: (result) => {
      setTestResult(result ?? { sent: false, error: "No response" });
      if (result?.sent) {
        showToast.success(t("discordTestSuccess"));
      } else {
        showToast.error(result?.error ?? t("discordTestFailed"));
      }
    },
    onError: () => {
      setTestResult({ sent: false, error: "Request failed" });
      showToast.error(t("discordTestError"));
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: () => {
      if (!connection) throw new Error("No connection");
      return discordApi.disconnect(connection.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: discordKeys.connection() });
      queryClient.invalidateQueries({ queryKey: discordKeys.channels() });
      setSelectedChannelId(null);
      setHasChannelChanges(false);
      setTestResult(null);
      showToast.success(t("discordDisconnected"));
    },
    onError: () => {
      showToast.error(t("discordDisconnectFailed"));
    },
  });

  // --- Handlers --------------------------------------------------------------

  const openDialog = useCallback(() => {
    setDialogOpen(true);
    setTestResult(null);
  }, []);

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    setTestResult(null);
    setHasChannelChanges(false);
    setSelectedChannelId(null);
  }, []);

  const handleConnect = useCallback(() => {
    authorizeMutation.mutate();
  }, [authorizeMutation]);

  const handleChannelSelect = useCallback(
    (channelId: string) => {
      setSelectedChannelId(channelId);
      const isDifferent = channelId !== (connection?.defaultChannelId ?? "");
      setHasChannelChanges(isDifferent);
    },
    [connection?.defaultChannelId],
  );

  const handleSaveChannel = useCallback(() => {
    if (!selectedChannelId) return;
    const channel = channels.find((c) => c.id === selectedChannelId);
    if (!channel) return;
    updateConnectionMutation.mutate({
      defaultChannelId: selectedChannelId,
      defaultChannelName: channel.name,
    });
  }, [selectedChannelId, channels, updateConnectionMutation]);

  const handleDiscardChannel = useCallback(() => {
    setSelectedChannelId(connection?.defaultChannelId ?? null);
    setHasChannelChanges(false);
  }, [connection?.defaultChannelId]);

  const handleTestConnection = useCallback(() => {
    setTestResult(null);
    testConnectionMutation.mutate();
  }, [testConnectionMutation]);

  const handleDisconnect = useCallback(async () => {
    const confirmed = await confirm({
      title: "Disconnect Discord",
      description:
        "Are you sure you want to disconnect Discord? Notifications will stop being sent to your server.",
      confirmLabel: "Disconnect",
      variant: "destructive",
    });
    if (!confirmed) return;
    disconnectMutation.mutate();
  }, [confirm, disconnectMutation]);

  return {
    dialogOpen,
    openDialog,
    closeDialog,
    connection,
    channels,
    selectedChannelId,
    isLoading: isLoadingConnection || isLoadingChannels,
    isConnecting: authorizeMutation.isPending,
    isSaving: updateConnectionMutation.isPending,
    isTesting: testConnectionMutation.isPending,
    isDisconnecting: disconnectMutation.isPending,
    testResult,
    hasChannelChanges,
    handleConnect,
    handleChannelSelect,
    handleSaveChannel,
    handleDiscardChannel,
    handleTestConnection,
    handleDisconnect,
    confirmDialogProps,
  };
};
