"use client";

import { useProjectNightlyValidation } from "../../application/hooks/use-project-nightly-validation";
import { useProjectAiConfig } from "../../application/hooks/use-project-ai-config";
import { useProjectArchive } from "../../application/hooks/use-project-archive";
import { useProjectDiscord } from "../../application/hooks/use-project-discord";
import { useProjectDiscordNotificationPrefs } from "../../application/hooks/use-project-discord-notification-prefs";
import { ProjectNightlyValidationCard } from "../components/project-nightly-validation-card";
import { ProjectAiConfigCard } from "../components/project-ai-config-card";
import { ProjectDiscordChannelCard } from "../components/project-discord-channel-card";
import { ProjectDiscordNotificationPrefsCard } from "../components/project-discord-notification-prefs-card";
import { ProjectDangerZoneCard } from "../components/project-danger-zone-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";

interface ProjectSettingsContainerProps {
  projectId: string;
  projectName: string;
}

export const ProjectSettingsContainer: React.FC<ProjectSettingsContainerProps> = ({
  projectId,
  projectName,
}) => {
  const {
    settings,
    isLoading,
    isSaving,
    hasChanges,
    errorMessage,
    handleChange,
    handleSave,
    handleDiscard,
  } = useProjectNightlyValidation(projectId);

  const {
    defaultProvider,
    implementationDefaults,
    isLoading: isLoadingAiConfig,
    isSaving: isSavingAiConfig,
    hasChanges: hasAiConfigChanges,
    errorMessage: aiConfigError,
    handleChange: handleAiConfigChange,
    handleCodingAgentChange,
    handleAiProviderChange,
    handleModelChange,
    handleReasoningLevelChange,
    handleSave: handleAiConfigSave,
    handleDiscard: handleAiConfigDiscard,
  } = useProjectAiConfig(projectId);

  const {
    channelData,
    channels,
    isLoading: isLoadingDiscord,
    isSaving: isSavingDiscord,
    selectedChannelId,
    handleChannelSelect,
    handleSave: handleSaveDiscord,
    handleDiscard: handleDiscardDiscord,
    hasChanges: hasDiscordChanges,
  } = useProjectDiscord(projectId);

  const {
    categories: notifCategories,
    formState: notifFormState,
    orgFormState: notifOrgFormState,
    isInheriting: isNotifInheriting,
    isLoading: isLoadingNotifPrefs,
    isSaving: isSavingNotifPrefs,
    hasChanges: hasNotifChanges,
    handleToggle: handleNotifToggle,
    handleMasterToggle: handleNotifMasterToggle,
    handleSave: handleNotifSave,
    handleDiscard: handleNotifDiscard,
    handleToggleInherit: handleNotifToggleInherit,
  } = useProjectDiscordNotificationPrefs(projectId);

  const {
    confirmationText,
    setConfirmationText,
    isConfirmationValid,
    handleArchive,
    isArchiving,
  } = useProjectArchive(projectId, projectName);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ProjectAiConfigCard
        defaultProvider={defaultProvider}
        implementationDefaults={implementationDefaults}
        isSaving={isSavingAiConfig}
        hasChanges={hasAiConfigChanges}
        errorMessage={aiConfigError}
        onChange={handleAiConfigChange}
        onCodingAgentChange={handleCodingAgentChange}
        onAiProviderChange={handleAiProviderChange}
        onModelChange={handleModelChange}
        onReasoningLevelChange={handleReasoningLevelChange}
        onSave={handleAiConfigSave}
        onDiscard={handleAiConfigDiscard}
      />

      <Separator />

      <ProjectNightlyValidationCard
        settings={settings}
        isSaving={isSaving}
        hasChanges={hasChanges}
        errorMessage={errorMessage}
        onChange={handleChange}
        onSave={handleSave}
        onDiscard={handleDiscard}
      />

      <Separator />

      <ProjectDiscordChannelCard
        channelData={channelData}
        channels={channels}
        selectedChannelId={selectedChannelId}
        isLoading={isLoadingDiscord}
        isSaving={isSavingDiscord}
        hasChanges={hasDiscordChanges}
        onChannelSelect={handleChannelSelect}
        onSave={handleSaveDiscord}
        onDiscard={handleDiscardDiscord}
      />

      <ProjectDiscordNotificationPrefsCard
        isConnected={channelData?.connection !== null && channelData?.connection !== undefined}
        isInheriting={isNotifInheriting}
        categories={notifCategories}
        formState={notifFormState}
        orgFormState={notifOrgFormState}
        isLoading={isLoadingNotifPrefs}
        isSaving={isSavingNotifPrefs}
        hasChanges={hasNotifChanges}
        onToggle={handleNotifToggle}
        onMasterToggle={handleNotifMasterToggle}
        onSave={handleNotifSave}
        onDiscard={handleNotifDiscard}
        onToggleInherit={handleNotifToggleInherit}
      />

      <Separator />

      <ProjectDangerZoneCard
        projectName={projectName}
        confirmationText={confirmationText}
        onConfirmationTextChange={setConfirmationText}
        isArchiving={isArchiving}
        isConfirmationValid={isConfirmationValid}
        onArchive={handleArchive}
      />
    </div>
  );
};
