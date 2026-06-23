// WebSocket protocol types - Server side
// Mirror these types in frontend/src/domains/shared/domain/ws-types.ts

export type AiFieldContext =
  | "description"
  | "definitionOfDone"
  | "prompt"
  | "multiPrompt"
  | "sharePost";

// --- Client -> Server messages ---

export interface WsClientPing {
  type: "ping";
}

export interface WsClientAiFormatRequest {
  type: "ai:format-text";
  requestId: string;
  payload: {
    text: string;
    fieldContext: AiFieldContext;
    workItemId?: string;
  };
}

export interface WsClientPlanningStart {
  type: "planning:start";
  payload: {
    sessionId: string;
    userMessage: string;
    seedIds?: string[];
    provider?: string;
    codingAgent?: string;
    model?: string;
  };
}

export interface WsClientPlanningAnswer {
  type: "planning:answer";
  payload: {
    sessionId: string;
    questionId: string;
    answer: string;
  };
}

export interface WsClientPlanningPrompt {
  type: "planning:prompt";
  payload: {
    sessionId: string;
    prompt: string;
    questionId?: string;
  };
}

export interface WsClientPlanningCancel {
  type: "planning:cancel";
  payload: {
    sessionId: string;
  };
}

export interface WsClientPlanningPrewarm {
  type: "planning:prewarm";
  payload: {
    sessionId: string;
  };
}

export interface WsClientPlanningKill {
  type: "planning:kill";
  payload: {
    sessionId: string;
  };
}

export interface WsClientPlanningInterrupt {
  type: "planning:interrupt";
  payload: {
    sessionId: string;
  };
}

export type WsClientMessage =
  | WsClientPing
  | WsClientAiFormatRequest
  | WsClientPlanningStart
  | WsClientPlanningAnswer
  | WsClientPlanningPrompt
  | WsClientPlanningCancel
  | WsClientPlanningPrewarm
  | WsClientPlanningKill
  | WsClientPlanningInterrupt;

// --- Server -> Client messages ---

export interface WsServerPing {
  type: "ping";
}

export interface WsServerPong {
  type: "pong";
}

export interface WsServerAiAccepted {
  type: "ai:accepted";
  requestId: string;
}

export interface WsServerAiResult {
  type: "ai:result";
  requestId: string;
  payload: {
    formattedText: string;
    fieldContext: AiFieldContext;
    workItemId?: string;
    savedToDb: boolean;
  };
}

export interface WsServerAiError {
  type: "ai:error";
  requestId: string;
  payload: {
    message: string;
    code: string;
  };
}

export interface WsServerAiSessionRecorded {
  type: "ai:session-recorded";
  payload: {
    workItemId: string;
    boardId: string | null;
    taskId: string | null;
    title: string | null;
    model: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    /** Cache read tokens — billed at a fraction of the input rate. Optional for legacy callers. */
    cacheReadInputTokens?: number;
    /** Cache creation tokens — billed above the input rate on Anthropic/Z.AI. Optional for legacy callers. */
    cacheCreationInputTokens?: number;
    totalTokens: number;
    estimatedCost: string;
    durationMs: number | null;
    sessionType: string;
    metadata: Record<string, unknown>;
    createdAt: string;
  };
}

export interface WsServerWorkItemCreated {
  type: "work-item:created";
  payload: {
    workItemId: string;
    boardId: string;
    title: string;
    taskId?: string;
  };
}

export interface WsServerWorkItemUpdated {
  type: "work-item:updated";
  payload: {
    workItemId: string;
    boardId?: string;
    changes: Record<string, unknown>;
  };
}

export interface WsServerWorkItemDeleted {
  type: "work-item:deleted";
  payload: {
    workItemId: string;
    boardId?: string;
  };
}

export interface WsServerWorkItemReviewCompleted {
  type: "work-item:review-completed";
  payload: {
    workItemId: string;
    boardId?: string;
    taskId?: string;
    title: string;
    result: "pass" | "fail";
    summary: string;
    targetColumn: string;
  };
}

export interface WsServerAgentJobStatusChanged {
  type: "agent-job:status-changed";
  payload: {
    jobId: string;
    status: string;
    workItemId: string | null;
    planningSessionId?: string | null;
  };
}

