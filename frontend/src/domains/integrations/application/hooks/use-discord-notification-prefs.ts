"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { discordApi } from "@/lib/api/client";
import type {
  NotificationCategory,
  NotificationPrefKey,
  NotificationPrefsFormState,
} from "../../domain/types";

const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  {
    name: "Work Items",
    toggles: [
      { key: "notifyWorkItemCreated", label: "Work item created" },
      { key: "notifyWorkItemMoved", label: "Work item moved" },
      { key: "notifyWorkItemAssigned", label: "Work item assigned" },
      { key: "notifyWorkItemDone", label: "Work item done" },
      { key: "notifyWorkItemComment", label: "Work item comment" },
      { key: "notifyWorkItemUpdated", label: "Work item updated" },
      { key: "notifyWorkItemDeleted", label: "Work item deleted" },
    ],
  },
  {
    name: "Comments & Attachments",
    toggles: [
      { key: "notifyCommentAdded", label: "Comment added" },
      { key: "notifyAttachmentAdded", label: "Attachment added" },
    ],
  },
  {
    name: "Sprints",
    toggles: [
      { key: "notifySprintStarted", label: "Sprint started" },
      { key: "notifySprintClosed", label: "Sprint closed" },
    ],
  },
  {
    name: "Milestones",
    toggles: [{ key: "notifyMilestoneCompleted", label: "Milestone completed" }],
  },
  {
    name: "GitHub",
    toggles: [
      { key: "notifyPrOpened", label: "PR opened" },
      { key: "notifyPrMerged", label: "PR merged" },
      { key: "notifyCiFailed", label: "CI failed" },
    ],
  },
  {
    name: "Agent",
    toggles: [
      { key: "notifyAgentJobCompleted", label: "Agent job completed" },
      { key: "notifyAgentJobFailed", label: "Agent job failed" },
    ],
  },
  {
    name: "Seeds",
    toggles: [{ key: "notifySeedPromoted", label: "Seed promoted" }],
  },
];

const ALL_PREF_KEYS: NotificationPrefKey[] = NOTIFICATION_CATEGORIES.flatMap(
  (cat) => cat.toggles.map((t) => t.key)
);

function extractFormState(
  data: Record<string, unknown>
): NotificationPrefsFormState {
  const state: Record<string, boolean> = {
    enabled: Boolean(data.enabled),
  };
  for (const key of ALL_PREF_KEYS) {
    state[key] = Boolean(data[key]);
  }
  return state as NotificationPrefsFormState;
}

export const discordNotificationPrefsKeys = {
  all: ["discord", "notificationPrefs"] as const,
  byConnection: (connectionId: string) =>
    ["discord", "notificationPrefs", connectionId] as const,
};

export const useDiscordNotificationPrefs = (connectionId: string | null) => {
  const t = useTranslations("integrations.toasts");
  const queryClient = useQueryClient();

  const {
    data: serverPrefs,
    isLoading,
  } = useQuery({
    queryKey: discordNotificationPrefsKeys.byConnection(connectionId ?? ""),
    queryFn: async () => {
      const result = await discordApi.getNotificationPrefs(connectionId!);
      return result;
    },
    enabled: !!connectionId,
  });

  const [localOverrides, setLocalOverrides] = useState<
    Partial<NotificationPrefsFormState>
  >({});

  const serverFormState = useMemo<NotificationPrefsFormState | null>(() => {
    if (!serverPrefs) return null;
    return extractFormState(serverPrefs as unknown as Record<string, unknown>);
  }, [serverPrefs]);

  const formState = useMemo<NotificationPrefsFormState>(() => {
    const base = serverFormState ?? ({
      enabled: true,
      ...Object.fromEntries(ALL_PREF_KEYS.map((k) => [k, true])),
    } as NotificationPrefsFormState);
    return { ...base, ...localOverrides };
  }, [serverFormState, localOverrides]);

  const hasChanges = useMemo(() => {
    if (!serverFormState) return false;
    return Object.keys(localOverrides).some(
      (key) =>
        localOverrides[key as keyof NotificationPrefsFormState] !==
        serverFormState[key as keyof NotificationPrefsFormState]
    );
  }, [localOverrides, serverFormState]);

  const mutation = useMutation({
    mutationFn: (data: Partial<NotificationPrefsFormState>) =>
      discordApi.updateNotificationPrefs(connectionId!, data),
    onSuccess: () => {
      setLocalOverrides({});
      showToast.success(t("notificationPrefsSaved"));
      queryClient.invalidateQueries({
        queryKey: discordNotificationPrefsKeys.byConnection(connectionId ?? ""),
      });
    },
    onError: (error) => {
      showToast.error(
        error instanceof Error
          ? error.message
          : t("notificationPrefsFailed")
      );
    },
  });

  const handleToggle = useCallback(
    (key: NotificationPrefKey | "enabled", value: boolean) => {
      setLocalOverrides((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const handleMasterToggle = useCallback(
    (value: boolean) => {
      const overrides: Partial<NotificationPrefsFormState> = { enabled: value };
      for (const key of ALL_PREF_KEYS) {
        overrides[key] = value;
      }
      setLocalOverrides(overrides);
    },
    []
  );

  const handleSave = useCallback(() => {
    if (!hasChanges || !connectionId) return;
    // Only send changed fields
    const changedFields: Partial<NotificationPrefsFormState> = {};
    for (const [key, value] of Object.entries(localOverrides)) {
      if (
        serverFormState &&
        value !== serverFormState[key as keyof NotificationPrefsFormState]
      ) {
        (changedFields as Record<string, boolean>)[key] = value as boolean;
      }
    }
    mutation.mutate(changedFields);
  }, [hasChanges, connectionId, localOverrides, serverFormState, mutation]);

  const handleDiscard = useCallback(() => {
    setLocalOverrides({});
  }, []);

  return {
    categories: NOTIFICATION_CATEGORIES,
    formState,
    isLoading,
    isSaving: mutation.isPending,
    hasChanges,
    handleToggle,
    handleMasterToggle,
    handleSave,
    handleDiscard,
  };
};
