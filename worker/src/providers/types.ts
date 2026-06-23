export type AgentWorkItemType = "task" | "story" | "feature" | "epic";

export type AgentTaskInput = {
  /** Almirant internal work item UUID */
  workItemId: string;
  /** Human-friendly task identifier (e.g. "MC-248") */
  taskId: string;
  title: string;
  description: string;
  type: AgentWorkItemType;
  priority: "low" | "medium" | "high" | "urgent" | string;
  metadata: Record<string, unknown>;
  projectContext?: Record<string, unknown>;
};

export type AgentEnvironment = {
  /** Absolute path to the repo/worktree where the agent should operate */
  repoPath: string;
  /** Git branch name associated with the worktree */
  branchName?: string;
  /** Almirant MCP server URL (http(s)://.../mcp) */
  mcpServerUrl?: string;
  /** API key for Almirant MCP server */
  mcpApiKey?: string;
  /** Optional project UUID to scope MCP tools */
  projectId?: string;
};

export type AgentProviderConfig = {
  /** API key for the provider (if applicable) */
  apiKey?: string;
  /** Provider model override (if applicable) */
  model?: string;
  /** Token limit override (if applicable) */
  maxTokens?: number;
  /** Execution timeout in milliseconds */
  timeout?: number;
  /** Maximum budget in USD for a single execution (Claude Code SDK) */
  maxBudgetUsd?: number;
  /** Session ID to resume a previous Claude Code session */
  resumeSessionId?: string;
};

export type AgentRateLimitInfo = {
  /** Provider that reported the rate limit (e.g. "anthropic", "openai") */
  provider: string;
  /** Seconds to wait before retrying, if available */
  retryAfterSeconds?: number;
  /** When the token rate limit resets (ISO 8601) */
  tokensReset?: string;
  /** When the request rate limit resets (ISO 8601) */
  requestsReset?: string;
  /** When this rate limit event was captured (ISO 8601) */
  capturedAt: string;
};

export type AgentResult = {
  success: boolean;
  filesChanged: string[];
  commitSha?: string;
  prUrl?: string;
  prNumber?: number;
  cost?: number;
  tokens?: number;
  durationMs: number;
  summary: string;
  /** Rate limit information captured during execution, if any rate limit was hit */
  rateLimitInfo?: AgentRateLimitInfo;
  /** Claude Code session ID captured from the init message */
  sessionId?: string;
  /** Total cost in USD as reported by the SDK result message */
  totalCostUsd?: number;
};

export type AgentProgressPhase = "starting" | "reading" | "implementing" | "testing";

export type AgentProgress = {
  phase: AgentProgressPhase;
  message: string;
  timestamp: string;
};

/**
 * Opaque handle used by providers to support abort.
 * Branded string so it can be stored/serialized safely if needed, while staying type-safe.
 */
export type AgentHandle = string & { readonly __agentHandle: unique symbol };

export type CodingAgentProvider = {
  /**
   * Execute a coding task and return a structured result.
   * Providers should periodically call `onProgress` if supplied.
   */
  execute: (
    task: AgentTaskInput,
    env: AgentEnvironment,
    config: AgentProviderConfig,
    onProgress?: (progress: AgentProgress) => void,
  ) => Promise<{ result: AgentResult; handle?: AgentHandle }>;
  /** Abort a running execution, if supported by the provider. */
  abort: (handle: AgentHandle) => void;
};
