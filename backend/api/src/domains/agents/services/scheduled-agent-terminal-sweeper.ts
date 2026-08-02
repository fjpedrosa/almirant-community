interface ScheduledAgentTerminalSweeperDependencies {
  findOutputCandidates(options: {
    limit: number;
  }): Promise<Array<{ id: string }>>;
  findRunCandidates(options: { limit: number }): Promise<string[]>;
  reconcile(jobId: string): Promise<boolean>;
  onError?(jobId: string, error: unknown): void;
}

export const createScheduledAgentTerminalSweeper = (
  dependencies: ScheduledAgentTerminalSweeperDependencies,
) => ({
  sweep: async (options?: {
    limit?: number;
  }): Promise<{ pending: number; reconciled: number }> => {
    const limit = Math.min(Math.max(options?.limit ?? 25, 1), 100);
    const [outputJobs, scheduledJobIds] = await Promise.all([
      dependencies.findOutputCandidates({ limit }),
      dependencies.findRunCandidates({ limit }),
    ]);
    const jobIds = [
      ...new Set([
        ...outputJobs.map((job) => job.id),
        ...scheduledJobIds,
      ]),
    ];

    let reconciled = 0;
    for (const jobId of jobIds) {
      try {
        if (await dependencies.reconcile(jobId)) reconciled += 1;
      } catch (error) {
        dependencies.onError?.(jobId, error);
      }
    }
    return { pending: jobIds.length, reconciled };
  },
});

export type ScheduledAgentTerminalSweeper = ReturnType<
  typeof createScheduledAgentTerminalSweeper
>;
