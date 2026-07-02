"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { projectsApi } from "@/lib/api/client";
import { projectKeys } from "./use-projects";
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

const DEFAULT_FORM_STATE: NotificationPrefsFormState = {
  enabled: true,
  ...Object.fromEntries(ALL_PREF_KEYS.map((k) => [k, true])),
} as NotificationPrefsFormState;

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

export const useProjectDiscordNotificationPrefs = (projectId: string) => {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: projectKeys.discordNotificationPrefs(projectId),
    queryFn: () => projectsApi.getDiscordNotificationPrefs(projectId),
    enabled: !!projectId,
  });

  const [localOverrides, setLocalOverrides] = useState<
    Partial<NotificationPrefsFormState>
  >({});

  const isInheriting = data?.preferences === null;
  const orgDefaults = data?.orgDefaults ?? null;

  const orgFormState = useMemo<NotificationPrefsFormState>(() => {
    if (!orgDefaults) return DEFAULT_FORM_STATE;
    return extractFormState(orgDefaults as unknown as Record<string, unknown>);
  }, [orgDefaults]);

  const preferences = data?.preferences ?? null;
  const serverFormState = useMemo<NotificationPrefsFormState | null>(() => {
    if (!preferences) return null;
    return extractFormState(preferences as unknown as Record<string, unknown>);
  }, [preferences]);

  // When inheriting, show org defaults; when overriding, show project prefs + local overrides
  const formState = useMemo<NotificationPrefsFormState>(() => {
    if (isInheriting) return orgFormState;
    const base = serverFormState ?? orgFormState;
    return { ...base, ...localOverrides };
  }, [isInheriting, serverFormState, orgFormState, localOverrides]);

  const hasChanges = useMemo(() => {
    if (isInheriting) return false;
    if (!serverFormState) return false;
    return Object.keys(localOverrides).some(
      (key) =>
        localOverrides[key as keyof NotificationPrefsFormState] !==
        serverFormState[key as keyof NotificationPrefsFormState]
    );
  }, [isInheriting, localOverrides, serverFormState]);

  const updateMutation = useMutation({
    mutationFn: (payload: Partial<NotificationPrefsFormState>) =>
      projectsApi.updateDiscordNotificationPrefs(projectId, payload),
    onSuccess: () => {
      setLocalOverrides({});
      showToast.success("Notification preferences saved");
      queryClient.invalidateQueries({
        queryKey: projectKeys.discordNotificationPrefs(projectId),
      });
    },
    onError: (error) => {
      showToast.error(
        error instanceof Error
          ? error.message
          : "Failed to save notification preferences"
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => projectsApi.deleteDiscordNotificationPrefs(projectId),
    onSuccess: () => {
      setLocalOverrides({});
      showToast.success("Reverted to workspace defaults");
      queryClient.invalidateQueries({
        queryKey: projectKeys.discordNotificationPrefs(projectId),
      });
    },
    onError: (error) => {
      showToast.error(
        error instanceof Error
          ? error.message
          : "Failed to revert notification preferences"
      );
    },
  });

  const handleToggle = useCallback(
    (key: NotificationPrefKey | "enabled", value: boolean) => {
      setLocalOverrides((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const handleMasterToggle = useCallback((value: boolean) => {
    const overrides: Partial<NotificationPrefsFormState> = { enabled: value };
    for (const key of ALL_PREF_KEYS) {
      overrides[key] = value;
    }
    setLocalOverrides(overrides);
  }, []);

  const handleSave = useCallback(() => {
    if (!hasChanges) return;
    const changedFields: Partial<NotificationPrefsFormState> = {};
    for (const [key, value] of Object.entries(localOverrides)) {
      if (
        serverFormState &&
        value !== serverFormState[key as keyof NotificationPrefsFormState]
      ) {
        (changedFields as Record<string, boolean>)[key] = value as boolean;
      }
    }
    updateMutation.mutate(changedFields);
  }, [hasChanges, localOverrides, serverFormState, updateMutation]);

  const handleDiscard = useCallback(() => {
    setLocalOverrides({});
  }, []);

  const handleToggleInherit = useCallback(() => {
    if (isInheriting) {
      // Switch to override mode: create project-level prefs seeded from org defaults
      updateMutation.mutate(orgFormState);
    } else {
      // Switch to inherit mode: delete project-level prefs
      deleteMutation.mutate();
    }
  }, [isInheriting, orgFormState, updateMutation, deleteMutation]);

  return {
    categories: NOTIFICATION_CATEGORIES,
    formState,
    orgFormState,
    isInheriting,
    isLoading,
    isSaving: updateMutation.isPending || deleteMutation.isPending,
    hasChanges,
    handleToggle,
    handleMasterToggle,
    handleSave,
    handleDiscard,
    handleToggleInherit,
  };
};
