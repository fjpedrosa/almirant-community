import { wsConnectionManager } from "./ws-connection-manager";

type AgentJobStatusBroadcast = {
  workspaceId: string | null | undefined;
  jobId: string;
  status: string;
  workItemId: string | null;
  planningSessionId?: string | null;
};

export const broadcastAgentJobStatusChanged = (args: AgentJobStatusBroadcast): void => {
  if (!args.workspaceId) return;

  wsConnectionManager.broadcastToWorkspace(args.workspaceId, {
    type: "agent-job:status-changed",
    payload: {
      jobId: args.jobId,
      status: args.status,
      workItemId: args.workItemId,
      planningSessionId: args.planningSessionId ?? null,
    },
  });
};
