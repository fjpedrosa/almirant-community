"use client";

import { useDiscordNotificationPrefs } from "../../application/hooks/use-discord-notification-prefs";
import { DiscordNotificationPrefsPanel } from "../components/discord-notification-prefs-panel";

interface DiscordNotificationPrefsContainerProps {
  connectionId: string | null;
}

export const DiscordNotificationPrefsContainer: React.FC<
  DiscordNotificationPrefsContainerProps
> = ({ connectionId }) => {
  const {
    categories,
    formState,
    isLoading,
    isSaving,
    hasChanges,
    handleToggle,
    handleMasterToggle,
    handleSave,
    handleDiscard,
  } = useDiscordNotificationPrefs(connectionId);

  if (!connectionId) {
    return null;
  }

  return (
    <DiscordNotificationPrefsPanel
      categories={categories}
      formState={formState}
      isLoading={isLoading}
      isSaving={isSaving}
      hasChanges={hasChanges}
      onToggle={handleToggle}
      onMasterToggle={handleMasterToggle}
      onSave={handleSave}
      onDiscard={handleDiscard}
    />
  );
};