export type WorkerInteractionQuestionType = "clarification" | "approval" | "choice" | "free_text";

export interface WsServerWorkerInteractionCreated {
  type: "worker-interaction:created";
  payload: {
    questionId: string;
    jobId: string;
    workItemId: string;
    planningSessionId?: string | null;
    workItemTitle: string;
    provider: string;
    questionText: string;
    questionType: WorkerInteractionQuestionType;
    options: string[] | null;
    context: Record<string, unknown> | null;
    expiresAt: string;
  };
}

export interface WsServerWorkerInteractionResponded {
  type: "worker-interaction:responded";
  payload: {
    interactionId: string;
    jobId: string;
    workItemId: string;
  };
}

export interface WsServerWorkerInteractionExpired {
  type: "worker-interaction:expired";
  payload: {
    interactionId: string;
    jobId: string;
    workItemId: string;
  };
}

export interface WsServerIdeaItemCreated {
  type: "idea-item:created";
  payload: {
    ideaItemId: string;
    type: string;
    title: string;
    projectId: string | null;
  };
}

export interface WsServerIdeaItemUpdated {
  type: "idea-item:updated";
  payload: {
    ideaItemId: string;
    changes: Record<string, unknown>;
  };
}

export interface WsServerIdeaItemDeleted {
  type: "idea-item:deleted";
  payload: {
    ideaItemId: string;
  };
}

export interface WsServerIdeaCommentCreated {
  type: "idea-comment:created";
  payload: {
    ideaItemId: string;
    commentId: string;
  };
}

export interface WsServerIdeaCommentUpdated {
  type: "idea-comment:updated";
  payload: {
    ideaItemId: string;
    commentId: string;
  };
}

export interface WsServerIdeaCommentDeleted {
  type: "idea-comment:deleted";
  payload: {
    ideaItemId: string;
    commentId: string;
  };
}

export interface WsServerNotificationNew {
  type: "notification:new";
  payload: {
    id: string;
    type: string;
    title: string;
    body: string | null;
    link: string | null;
    actorUserId: string | null;
    metadata: Record<string, unknown>;
    createdAt: string;
  };
}

export interface WsServerNotificationRead {
  type: "notification:read";
  payload: {
    notificationId: string;
  };
}

export interface WsServerNotificationReadAll {
  type: "notification:read-all";
  payload: Record<string, never>;
}

export interface WsServerConnectionUpdated {
  type: "connection:updated";
  payload: {
    provider: "github";
    scope: "organization" | "user";
    scopeId: string;
    connectionId: string | null;
    action: "connected" | "disconnected" | "updated";
  };
}

export interface WsServerFeedbackItemCreated {
  type: "feedback-item:created";
  payload: {
    feedbackItemId: string;
    title: string;
  };
}

export interface WsServerFeedbackItemUpdated {
  type: "feedback-item:updated";
  payload: {
    feedbackItemId: string;
    changes: Record<string, unknown>;
  };
}

export interface WsServerFeedbackItemDeleted {
  type: "feedback-item:deleted";
  payload: {
    feedbackItemId: string;
  };
}

export interface WsServerFeedbackCommentCreated {
  type: "feedback-comment:created";
  payload: {
    feedbackItemId: string;
    commentId: string;
  };
}

export interface WsServerFeedbackCommentUpdated {
  type: "feedback-comment:updated";
  payload: {
    feedbackItemId: string;
    commentId: string;
  };
}

export interface WsServerFeedbackCommentDeleted {
  type: "feedback-comment:deleted";
  payload: {
    feedbackItemId: string;
    commentId: string;
  };
}

export interface WsServerTodoItemCreated {
  type: "todo-item:created";
  payload: {
    todoItemId: string;
    title: string;
    projectId: string | null;
  };
}

export interface WsServerTodoItemUpdated {
  type: "todo-item:updated";
  payload: {
    todoItemId: string;
    changes: Record<string, unknown>;
  };
}

export interface WsServerTodoItemDeleted {
  type: "todo-item:deleted";
  payload: {
    todoItemId: string;
  };
}

export interface WsServerSeedCreated {
  type: "seed:created";
  payload: {
    seedId: string;
    title: string;
    projectId: string | null;
  };
}

