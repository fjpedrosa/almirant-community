"use client";

import { useProjectDevFlow } from "../../application/hooks/use-project-dev-flow";
import { useDevFlowDiagnostics } from "../../application/hooks/use-dev-flow-diagnostics";
import { useDevFlowAutomationOverrides } from "../../application/hooks/use-dev-flow-automation-overrides";
import { useDevFlowAdopt } from "../../application/hooks/use-dev-flow-adopt";
import { mergeDevFlowAutomations } from "../../domain/dev-flow";
import { applyDevFlowAutomationDrafts } from "../../domain/dev-flow-automation-overrides";
import { ProjectDevFlowCard } from "../components/project-dev-flow-card";

interface ProjectDevFlowContainerProps {
  projectId: string;
}

export const ProjectDevFlowContainer: React.FC<ProjectDevFlowContainerProps> = ({
  projectId,
}) => {
  const {
    settings,
    serverSettings,
    automations,
    skippedExistingUserAgents,
    isLoading,
    isSaving,
    hasChanges,
    errorMessage,
    handleToggleEnabled,
    handleCodingAgentChange,
    handleAiProviderChange,
    handleModelChange,
    handleReasoningLevelChange,
    handleMaxConcurrentJobsChange,
    handleSave,
    handleDiscard,
  } = useProjectDevFlow(projectId);

  const { diagnosisByConfigId, diagnose } = useDevFlowDiagnostics();

  const {
    drafts,
    handleFieldChange: handleAutomationFieldChange,
    handleScheduleChange: handleAutomationScheduleChange,
    handleSave: handleAutomationSave,
    handleDiscard: handleAutomationDiscard,
    handleResetToDefaults: handleAutomationResetToDefaults,
  } = useDevFlowAutomationOverrides(projectId, automations, serverSettings);

  const { handleAdopt, isAdopting } = useDevFlowAdopt(projectId);

  const automationRows = applyDevFlowAutomationDrafts(
    mergeDevFlowAutomations(automations, diagnosisByConfigId),
    drafts,
  ).map((row) => ({ ...row, isAdopting: isAdopting(row.automationId) }));

  return (
    <ProjectDevFlowCard
      isLoading={isLoading}
      errorMessage={errorMessage}
      settings={settings}
      isSaving={isSaving}
      hasChanges={hasChanges}
      automations={automationRows}
      skippedExistingUserAgents={skippedExistingUserAgents}
      onToggleEnabled={handleToggleEnabled}
      onCodingAgentChange={handleCodingAgentChange}
      onAiProviderChange={handleAiProviderChange}
      onModelChange={handleModelChange}
      onReasoningLevelChange={handleReasoningLevelChange}
      onMaxConcurrentJobsChange={handleMaxConcurrentJobsChange}
      onSave={handleSave}
      onDiscard={handleDiscard}
      onDiagnose={diagnose}
      onAutomationFieldChange={handleAutomationFieldChange}
      onAutomationScheduleChange={handleAutomationScheduleChange}
      onAutomationSave={handleAutomationSave}
      onAutomationDiscard={handleAutomationDiscard}
      onAutomationResetToDefaults={handleAutomationResetToDefaults}
      onAutomationAdopt={handleAdopt}
    />
  );
};
