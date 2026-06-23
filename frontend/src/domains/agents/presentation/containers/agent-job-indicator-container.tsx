"use client";

import { AgentJobIndicator } from "../components/agent-job-indicator";
import { useAgentJobStatus } from "../../application/hooks/use-agent-jobs";
import type { AgentJob } from "../../domain/types";

interface AgentJobIndicatorContainerProps {
  workItemId: string;
  jobFromMap?: AgentJob;
}

export const AgentJobIndicatorContainer: React.FC<AgentJobIndicatorContainerProps> = ({ workItemId, jobFromMap }) => {
  const { data: jobFromQuery } = useAgentJobStatus(workItemId);
  const job = jobFromMap ?? jobFromQuery ?? null;

  if (!job) return null;
  if (job.status === "cancelled") return null;

  return <AgentJobIndicator status={job.status} provider={job.provider} />;
};