export interface WsServerSeedUpdated {
  type: "seed:updated";
  payload: {
    seedId: string;
    changes: Record<string, unknown>;
  };
}

export interface WsServerSeedDeleted {
  type: "seed:deleted";
  payload: {
    seedId: string;
  };
}

export interface WsServerPlanningSessionCreated {
  type: "planning-session:created";
  payload: {
    sessionId: string;
    projectId: string | null;
    title: string;
  };
}

export interface WsServerPlanningSessionUpdated {
  type: "planning-session:updated";
  payload: {
    sessionId: string;
    changes: Record<string, unknown>;
  };
}

export interface WsServerPlanningSessionCompleted {
  type: "planning-session:completed";
  payload: {
    sessionId: string;
    result: {
      summary?: string;
      workItemsCreated?: number;
      seedsProcessed?: number;
      reason?: string;
    };
  };
}

export interface WsServerPlanningSessionResumed {
  type: "planning-session:resumed";
  payload: {
    sessionId: string;
  };
}

export interface WsServerPlanningText {
  type: "planning:text";
  payload: {
    sessionId: string;
    content: string;
  };
}

export interface WsServerPlanningThinking {
  type: "planning:thinking";
  payload: {
    sessionId: string;
    content: string;
  };
}

export interface WsServerPlanningStep {
  type: "planning:step";
  payload: {
    sessionId: string;
    stepName: string;
    stepIndex: number;
  };
}

export interface WsServerPlanningQuestion {
  type: "planning:question";
  payload: {
    sessionId: string;
    questionId: string;
    questionText: string;
    options: string[];
    questions?: Array<{
      text: string;
      options: string[];
    }>;
    questionType?: "single_choice" | "multi_choice" | "free_text";
    source?: string;
    expiresAt?: string | null;
  };
}

export interface WsServerPlanningAnswerReceived {
  type: "planning:answer-received";
  payload: {
    sessionId: string;
    questionId: string;
    answer: string;
  };
}

export interface WsServerPlanningResponseComplete {
  type: "planning:response-complete";
  payload: {
    sessionId: string;
    summary?: string;
    requiresFollowUp?: boolean;
    followUpPrompt?: string;
  };
}

export interface WsServerPlanningDone {
  type: "planning:done";
  payload: {
    sessionId: string;
    generatedItems?: Array<{
      tempId: string;
      type: string;
      title: string;
      description: string;
      priority: string;
      parentTempId?: string;
      fromSeedId?: string;
    }>;
    reason?: string;
    workItemCount?: number;
  };
}

export interface WsServerPlanningError {
  type: "planning:error";
  payload: {
    sessionId: string;
    message: string;
    code?: string;
  };
}

export interface WsServerPlanningWaveStart {
  type: "planning:wave-start";
  payload: {
    sessionId: string;
    agents: Array<{
      id: string;
      name: string;
      role: string;
    }>;
  };
}

export interface WsServerPlanningAgentDone {
  type: "planning:agent-done";
  payload: {
    sessionId: string;
    agentId: string;
    success: boolean;
    reason?: string;
  };
}

export interface WsServerPlanningWaveEnd {
  type: "planning:wave-end";
  payload: {
    sessionId: string;
    successCount: number;
    totalCount: number;
  };
}

export interface WsServerPlanningToolCallStart {
  type: "planning:tool-call-start";
  payload: {
    sessionId: string;
    toolCallId: string;
    toolName: string;
    inputPreview?: string;
  };
}

export interface WsServerPlanningToolCallResult {
  type: "planning:tool-call-result";
  payload: {
    sessionId: string;
    toolCallId: string;
    toolName: string;
    success: boolean;
    outputPreview?: string;
  };
}

export interface WsServerPlanningFileRead {
  type: "planning:file-read";
  payload: {
    sessionId: string;
    filePath: string;
    lineRange?: string;
  };
}

export interface WsServerPlanningFileChange {
  type: "planning:file-change";
  payload: {
    sessionId: string;
    filePath: string;
    operation: "write" | "edit";
  };
}

export interface WsServerPlanningBashExecute {
  type: "planning:bash-execute";
  payload: {
    sessionId: string;
    command: string;
    description?: string;
  };
}

