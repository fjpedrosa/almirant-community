"use client";

import { Bot } from "lucide-react";
import { AgentDashboardContainer } from "@/domains/agents/presentation/containers/agent-dashboard-container";
import { SettingsPageShell } from "../../components/settings-page-shell";

export const AgentProvidersSettingsContainer: React.FC = () => {
  return (
    <SettingsPageShell
      title={
        <>
          <Bot className="h-5 w-5 text-muted-foreground" />
          Agent Providers
        </>
      }
      description="Configure agent execution providers and service connections. Session history lives in Sessions."
    >
      <AgentDashboardContainer showRecentJobs={false} />
    </SettingsPageShell>
  );
};
