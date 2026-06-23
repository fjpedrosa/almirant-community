export type AgentJobResult = {
  summary: string;
  filesChanged: string[];
  linesAdded: number;
  linesRemoved: number;
  // Optional metadata stored on the job record (not required for all jobs).
  prUrl?: string;
  prNumber?: number;
  commitSha?: string;
  cost?: number;
  tokensUsed?: number;
};

export type QueuedJob = {
  jobId: string;
  workItemId: string | null;
  projectId: string | null;
  boardId: string | null;
  provider: "claude-code" | "codex";
  priority: "low" | "medium" | "high" | "urgent";
  retryCount: number;
  maxRetries: number;
  availableAt: string | null;
  config: Record<string, unknown>;
  /** Claude Code session ID from a previous run (used for resume on retry) */
  sessionId?: string;
};

export type QueueAdapter = {
  claimJobs: (workerId: string, count: number) => Promise<QueuedJob[]>;
  reportCompletion: (jobId: string, result: AgentJobResult) => Promise<void>;
  reportFailure: (jobId: string, error: { message: string; type: string }) => Promise<void>;
  scheduleRetry: (jobId: string, args: { retryCount: number; availableAt: string; error: { message: string; type: string } }) => Promise<void>;
  reportRunning: (jobId: string, args: { branchName?: string; worktreePath?: string; sessionId?: string }) => Promise<void>;
  releaseJob: (jobId: string) => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

export type QueueAdapterConfig = {
  apiBaseUrl: string;
  apiKey: string;
  workerId: string;
  pollIntervalMs?: number;
  maxClaimCount?: number;
  redisUrl?: string;
  // Optional hook used by adapters that actively pull jobs (polling/BullMQ).
  onJobs?: (jobs: QueuedJob[]) => Promise<void> | void;
};