export interface WsServerPlanningSubagentSpawn {
  type: "planning:subagent-spawn";
  payload: {
    sessionId: string;
    subagentId: string;
    description: string;
    isBackground: boolean;
    subagentType?: string;
  };
}

export interface WsServerPlanningSubagentComplete {
  type: "planning:subagent-complete";
  payload: {
    sessionId: string;
    subagentId: string;
    success: boolean;
  };
}

export interface WsServerPlanningTokenUsage {
  type: "planning:token-usage";
  payload: {
    sessionId: string;
    inputTokens: number;
    outputTokens: number;
    totalInputTokens?: number;
    totalOutputTokens?: number;
    model?: string;
  };
}

export interface WsServerAgentJobLogBatch {
  type: "agent-job:log-batch";
  payload: {
    jobId: string;
    workItemId: string | null;
    chunks: Array<{
      seq: number;
      level: string;
      phase: string;
      eventType: string;
      message: string;
      timestamp: string;
    }>;
  };
}

export interface WsServerPlanningPrewarmReady {
  type: "planning:prewarm-ready";
  payload: {
    sessionId: string;
    jobId: string;
  };
}

export interface WsServerPlanningSessionInterrupted {
  type: "planning-session:interrupted";
  payload: {
    sessionId: string;
    reason: string;
    pendingQuestionText?: string;
    workItemsCreated: number;
  };
}

export interface WsServerPlanningPaused {
  type: "planning:paused";
  payload: {
    sessionId: string;
  };
}

export interface WsServerPlanningPromptAck {
  type: "planning:prompt-ack";
  payload: {
    sessionId: string;
    promptId: string;
    status: "processing" | "queued";
  };
}

export type WsServerMessage =
  | WsServerPing
  | WsServerPong
  | WsServerAiAccepted
  | WsServerAiResult
  | WsServerAiError
  | WsServerAiSessionRecorded
  | WsServerWorkItemCreated
  | WsServerWorkItemUpdated
  | WsServerWorkItemDeleted
  | WsServerWorkItemReviewCompleted
  | WsServerAgentJobStatusChanged
  | WsServerWorkerInteractionCreated
  | WsServerWorkerInteractionResponded
  | WsServerWorkerInteractionExpired
  | WsServerIdeaItemCreated
  | WsServerIdeaItemUpdated
  | WsServerIdeaItemDeleted
  | WsServerIdeaCommentCreated
  | WsServerIdeaCommentUpdated
  | WsServerIdeaCommentDeleted
  | WsServerNotificationNew
  | WsServerNotificationRead
  | WsServerNotificationReadAll
  | WsServerConnectionUpdated
  | WsServerFeedbackItemCreated
  | WsServerFeedbackItemUpdated
  | WsServerFeedbackItemDeleted
  | WsServerFeedbackCommentCreated
  | WsServerFeedbackCommentUpdated
  | WsServerFeedbackCommentDeleted
  | WsServerTodoItemCreated
  | WsServerTodoItemUpdated
  | WsServerTodoItemDeleted
  | WsServerSeedCreated
  | WsServerSeedUpdated
  | WsServerSeedDeleted
  | WsServerPlanningSessionCreated
  | WsServerPlanningSessionUpdated
  | WsServerPlanningSessionCompleted
  | WsServerPlanningSessionResumed
  | WsServerPlanningSessionInterrupted
  | WsServerPlanningText
  | WsServerPlanningThinking
  | WsServerPlanningStep
  | WsServerPlanningQuestion
  | WsServerPlanningAnswerReceived
  | WsServerPlanningResponseComplete
  | WsServerPlanningDone
  | WsServerPlanningError
  | WsServerPlanningWaveStart
  | WsServerPlanningAgentDone
  | WsServerPlanningWaveEnd
  | WsServerPlanningToolCallStart
  | WsServerPlanningToolCallResult
  | WsServerPlanningFileRead
  | WsServerPlanningFileChange
  | WsServerPlanningBashExecute
  | WsServerPlanningSubagentSpawn
  | WsServerPlanningSubagentComplete
  | WsServerPlanningTokenUsage
  | WsServerAgentJobLogBatch
  | WsServerPlanningPrewarmReady
  | WsServerPlanningPaused
  | WsServerPlanningPromptAck;
