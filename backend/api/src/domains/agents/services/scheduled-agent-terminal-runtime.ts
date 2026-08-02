import {
  createAgentOutputTerminalFailure,
  findAgentOutputCapabilityByJobId,
  reconcileScheduledAgentRunForTerminalJob,
} from "@almirant/database";
import {
  createAgentOutputFinalizer,
  type AgentOutputFinalizerContext,
} from "./agent-output-finalizer";
import { createScheduledAgentTerminalReconciler } from "./scheduled-agent-terminal-reconciler";

const finalizer = createAgentOutputFinalizer({
  findContext: async (jobId) =>
    (await findAgentOutputCapabilityByJobId(
      jobId,
    )) as AgentOutputFinalizerContext | null,
  createTerminalFailure: createAgentOutputTerminalFailure,
});

const terminalReconciler = createScheduledAgentTerminalReconciler({
  finalizeOutput: (jobId) => finalizer.reconcile(jobId),
  reconcileRun: reconcileScheduledAgentRunForTerminalJob,
});

export const reconcileTerminalScheduledAgentJob = async (
  jobId: string,
): Promise<boolean> => terminalReconciler.reconcile(jobId);
