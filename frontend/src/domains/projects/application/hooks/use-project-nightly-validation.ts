"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { projectsApi } from "@/lib/api/client";
import type { ProjectNightlyValidationSettings } from "../../domain/types";
import { projectKeys } from "./use-projects";

const DEFAULT_NIGHTLY_VALIDATION_SETTINGS: ProjectNightlyValidationSettings = {
  enabled: false,
  startHour: 1,
  endHour: 6,
  timezone: "Europe/Madrid",
  provider: "claude-code",
};

export const useProjectNightlyValidation = (projectId: string) => {
  const queryClient = useQueryClient();

  const {
    data: serverSettings,
    isLoading,
    error: queryError,
  } = useQuery({
    queryKey: projectKeys.nightlyValidation(projectId),
    queryFn: async () => {
      const result = await projectsApi.getNightlyValidation(projectId);
      return result as ProjectNightlyValidationSettings;
    },
    enabled: !!projectId,
  });

  const [localSettings, setLocalSettings] =
    useState<ProjectNightlyValidationSettings | null>(null);

  const settings = localSettings ?? serverSettings ?? null;

  const hasChanges =
    localSettings !== null &&
    serverSettings !== undefined &&
    (localSettings.enabled !== serverSettings.enabled ||
      localSettings.startHour !== serverSettings.startHour ||
      localSettings.endHour !== serverSettings.endHour ||
      localSettings.timezone !== serverSettings.timezone ||
      localSettings.provider !== serverSettings.provider);

  const mutation = useMutation({
    mutationFn: (data: ProjectNightlyValidationSettings) =>
      projectsApi.updateNightlyValidation(projectId, data),
    onSuccess: (updatedSettings) => {
      setLocalSettings(null);
      queryClient.setQueryData(
        projectKeys.nightlyValidation(projectId),
        updatedSettings
      );
      showToast.success("Nightly validation updated");
      queryClient.invalidateQueries({
        queryKey: projectKeys.nightlyValidation(projectId),
      });
    },
    onError: (error) => {
      showToast.error(
        error instanceof Error
          ? error.message
          : "Failed to save nightly validation settings"
      );
    },
  });

  const errorMessage =
    queryError instanceof Error
      ? queryError.message
      : mutation.error instanceof Error
        ? mutation.error.message
        : null;

  const handleChange = useCallback(
    (
      field: keyof ProjectNightlyValidationSettings,
      value: ProjectNightlyValidationSettings[keyof ProjectNightlyValidationSettings]
    ) => {
      setLocalSettings((prev) => {
        const base =
          prev ?? serverSettings ?? DEFAULT_NIGHTLY_VALIDATION_SETTINGS;
        return { ...base, [field]: value };
      });
    },
    [serverSettings]
  );

  const handleSave = useCallback(() => {
    if (localSettings) {
      mutation.mutate(localSettings);
    }
  }, [localSettings, mutation]);

  const handleDiscard = useCallback(() => {
    setLocalSettings(null);
  }, []);

  return {
    settings,
    isLoading,
    isSaving: mutation.isPending,
    hasChanges,
    errorMessage,
    handleChange,
    handleSave,
    handleDiscard,
  };
};
