"use client";

import { useAgentDashboard } from "../../application/hooks/use-agent-dashboard";
import { useAgentConnections } from "../../application/hooks/use-agent-connections";
import { useLiveTimer } from "../../application/hooks/use-live-timer";
import { AgentExecutionDashboard } from "../components/agent-execution-dashboard";
import { AgentConnectionPanel } from "../components/agent-connection-panel";

interface AgentDashboardContainerProps {
  showRecentJobs?: boolean;
}

export const AgentDashboardContainer: React.FC<AgentDashboardContainerProps> = ({
  showRecentJobs = true,
}) => {
  const { stats, activeJobs, recentJobs, isLoading } = useAgentDashboard();
  const agentConnections = useAgentConnections();

  const hasRunningJobs = activeJobs.some((j) => j.status === "running" || j.status === "finalizing");
  const currentTime = useLiveTimer(hasRunningJobs);

  return (
    <div className="space-y-6">
      <AgentConnectionPanel
        projectOptions={agentConnections.projectOptions}
        selectedProjectId={agentConnections.selectedProjectId}
        agentName={agentConnections.agentName}
        generatedPrompt={agentConnections.generatedPrompt}
        connections={agentConnections.connections}
        isLoading={agentConnections.isLoading}
        isGenerating={agentConnections.isGenerating}
        isRevoking={agentConnections.isRevoking}
        canGenerate={agentConnections.canGenerate}
        onProjectChange={agentConnections.setSelectedProjectId}
        onAgentNameChange={agentConnections.setAgentName}
        onGeneratePrompt={agentConnections.generatePrompt}
        onCopyPrompt={agentConnections.copyPrompt}
        onRevokeConnection={agentConnections.revokeConnection}
      />
      <AgentExecutionDashboard
        stats={stats}
        activeJobs={activeJobs}
        recentJobs={recentJobs}
        isLoading={isLoading}
        currentTime={currentTime}
        showRecentJobs={showRecentJobs}
      />
    </div>
  );
};
