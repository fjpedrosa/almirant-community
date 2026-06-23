"use client";

import { useOrchestrationSettings } from "../../application/hooks/use-orchestration-settings";
import { OrchestrationSettings } from "../components/orchestration-settings";

export const OrchestrationSettingsContainer: React.FC = () => {
  const {
    strategy,
    isLoading,
    isSaving,
    connections,
    isLoadingConnections,
    handleStrategyChange,
  } = useOrchestrationSettings();

  return (
    <OrchestrationSettings
      strategy={strategy}
      isLoading={isLoading}
      isSaving={isSaving}
      connections={connections}
      isLoadingConnections={isLoadingConnections}
      onStrategyChange={handleStrategyChange}
    />
  );
};
