interface ReconciliationStepResult {
  reconciled: boolean;
}

interface ScheduledAgentTerminalReconcilerDependencies {
  finalizeOutput(jobId: string): Promise<ReconciliationStepResult>;
  reconcileRun(jobId: string): Promise<ReconciliationStepResult>;
}

export const createScheduledAgentTerminalReconciler = (
  dependencies: ScheduledAgentTerminalReconcilerDependencies,
) => ({
  reconcile: async (jobId: string): Promise<boolean> => {
    // Required-output finalization is first by contract: the run projection
    // must observe `submitted` or the durable `terminal_error`, never infer
    // success from a completed process alone.
    const outputResult = await dependencies.finalizeOutput(jobId);
    const runResult = await dependencies.reconcileRun(jobId);
    return outputResult.reconciled || runResult.reconciled;
  },
});

export type ScheduledAgentTerminalReconciler = ReturnType<
  typeof createScheduledAgentTerminalReconciler
>;
