"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { useTranslations } from "next-intl";
import { withTraceSinkReducer } from "@/domains/debug/application/with-trace-sink-reducer";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { useWsContextOptional } from "@/domains/shared/application/hooks/use-ws-context";
import { request } from "@/lib/api/client";
import { buildSessionDisplayChunks } from "@/domains/sessions/application/utils/session-events-to-display-chunks";
import { chunksToConversationMessages } from "@/domains/sessions/application/utils/chunks-to-conversation-messages";
import { parseChunksToStreamingBlocks } from "@/domains/sessions/application/utils/chunk-to-block-parser";
import type { ConversationMessage } from "@/domains/shared/domain/conversation-types";
import { planningSessionsApi } from "../../infrastructure/api/planning-api";
import type {
  PlanningPhase,
  PlanningPendingInteraction,
  PlanningSession,
  PlanningSessionWithPendingInteraction,
  PlanningMessage,
  GeneratedWorkItem,
  CreatePlanningSessionRequest,
} from "../../domain/types";
import type { AgentLogChunk } from "@/domains/shared/domain/types";
import type { SessionEventRecord } from "@/domains/sessions/domain/types";
import type {
  WsServerMessage,
  WsServerPlanningSessionCompleted,
  WsServerPlanningSessionResumed,
  WsServerPlanningSessionInterrupted,
  WsServerPlanningText,
  WsServerPlanningThinking,
  WsServerPlanningStep,
  WsServerPlanningQuestion,
  WsServerPlanningAnswerReceived,
  WsServerPlanningDone,
  WsServerPlanningError,
  WsServerPlanningWaveStart,
  WsServerPlanningAgentDone,
  WsServerPlanningWaveEnd,
  WsServerPlanningResponseComplete,
  WsServerPlanningToolCallStart,
  WsServerPlanningToolCallResult,
  WsServerPlanningFileRead,
  WsServerPlanningFileChange,
  WsServerPlanningBashExecute,
  WsServerPlanningSubagentSpawn,
  WsServerPlanningSubagentComplete,
  WsServerPlanningTokenUsage,
  WsServerPlanningPaused,
  WsServerPlanningPromptAck,
  WsServerPlanningMessageQueued,
  WsServerPlanningMessageDequeued,
} from "@/domains/shared/domain/ws-types";

// --- State types ---

interface WaveAgent {
  id: string;
  name: string;
  role: string;
  done?: boolean;
  success?: boolean;
}

interface WaveInfo {
  agents: WaveAgent[];
  successCount: number;
  totalCount: number;
}

interface CurrentStep {
  name: string;
  index: number;
}

interface PendingQuestion {
  questionId: string;
  questionText: string;
  options: string[];
  questions?: Array<{ text: string; options: string[] }>;
  questionType?: "single_choice" | "multi_choice" | "free_text";
}

interface DeferredQuestion extends PendingQuestion {
  expiresAt?: string | null;
  source?: string;
}

const ANSWERED_QUESTIONS_STORAGE_KEY_PREFIX =
  "almirant:planning:answered-questions:";

const appendUniqueQuestionId = (
  questionIds: string[],
  questionId: string,
): string[] => {
  if (!questionId) return questionIds;
  return questionIds.includes(questionId)
    ? questionIds
    : [...questionIds, questionId];
};

const appendUniqueQuestionSignature = (
  signatures: string[],
  signature: string | null,
): string[] => {
  if (!signature) return signatures;
  return signatures.includes(signature)
    ? signatures
    : [...signatures, signature];
};


const normalizePendingInteractionQuestionType = (
  questionType: string,
): PendingQuestion["questionType"] | undefined => {
  switch (questionType) {
    case "free_text":
      return "free_text";
    case "approval":
    case "choice":
      return "single_choice";
    default:
      return undefined;
  }
};

const normalizeQuestionOption = (value: unknown): string | null => {
  if (typeof value === "string") return value;

  if (typeof value === "object" && value !== null) {
    const option = value as Record<string, unknown>;
    const label =
      typeof option.label === "string"
        ? option.label
        : typeof option.value === "string"
          ? option.value
          : "";
    if (!label) return null;
    const description =
      typeof option.description === "string" ? option.description : undefined;
    return description ? `${label}::${description}` : label;
  }

  return null;
};

const extractStructuredQuestionsFromContext = (
  questionContext: Record<string, unknown> | null | undefined,
): PendingQuestion["questions"] | undefined => {
  if (!questionContext || !Array.isArray(questionContext.questions)) {
    return undefined;
  }

  const questions = questionContext.questions
    .map((question) => {
      if (typeof question !== "object" || question === null) return null;
      const questionObj = question as Record<string, unknown>;
      const text =
        typeof questionObj.text === "string"
          ? questionObj.text
          : typeof questionObj.question === "string"
            ? questionObj.question
            : "";
      if (!text) return null;

      const options = Array.isArray(questionObj.options)
        ? questionObj.options
            .map(normalizeQuestionOption)
            .filter((option): option is string => option !== null)
        : [];

      return { text, options };
    })
    .filter(
      (
        question,
      ): question is NonNullable<PendingQuestion["questions"]>[number] =>
        question !== null,
    );

  return questions.length > 0 ? questions : undefined;
};

const extractAnsweredQuestionTexts = (
  messages: PlanningMessage[],
): Set<string> => {
  const answeredQuestions = new Set<string>();

  for (const message of messages) {
    if (message.role !== "user") continue;

    for (const line of message.content.split("\n")) {
      const separatorIndex = line.indexOf(" → ");
      if (separatorIndex === -1) continue;

      const questionText = line.slice(0, separatorIndex).trim();
      if (questionText) {
        answeredQuestions.add(questionText);
      }
    }
  }

  return answeredQuestions;
};

const hasRestoredQuestionAlreadyBeenAnswered = (
  answeredQuestionTexts: Set<string>,
  question: {
    questionText: string;
    questions?: PendingQuestion["questions"];
  } | null,
): boolean => {
  if (!question) return false;

  const normalizedQuestionText = question.questionText.trim();
  if (
    normalizedQuestionText &&
    answeredQuestionTexts.has(normalizedQuestionText)
  ) {
    return true;
  }

  if (!question.questions || question.questions.length === 0) {
    return false;
  }

  return question.questions.every((structuredQuestion) =>
    answeredQuestionTexts.has(structuredQuestion.text.trim()),
  );
};

const hasQuestionIdAlreadyBeenAnswered = (
  answeredQuestionIds: string[],
  questionId: string | null | undefined,
): boolean => {
  if (!questionId) return false;
  return answeredQuestionIds.includes(questionId);
};

const buildQuestionSignature = (question: {
  questionText: string;
  questions?: PendingQuestion["questions"];
} | null): string | null => {
  if (!question) return null;

  const structuredTexts =
    question.questions
      ?.map((structuredQuestion) => structuredQuestion.text.trim())
      .filter(Boolean) ?? [];

  if (structuredTexts.length > 0) {
    return structuredTexts.join("\n");
  }

  const normalizedQuestionText = question.questionText.trim();
  return normalizedQuestionText || null;
};


const getAnsweredQuestionsStorageKey = (sessionId: string): string =>
  `${ANSWERED_QUESTIONS_STORAGE_KEY_PREFIX}${sessionId}`;

const readPersistedAnsweredQuestionIds = (sessionId: string): string[] => {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.sessionStorage.getItem(
      getAnsweredQuestionsStorageKey(sessionId),
    );
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (questionId): questionId is string =>
        typeof questionId === "string" && questionId.length > 0,
    );
  } catch {
    return [];
  }
};

const persistAnsweredQuestionId = (
  sessionId: string,
  questionId: string | null | undefined,
): void => {
  if (typeof window === "undefined" || !questionId) return;

  const answeredQuestionIds = appendUniqueQuestionId(
    readPersistedAnsweredQuestionIds(sessionId),
    questionId,
  );

  try {
    window.sessionStorage.setItem(
      getAnsweredQuestionsStorageKey(sessionId),
      JSON.stringify(answeredQuestionIds),
    );
  } catch {
    // Best effort only — the in-memory reducer state still handles the happy path.
  }
};

// Re-export for backward compatibility
export type { StreamingBlock } from "@/domains/shared/domain/streaming-block-types";
import type { StreamingBlock } from "@/domains/shared/domain/streaming-block-types";

export type ResumeStep = "queued" | "loading" | "restoring" | "ready";

/** @internal Exported for testing only */
export interface PlanningSessionState {
  phase: PlanningPhase;
  sessionId: string | null;
  session: PlanningSession | null;
  messages: PlanningMessage[];
  streamingContent: string;
  streamingThinkingContent: string;
  /** Ordered array of streaming blocks — preserves chronological order of thinking/text chunks. */
  streamingBlocks: StreamingBlock[];
  currentStep: CurrentStep | null;
  pendingQuestion: PendingQuestion | null;
  /** Buffered question waiting for response-complete before showing the wizard.
   *  Prevents the wizard from appearing before all text/blocks have arrived. */
  deferredQuestion: DeferredQuestion | null;
  /** ISO timestamp when the current interaction expires (for countdown timer). */
  expiresAt: string | null;
  generatedItems: GeneratedWorkItem[];
  waveInfo: WaveInfo | null;
  error: string | null;
  tokenUsage: { input: number; output: number; model?: string };
  /** Accumulated persistent blocks from completed turns (tool_call, subagent, file, bash). */
  completedTurnBlocks: StreamingBlock[][];
  /** Latest real tool activity for the streaming indicator (e.g., "Reading backend/src/index.ts"). */
  latestActivity: string | null;
  /** Current step during session resumption. */
  resumeStep: ResumeStep | null;
  /** Reason why the session was interrupted. */
  interruptionReason: string | null;
  /** User message waiting to be processed by the agent. Shown below Processing indicator. */
  pendingUserMessage: PlanningMessage | null;
  /** Whether the agent is waiting for a follow-up response from the user. */
  pendingFollowUp: boolean;
  /** Contextual prompt text for the follow-up (e.g., agent's last question). */
  followUpPrompt: string | null;
  /** Timestamp in ms when the current processing turn started. */
  processingStartedAt: number | null;
  /** Question ids already answered locally during this live session. */
  answeredQuestionIds: string[];
  /** Signatures of questions already answered to ignore equivalent re-emissions with a new id. */
  answeredQuestionSignatures: string[];
  /** Highest sequenceNum seen from WS events — used to drop duplicates/out-of-order. */
  lastSeenSequenceNum: number;
  /** JobId of the run currently streaming events (adopted from the first sequenced event). */
  activeStreamJobId: string | null;
  /** JobId that was streaming before the current turn started — used to drop late retransmissions. */
  staleStreamJobId: string | null;
  /** High-water sequenceNum of the stale run, recorded at the turn boundary. */
  staleStreamSequenceNum: number;
}

// --- Valid phase transitions ---

const VALID_TRANSITIONS: Record<PlanningPhase, PlanningPhase[]> = {
  idle: ["enriching", "booting"],
  enriching: ["booting", "idle"],
  booting: ["streaming", "thinking", "idle", "paused", "interrupted"],
  chatting: ["streaming", "thinking", "booting", "idle", "completed", "interrupted", "waiting_for_answer"],
  streaming: [
    "chatting",
    "thinking",
    "waiting_for_answer",
    "reviewing",
    "idle",
    "completed",
    "paused",
    "interrupted",
  ],
  thinking: [
    "streaming",
    "chatting",
    "waiting_for_answer",
    "reviewing",
    "idle",
    "completed",
    "paused",
    "interrupted",
  ],
  waiting_for_answer: ["streaming", "thinking", "idle", "completed", "interrupted"],
  reviewing: ["chatting", "streaming", "idle", "completed"],
  completed: ["idle", "booting"],
  paused: ["streaming", "thinking", "chatting", "booting", "idle", "completed", "interrupted"],
  interrupted: ["resuming", "idle", "booting"],
  resuming: ["streaming", "thinking", "booting", "idle", "interrupted"],
};

const canTransition = (from: PlanningPhase, to: PlanningPhase): boolean => {
  return VALID_TRANSITIONS[from].includes(to);
};

// --- Actions ---

type PlanningAction =
  | { type: "SET_SESSION"; session: PlanningSession }
  | { type: "START_STREAMING" }
  | { type: "RECEIVE_TEXT"; content: string; sequenceNum?: number; jobId?: string }
  | { type: "RECEIVE_THINKING"; content: string; sequenceNum?: number; jobId?: string }
  | { type: "RECEIVE_STEP"; stepName: string; stepIndex: number; sequenceNum?: number; jobId?: string }
  | {
      type: "RECEIVE_QUESTION";
      questionId: string;
      questionText: string;
      options: string[];
      questions?: PendingQuestion["questions"];
      questionType?: "single_choice" | "multi_choice" | "free_text";
      expiresAt?: string | null;
      source?: string;
    }
  | { type: "ADD_USER_MESSAGE"; content: string; seeds?: Array<{ id: string; title: string; description?: string }>; queued?: boolean }
  | { type: "ANSWER_QUESTION"; questionId?: string; answer: string }
  | { type: "MARK_QUESTION_ANSWERED"; questionId: string }
  | { type: "RECEIVE_WAVE_START"; agents: WaveAgent[] }
  | {
      type: "RECEIVE_AGENT_DONE";
      agentId: string;
      success: boolean;
      reason?: string;
    }
  | {
      type: "RECEIVE_WAVE_END";
      successCount: number;
      totalCount: number;
    }
  | { type: "RECEIVE_TOOL_CALL_START"; toolCallId: string; toolName: string; inputPreview?: string; sequenceNum?: number; jobId?: string }
  | { type: "RECEIVE_TOOL_CALL_RESULT"; toolCallId: string; success: boolean; sequenceNum?: number; jobId?: string }
  | { type: "RECEIVE_FILE_READ"; filePath: string; lineRange?: string; sequenceNum?: number; jobId?: string }
  | { type: "RECEIVE_FILE_CHANGE"; filePath: string; operation: "write" | "edit"; sequenceNum?: number; jobId?: string }
  | { type: "RECEIVE_BASH_EXECUTE"; command: string; description?: string; sequenceNum?: number; jobId?: string }
  | { type: "RECEIVE_SUBAGENT_SPAWN"; subagentId: string; description: string; isBackground: boolean; subagentType?: string; sequenceNum?: number; jobId?: string }
  | { type: "RECEIVE_SUBAGENT_COMPLETE"; subagentId: string; success: boolean; sequenceNum?: number; jobId?: string }
  | { type: "RECEIVE_TOKEN_USAGE"; inputTokens: number; outputTokens: number; totalInput?: number; totalOutput?: number; model?: string }
  | { type: "RECEIVE_DONE"; generatedItems: GeneratedWorkItem[]; summary?: string }
  | { type: "RECEIVE_RESPONSE_COMPLETE"; summary?: string; requiresFollowUp?: boolean; followUpPrompt?: string; expiresAt?: string | null }
  | { type: "RECEIVE_ERROR"; error: string }
  | { type: "COMPLETE"; result?: PlanningSession["result"] | null }
  | { type: "RESET" }
  | { type: "FLUSH_STREAM" }
  | { type: "CANCEL_SESSION"; latestActivity?: string }
  | {
      type: "LOAD_SESSION";
      session: PlanningSession;
      messages: PlanningMessage[];
      generatedItems?: GeneratedWorkItem[];
      turnBlocks?: StreamingBlock[][];
      pendingQuestion?: {
        questionId: string;
        questionText: string;
        options: string[];
        questions?: PendingQuestion["questions"];
      };
      pendingInteraction?: PlanningPendingInteraction | null;
      activeJobStatus?: AgentJobStatus;
      activeJobStartedAt?: string | null;
      answeredQuestionIds?: string[];
    }
  | {
      type: "RESUME_SESSION";
      session: PlanningSession;
      messages: PlanningMessage[];
      generatedItems?: GeneratedWorkItem[];
      turnBlocks?: StreamingBlock[][];
      pendingQuestion?: {
        questionId: string;
        questionText: string;
        options: string[];
        questions?: PendingQuestion["questions"];
      };
      pendingInteraction?: PlanningPendingInteraction | null;
      answeredQuestionIds?: string[];
    }
  | {
      type: "RECOVER_SESSION";
      session: PlanningSession;
      messages: PlanningMessage[];
      generatedItems?: GeneratedWorkItem[];
    }
  | { type: "INTERRUPT_SESSION"; latestActivity?: string }
  | { type: "RECEIVE_PAUSED"; latestActivity?: string }
  | { type: "RECEIVE_INTERRUPTED"; reason: string; pendingQuestionText?: string; workItemsCreated: number }
  | { type: "START_RESUMING" }
  | { type: "SET_RESUME_STEP"; step: ResumeStep }
  | { type: "PROMPT_ACK"; status: "processing" | "queued" }
  | { type: "MESSAGE_DEQUEUED" };

// --- Initial state ---

/** @internal Exported for testing only */
export const INITIAL_STATE: PlanningSessionState = {
  phase: "idle",
  sessionId: null,
  session: null,
  messages: [],
  streamingContent: "",
  streamingThinkingContent: "",
  streamingBlocks: [],
  currentStep: null,
  pendingQuestion: null,
  deferredQuestion: null,
  expiresAt: null,
  generatedItems: [],
  waveInfo: null,
  error: null,
  tokenUsage: { input: 0, output: 0 },
  completedTurnBlocks: [],
  latestActivity: null,
  resumeStep: null,
  interruptionReason: null,
  pendingUserMessage: null,
  pendingFollowUp: false,
  followUpPrompt: null,
  processingStartedAt: null,
  answeredQuestionIds: [],
  answeredQuestionSignatures: [],
  lastSeenSequenceNum: -1,
  activeStreamJobId: null,
  staleStreamJobId: null,
  staleStreamSequenceNum: -1,
};

const RECENT_RECONNECT_DEDUP_WINDOW_MS = 15_000;
const MIN_RECONNECT_OVERLAP_CHARS = 24;
const MIN_RECONNECT_STRUCTURED_OVERLAP_CHARS = 12;
const HYDRATION_USER_MESSAGE_MATCH_WINDOW_MS = 30_000;
const LEGACY_PLANNING_CONTROL_TOKEN_LINE_PATTERN =
  /^\s*\[(?:STEP|DONE|WARN|ERROR|WAITING|RESPONSE_COMPLETE|QUESTION|OPTIONS)\][^\n]*(?:\n|$)/gm;

export const shouldShowIdleTimeoutToast = ({
  generatedItemsCount,
  summary,
  sessionId,
  lastNotifiedSessionId,
}: {
  generatedItemsCount: number;
  summary: string;
  sessionId: string | null;
  lastNotifiedSessionId: string | null;
}): boolean =>
  generatedItemsCount === 0 &&
  /idle|timeout|killed|cancelled/i.test(summary) &&
  !!sessionId &&
  sessionId !== lastNotifiedSessionId;

export const stripLegacyPlanningControlTokens = (content: string): string => {
  if (!content) return content;
  return content
    .replace(LEGACY_PLANNING_CONTROL_TOKEN_LINE_PATTERN, "")
    .replace(/\n{3,}/g, "\n\n");
};

const hasStructuredChunkShape = (content: string): boolean => {
  return (
    content.includes("\n") ||
    /^\s*(#{1,6}\s|[-*]\s|\d+\.\s)/m.test(content)
  );
};

const getTrailingOverlapLength = (
  existingContent: string,
  incomingContent: string,
): number => {
  const maxOverlap = Math.min(existingContent.length, incomingContent.length);
  for (let overlap = maxOverlap; overlap >= 1; overlap--) {
    if (existingContent.endsWith(incomingContent.slice(0, overlap))) {
      return overlap;
    }
  }
  return 0;
};

/**
 * WebSocket reconnects can retransmit the tail of the current planning response.
 * When that happens we only want to append the novel suffix, not duplicate
 * already-rendered sections like markdown headings + bullet lists.
 */
export const stripRetransmittedStreamingChunk = (
  existingContent: string,
  incomingContent: string,
): string => {
  if (!existingContent || !incomingContent) return incomingContent;

  const overlap = getTrailingOverlapLength(existingContent, incomingContent);
  if (overlap === 0) return incomingContent;

  const minOverlap = hasStructuredChunkShape(incomingContent)
    ? MIN_RECONNECT_STRUCTURED_OVERLAP_CHARS
    : MIN_RECONNECT_OVERLAP_CHARS;

  if (overlap < minOverlap) return incomingContent;
  return incomingContent.slice(overlap);
};

const isAssistantMessageTypeMatch = (
  message: PlanningMessage,
  messageType: "stream" | "thinking",
): boolean => {
  if (message.role !== "assistant") return false;
  if (messageType === "stream") {
    return message.messageType === null || message.messageType === "stream";
  }
  return message.messageType === "thinking";
};

export const getReplayDedupBaselineFromMessages = (
  messages: PlanningMessage[],
  messageType: "stream" | "thinking",
): string => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isAssistantMessageTypeMatch(message, messageType)) continue;
    if (!message.content) continue;
    return message.content;
  }

  return "";
};

const parseMessageTimestamp = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
};

const areLikelySameUserMessage = (
  left: PlanningMessage,
  right: PlanningMessage,
): boolean => {
  if (left.role !== "user" || right.role !== "user") return false;
  if (left.id === right.id) return true;
  if (left.content.trim() !== right.content.trim()) return false;

  const leftTimestamp = parseMessageTimestamp(left.createdAt);
  const rightTimestamp = parseMessageTimestamp(right.createdAt);

  if (leftTimestamp === null || rightTimestamp === null) {
    return left.createdAt === right.createdAt;
  }

  return (
    Math.abs(leftTimestamp - rightTimestamp) <=
    HYDRATION_USER_MESSAGE_MATCH_WINDOW_MS
  );
};

const hasMatchingUserMessage = (
  messages: PlanningMessage[],
  candidate: PlanningMessage | null | undefined,
): boolean => {
  if (!candidate || candidate.role !== "user") return false;

  return messages.some((message) => areLikelySameUserMessage(message, candidate));
};

const isHydrationPreservedAssistantMessage = (
  message: PlanningMessage,
): boolean => {
  if (message.role !== "assistant") return false;
  if ((message.metadata as Record<string, unknown> | undefined)?.fromLiveStreamingTurn !== true) {
    return false;
  }

  return (
    message.messageType === null ||
    message.messageType === "stream" ||
    message.messageType === "thinking"
  );
};

const areLikelySameAssistantMessage = (
  left: PlanningMessage,
  right: PlanningMessage,
): boolean => {
  if (left.role !== "assistant" || right.role !== "assistant") return false;
  if (left.id === right.id) return true;

  const leftType = left.messageType ?? "stream";
  const rightType = right.messageType ?? "stream";
  if (leftType !== rightType) return false;

  return left.content.trim() === right.content.trim();
};

const hasMatchingAssistantMessage = (
  messages: PlanningMessage[],
  candidate: PlanningMessage | null | undefined,
): boolean => {
  if (!candidate || !isHydrationPreservedAssistantMessage(candidate)) return false;

  return messages.some((message) =>
    areLikelySameAssistantMessage(message, candidate)
  );
};

const filterMessagesForSession = (
  messages: PlanningMessage[],
  sessionId: string,
): PlanningMessage[] =>
  messages.filter((message) => message.sessionId === sessionId);

const getPendingUserMessageForSession = (
  pendingUserMessage: PlanningMessage | null,
  sessionId: string,
): PlanningMessage | null =>
  pendingUserMessage?.sessionId === sessionId ? pendingUserMessage : null;

const mergeHydratedMessagesWithLocalMessages = (
  hydratedMessages: PlanningMessage[],
  localMessages: PlanningMessage[],
): PlanningMessage[] => {
  const merged = [...hydratedMessages];

  for (const localMessage of localMessages) {
    if (localMessage.role === "user") {
      if (hasMatchingUserMessage(merged, localMessage)) continue;
      merged.push(localMessage);
      continue;
    }

    if (!isHydrationPreservedAssistantMessage(localMessage)) continue;
    if (hasMatchingAssistantMessage(merged, localMessage)) continue;
    merged.push(localMessage);
  }

  return merged;
};

const hasHistoricalUserPrompt = (messages: PlanningMessage[]): boolean =>
  messages.some((message) => message.role === "user");


// --- Humanize tool activity for streaming indicator ---

const humanizeToolActivity = (toolName: string, inputPreview?: string): string => {
  // Skip Agent/Task tools — they show as subagent blocks
  if (toolName === "Agent" || toolName === "Task") return "";

  const TOOL_LABELS: Record<string, string> = {
    Read: "Reading",
    Write: "Writing",
    Edit: "Editing",
    Glob: "Searching files",
    Grep: "Searching code",
    Bash: "Running command",
    Skill: "Loading skill",
    ToolSearch: "Searching tool",
    AskUserQuestion: "",
    WebSearch: "Searching web",
    WebFetch: "Fetching web",
    NotebookEdit: "Editing notebook",
    LSP: "Analyzing code",
  };

  // MCP tool labels
  const getMcpLabel = (name: string): string => {
    if (name.includes("almirant")) return "Querying Almirant";
    if (name.includes("context7")) return "Querying docs";
    if (name.includes("playwright")) return "Interacting with browser";
    if (name.includes("serena")) return "Analyzing code";
    if (name.includes("memory")) return "Accessing memory";
    if (name.includes("filesystem")) return "Accessing files";
    if (name.includes("DeepGraph")) return "Analyzing dependencies";
    return "Using tool";
  };

  const label = TOOL_LABELS[toolName] ?? getMcpLabel(toolName);
  if (!inputPreview) return label;

  // Extract meaningful detail from the preview
  let detail = inputPreview;

  // If it looks like JSON, try to parse and extract useful fields
  if (detail.startsWith("{")) {
    try {
      const parsed = JSON.parse(detail) as Record<string, unknown>;
      // Handle tool_use envelope: { name, id, input: { ... } }
      const input = (parsed.input && typeof parsed.input === "object")
        ? parsed.input as Record<string, unknown>
        : parsed;
      // Extract the most useful field
      detail =
        (typeof input.file_path === "string" && input.file_path) ||
        (typeof input.pattern === "string" && input.pattern) ||
        (typeof input.command === "string" && input.command) ||
        (typeof input.query === "string" && input.query) ||
        (typeof input.description === "string" && input.description) ||
        (typeof input.skill === "string" && input.skill) ||
        (typeof input.url === "string" && input.url) ||
        "";
    } catch {
      // Truncated JSON — try regex extraction
      const pathMatch = detail.match(/"file_path"\s*:\s*"([^"]+)"/);
      const patternMatch = detail.match(/"pattern"\s*:\s*"([^"]+)"/);
      const commandMatch = detail.match(/"command"\s*:\s*"([^"]+)"/);
      const queryMatch = detail.match(/"query"\s*:\s*"([^"]+)"/);
      const skillMatch = detail.match(/"skill"\s*:\s*"([^"]+)"/);
      detail = pathMatch?.[1] ?? patternMatch?.[1] ?? commandMatch?.[1] ?? queryMatch?.[1] ?? skillMatch?.[1] ?? "";
    }
  }

  if (!detail) return label;

  // Clean paths
  detail = detail.replace(/\/workspace\/repo\//g, "");
  // For "key: value" format, extract value
  const colonIdx = detail.indexOf(": ");
  if (colonIdx > 0 && colonIdx < 20) {
    detail = detail.slice(colonIdx + 2);
  }
  // Truncate
  if (detail.length > 60) detail = detail.slice(0, 60) + "...";

  return `${label} ${detail}`;
};

// --- Graduate streaming blocks to messages ---
// Converts the chronological streaming blocks into PlanningMessage entries
// so they appear inline in the messages array (preserving timeline order).

/** @internal Exported for testing only */
export const graduateBlocksToMessages = (
  blocks: StreamingBlock[],
  sessionId: string,
): PlanningMessage[] => {
  const msgs: PlanningMessage[] = [];
  let ts = Date.now();

  const liveStreamingMetadata = {
    fromLiveStreamingTurn: true,
  } as const;

  for (const block of blocks) {
    ts += 1;
    const createdAt = new Date(ts).toISOString();
    const uid = `grad-${ts}-${Math.random().toString(36).slice(2, 7)}`;

    switch (block.type) {
      case "thinking":
        msgs.push({ id: uid, sessionId, role: "assistant", content: block.content, messageType: "thinking", inputTokens: null, outputTokens: null, metadata: liveStreamingMetadata, createdAt });
        break;
      case "text":
      case "info": {
        const cleanedContent = stripLegacyPlanningControlTokens(block.content);
        if (!cleanedContent.trim()) break;
        msgs.push({ id: uid, sessionId, role: "assistant", content: cleanedContent, messageType: "stream", inputTokens: null, outputTokens: null, metadata: liveStreamingMetadata, createdAt });
        break;
      }
      case "tool_call":
        msgs.push({ id: uid, sessionId, role: "assistant", content: "", messageType: "tool_call", inputTokens: null, outputTokens: null, metadata: { ...liveStreamingMetadata, toolName: block.toolName, toolCallId: block.toolCallId, inputPreview: block.inputPreview, filePath: block.filePath, command: block.command, description: block.description }, createdAt });
        break;
      case "subagent":
        msgs.push({ id: uid, sessionId, role: "assistant", content: "", messageType: "subagent", inputTokens: null, outputTokens: null, metadata: { ...liveStreamingMetadata, subagentId: block.subagentId, description: block.description, isBackground: block.isBackground, subagentType: block.subagentType }, createdAt });
        break;
      case "file_read":
        msgs.push({ id: uid, sessionId, role: "assistant", content: "", messageType: "tool_call", inputTokens: null, outputTokens: null, metadata: { ...liveStreamingMetadata, toolName: "Read", toolCallId: uid, inputPreview: block.filePath }, createdAt });
        break;
      case "file_change":
        msgs.push({ id: uid, sessionId, role: "assistant", content: "", messageType: "tool_call", inputTokens: null, outputTokens: null, metadata: { ...liveStreamingMetadata, toolName: block.operation === "write" ? "Write" : "Edit", toolCallId: uid, inputPreview: block.filePath }, createdAt });
        break;
      case "bash":
        msgs.push({ id: uid, sessionId, role: "assistant", content: "", messageType: "tool_call", inputTokens: null, outputTokens: null, metadata: { ...liveStreamingMetadata, toolName: "Bash", toolCallId: uid, inputPreview: block.command }, createdAt });
        break;
    }
  }

  return msgs;
};

const stripDeferredQuestionFromStreamingBlocks = (
  blocks: StreamingBlock[],
  questionText: string,
): StreamingBlock[] => {
  const trimmedQuestion = questionText.trim();
  if (!trimmedQuestion) return blocks;

  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block.type !== "text") continue;

    const trimmedContent = block.content.trimEnd();
    if (!trimmedContent) break;

    if (trimmedContent === trimmedQuestion) {
      return [...blocks.slice(0, index), ...blocks.slice(index + 1)];
    }

    if (trimmedContent.endsWith(trimmedQuestion)) {
      const preservedContent = trimmedContent
        .slice(0, trimmedContent.length - trimmedQuestion.length)
        .replace(/\s+$/, "");

      if (!preservedContent) {
        return [...blocks.slice(0, index), ...blocks.slice(index + 1)];
      }

      return [
        ...blocks.slice(0, index),
        { ...block, content: preservedContent },
        ...blocks.slice(index + 1),
      ];
    }

    break;
  }

  return blocks;
};

// --- Sequence dedup guard ---

type SequenceGateResult =
  | { accepted: false }
  | {
      accepted: true;
      lastSeenSequenceNum: number;
      activeStreamJobId: string | null;
    };

/**
 * Decides whether a sequenced streaming event should be applied.
 *
 * The web-bridge numbers sequences PER JOB, so a new job legitimately restarts
 * at 0 while START_STREAMING resets the turn-local high-water mark. To keep
 * both semantics safe the protection is scoped by job boundary:
 * - same job as the active run → monotonic sequenceNum check;
 * - job that was active before the turn boundary → retransmissions at or
 *   below the mark recorded at START_STREAMING are dropped; higher numbers
 *   mean the same job keeps streaming into the new turn and are adopted;
 * - unknown job → new run, adopted from any sequenceNum (per-job restart);
 * - no jobId or no sequenceNum → legacy behavior (turn-local check only).
 */
const gateSequencedStreamEvent = (
  state: PlanningSessionState,
  sequenceNum: number | undefined,
  jobId: string | undefined,
): SequenceGateResult => {
  // No sequenceNum (backward compat): always accepted, nothing advances.
  if (sequenceNum === undefined || sequenceNum === null) {
    return {
      accepted: true,
      lastSeenSequenceNum: state.lastSeenSequenceNum,
      activeStreamJobId: state.activeStreamJobId,
    };
  }

  // No jobId (legacy web-bridge payloads): turn-local high-water mark check.
  if (!jobId) {
    if (sequenceNum <= state.lastSeenSequenceNum) return { accepted: false };
    return {
      accepted: true,
      lastSeenSequenceNum: sequenceNum,
      activeStreamJobId: state.activeStreamJobId,
    };
  }

  if (jobId === state.activeStreamJobId) {
    if (sequenceNum <= state.lastSeenSequenceNum) return { accepted: false };
    return {
      accepted: true,
      lastSeenSequenceNum: sequenceNum,
      activeStreamJobId: jobId,
    };
  }

  if (jobId === state.staleStreamJobId) {
    // Retransmission of the run that was active before the turn boundary.
    if (sequenceNum <= state.staleStreamSequenceNum) return { accepted: false };
    // The old run only continues into the new turn while no other job took over.
    if (state.activeStreamJobId !== null) return { accepted: false };
    return {
      accepted: true,
      lastSeenSequenceNum: sequenceNum,
      activeStreamJobId: jobId,
    };
  }

  // New job: per-job numbering legitimately restarts at 0 → adopt it.
  return {
    accepted: true,
    lastSeenSequenceNum: sequenceNum,
    activeStreamJobId: jobId,
  };
};

// --- Reducer ---

/** @internal Exported for testing only */
export const planningReducer = (
  state: PlanningSessionState,
  action: PlanningAction
): PlanningSessionState => {
  switch (action.type) {
    case "SET_SESSION":
      return {
        ...state,
        phase: "idle",
        sessionId: action.session.id,
        session: action.session,
        error: null,
      };

    case "START_STREAMING": {
      if (!canTransition(state.phase, "booting")) {
        return state;
      }
      // Graduate previous turn's persistent blocks before clearing.
      // "thinking" is included: when RECEIVE_RESPONSE_COMPLETE never arrived
      // (e.g. lost over a WS drop) the thinking blocks were not graduated to
      // messages yet, and dropping them here would erase them from the timeline.
      const persistentTypes = new Set(["thinking", "text", "tool_call", "subagent", "file_read", "file_change", "bash"]);
      const prevPersistent = state.streamingBlocks.filter((b) => persistentTypes.has(b.type));
      const nextCompleted = prevPersistent.length > 0
        ? [...state.completedTurnBlocks, prevPersistent]
        : state.completedTurnBlocks;

      // Promote pendingUserMessage into the timeline now that the agent is starting a new turn
      const nextMessages = state.pendingUserMessage
        ? [...state.messages, { ...state.pendingUserMessage, deliveryStatus: "delivered" as const }]
        : state.messages;

      return {
        ...state,
        phase: "booting",
        messages: nextMessages,
        pendingUserMessage: null,
        streamingContent: "",
        streamingThinkingContent: "",
        streamingBlocks: [],
        completedTurnBlocks: nextCompleted,
        currentStep: null,
        pendingQuestion: null,
        deferredQuestion: null,
        generatedItems: [],
        waveInfo: null,
        error: null,
        tokenUsage: { input: 0, output: 0 },
        pendingFollowUp: false,
        followUpPrompt: null,
        processingStartedAt: Date.now(),
        // The reset stays (a new job restarts numbering at 0), but the previous
        // run's job + high-water mark are recorded so its retransmissions can
        // still be detected after the boundary (see gateSequencedStreamEvent).
        lastSeenSequenceNum: -1,
        activeStreamJobId: null,
        staleStreamJobId: state.activeStreamJobId ?? state.staleStreamJobId,
        staleStreamSequenceNum:
          state.activeStreamJobId !== null
            ? state.lastSeenSequenceNum
            : state.staleStreamSequenceNum,
      };
    }

    case "RECEIVE_TEXT": {
      // Ignore streaming data after cancel or pause
      if (state.phase === "idle" || state.phase === "paused") return state;
      // Drop duplicate or out-of-order events based on jobId + sequenceNum
      const gateText = gateSequencedStreamEvent(state, action.sequenceNum, action.jobId);
      if (!gateText.accepted) return state;
      const nextSeqText = gateText.lastSeenSequenceNum;
      const nextStreamingContent = stripLegacyPlanningControlTokens(
        state.streamingContent + action.content,
      );
      const didVisibleContentChange =
        nextStreamingContent !== state.streamingContent;
      // Mark all pending user messages as delivered now that the assistant is responding
      const deliveredMsgsText = state.messages.map(m =>
        m.role === "user" && m.deliveryStatus && m.deliveryStatus !== "delivered"
          ? { ...m, deliveryStatus: "delivered" as const }
          : m
      );
      const lastBlock = state.streamingBlocks[state.streamingBlocks.length - 1];
      const updatedTextBlocks =
        lastBlock?.type === "text"
          ? (() => {
              const mergedContent = stripLegacyPlanningControlTokens(
                lastBlock.content + action.content,
              );
              return mergedContent
                ? [
                    ...state.streamingBlocks.slice(0, -1),
                    { type: "text" as const, content: mergedContent },
                  ]
                : state.streamingBlocks.slice(0, -1);
            })()
          : (() => {
              const cleanedChunk = stripLegacyPlanningControlTokens(action.content);
              return cleanedChunk
                ? [
                    ...state.streamingBlocks,
                    { type: "text" as const, content: cleanedChunk },
                  ]
                : state.streamingBlocks;
            })();

      if (!didVisibleContentChange && updatedTextBlocks === state.streamingBlocks) {
        return {
          ...state,
          messages: deliveredMsgsText,
          lastSeenSequenceNum: nextSeqText,
          activeStreamJobId: gateText.activeStreamJobId,
        };
      }
      // On first text chunk during resuming, transition to streaming and clear resumeStep
      if (state.phase === "resuming") {
        return {
          ...state,
          messages: deliveredMsgsText,
          phase: "streaming" as PlanningPhase,
          resumeStep: null,
          streamingContent: nextStreamingContent,
          streamingBlocks: updatedTextBlocks,
          lastSeenSequenceNum: nextSeqText,
          activeStreamJobId: gateText.activeStreamJobId,
        };
      }
      // On first text chunk during booting/thinking/chatting, transition to streaming.
      // "chatting" is included because after RECEIVE_RESPONSE_COMPLETE the phase
      // resets to "chatting", but the agent may keep streaming text in the same
      // logical turn (e.g. after answering a question wizard).
      //
      // GUARD: only allow the "chatting" → "streaming" transition when there is
      // local evidence of a turn actually in progress (a pending user message,
      // a processing timestamp, or existing streaming blocks). Otherwise the
      // backend replay of buffered planning events after a WS reconnect (e.g.
      // when the user returns to the tab) would flip the UI into "Processing..."
      // even though the user never sent a prompt. In that case we drop the
      // replayed chunk so it does not pollute streamingBlocks either.
      const hasActiveTurnEvidence =
        state.pendingUserMessage !== null ||
        state.processingStartedAt !== null ||
        state.streamingBlocks.length > 0;
      if (state.phase === "chatting" && !hasActiveTurnEvidence) {
        return {
          ...state,
          messages: deliveredMsgsText,
          lastSeenSequenceNum: nextSeqText,
          activeStreamJobId: gateText.activeStreamJobId,
        };
      }
      const nextPhase =
        (state.phase === "booting" || state.phase === "thinking" || state.phase === "chatting") &&
        canTransition(state.phase, "streaming")
          ? "streaming"
          : state.phase;
      return {
        ...state,
        messages: deliveredMsgsText,
        phase: nextPhase,
        streamingContent: nextStreamingContent,
        streamingBlocks: updatedTextBlocks,
        lastSeenSequenceNum: nextSeqText,
        activeStreamJobId: gateText.activeStreamJobId,
      };
    }

    case "RECEIVE_THINKING": {
      // Ignore streaming data after cancel or pause
      if (state.phase === "idle" || state.phase === "paused") return state;
      // Drop duplicate or out-of-order events based on jobId + sequenceNum
      const gateThinking = gateSequencedStreamEvent(state, action.sequenceNum, action.jobId);
      if (!gateThinking.accepted) return state;
      const nextSeqThinking = gateThinking.lastSeenSequenceNum;
      // On first thinking chunk during resuming, transition to thinking and clear resumeStep
      if (state.phase === "resuming") {
        return {
          ...state,
          phase: "thinking" as PlanningPhase,
          resumeStep: null,
          streamingThinkingContent: state.streamingThinkingContent + action.content,
          streamingBlocks: [...state.streamingBlocks, { type: "thinking" as const, content: action.content }],
          lastSeenSequenceNum: nextSeqThinking,
          activeStreamJobId: gateThinking.activeStreamJobId,
        };
      }
      // On first thinking chunk during booting/streaming/chatting, transition to thinking.
      // "chatting" is included because after RECEIVE_RESPONSE_COMPLETE the phase
      // resets to "chatting", but the agent may keep streaming in the same
      // logical turn (e.g. after answering a question wizard).
      //
      // GUARD (same rationale as RECEIVE_TEXT): only promote "chatting" → "thinking"
      // if there is local evidence of a turn in progress; otherwise a WS
      // reconnect replay would incorrectly display the thinking/Processing
      // indicator for a user who never sent a prompt. In that case we drop the
      // replayed thinking chunk entirely.
      const hasActiveTurnEvidenceThinking =
        state.pendingUserMessage !== null ||
        state.processingStartedAt !== null ||
        state.streamingBlocks.length > 0;
      if (state.phase === "chatting" && !hasActiveTurnEvidenceThinking) {
        return {
          ...state,
          lastSeenSequenceNum: nextSeqThinking,
          activeStreamJobId: gateThinking.activeStreamJobId,
        };
      }
      const nextPhase =
        (state.phase === "booting" || state.phase === "streaming" || state.phase === "chatting") &&
        canTransition(state.phase, "thinking")
          ? "thinking"
          : state.phase;
      // Append to last block if same type, otherwise create new block
      const lastThinkBlock = state.streamingBlocks[state.streamingBlocks.length - 1];
      const updatedThinkBlocks =
        lastThinkBlock?.type === "thinking"
          ? [
              ...state.streamingBlocks.slice(0, -1),
              { type: "thinking" as const, content: lastThinkBlock.content + action.content },
            ]
          : [...state.streamingBlocks, { type: "thinking" as const, content: action.content }];
      return {
        ...state,
        phase: nextPhase,
        streamingThinkingContent:
          state.streamingThinkingContent + action.content,
        streamingBlocks: updatedThinkBlocks,
        lastSeenSequenceNum: nextSeqThinking,
        activeStreamJobId: gateThinking.activeStreamJobId,
      };
    }

    case "RECEIVE_TOOL_CALL_START": {
      // Ignore tool events during pause
      if (state.phase === "paused") return state;
      // Drop duplicate or out-of-order events based on jobId + sequenceNum
      const gateToolStart = gateSequencedStreamEvent(state, action.sequenceNum, action.jobId);
      if (!gateToolStart.accepted) return state;
      // AskUserQuestion: skip during streaming — the QuestionWizard handles it.
      // It will appear in DB history via loadMessagesFromLogs.
      if (action.toolName === "AskUserQuestion") return state;
      const nextSeqToolStart = gateToolStart.lastSeenSequenceNum;

      // Recover streaming phase if we're in chatting — a tool call is strong
      // evidence the agent is actively working (e.g. after question answer when
      // RECEIVE_RESPONSE_COMPLETE already reset phase to chatting).
      const toolPhase =
        state.phase === "chatting" && canTransition(state.phase, "streaming")
          ? "streaming"
          : state.phase;

      // Agent/Task tool calls: pre-create subagent block with the correct name
      // so it appears immediately instead of showing "Agent" then updating.
      if (action.toolName === "Agent" || action.toolName === "Task") {
        const preview = action.inputPreview ?? "";
        // Extract subagent_type and description from inputPreview
        const typeMatch = preview.match(/subagent_type[":.\s]+([a-zA-Z_-]+)/);
        const descMatch = preview.match(/description[":.\s]+([^"}\n]+)/);
        const subagentType = typeMatch?.[1];
        const description = descMatch?.[1]?.trim() ?? "";

        if (subagentType) {
          // Pre-create subagent block — the real RECEIVE_SUBAGENT_SPAWN will update it
          const existingSubagent = state.streamingBlocks.find(
            (b) => b.type === "subagent" && b.subagentId === action.toolCallId,
          );
          if (!existingSubagent) {
            return {
              ...state,
              phase: toolPhase,
              latestActivity: `Agente: ${description || subagentType}`,
              lastSeenSequenceNum: nextSeqToolStart,
              activeStreamJobId: gateToolStart.activeStreamJobId,
              streamingBlocks: [
                ...state.streamingBlocks,
                {
                  type: "subagent" as const,
                  subagentId: action.toolCallId,
                  description: description || subagentType,
                  isBackground: false,
                  status: "running" as const,
                  subagentType,
                },
              ],
            };
          }
        }
        // If we can't extract subagent info, skip — the spawn event will handle it
        return { ...state, phase: toolPhase, lastSeenSequenceNum: nextSeqToolStart, activeStreamJobId: gateToolStart.activeStreamJobId };
      }

      // Regular tool call: if block exists, update its inputPreview (enriched data)
      const existingIdx = state.streamingBlocks.findIndex(
        (b) => b.type === "tool_call" && b.toolCallId === action.toolCallId,
      );
      const activity = humanizeToolActivity(action.toolName, action.inputPreview);
      if (existingIdx >= 0) {
        return {
          ...state,
          phase: toolPhase,
          latestActivity: activity || state.latestActivity,
          lastSeenSequenceNum: nextSeqToolStart,
          activeStreamJobId: gateToolStart.activeStreamJobId,
          streamingBlocks: state.streamingBlocks.map((block, i) =>
            i === existingIdx && block.type === "tool_call"
              ? { ...block, inputPreview: action.inputPreview ?? block.inputPreview }
              : block,
          ),
        };
      }
      return {
        ...state,
        phase: toolPhase,
        latestActivity: activity || state.latestActivity,
        lastSeenSequenceNum: nextSeqToolStart,
        activeStreamJobId: gateToolStart.activeStreamJobId,
        streamingBlocks: [
          ...state.streamingBlocks,
          {
            type: "tool_call" as const,
            toolName: action.toolName,
            toolCallId: action.toolCallId,
            status: "pending" as const,
            inputPreview: action.inputPreview,
          },
        ],
      };
    }

    case "RECEIVE_TOOL_CALL_RESULT": {
      if (state.phase === "paused") return state;
      const gateToolResult = gateSequencedStreamEvent(state, action.sequenceNum, action.jobId);
      if (!gateToolResult.accepted) return state;
      return {
        ...state,
        lastSeenSequenceNum: gateToolResult.lastSeenSequenceNum,
        activeStreamJobId: gateToolResult.activeStreamJobId,
        streamingBlocks: state.streamingBlocks.map((block) =>
          block.type === "tool_call" && block.toolCallId === action.toolCallId
            ? { ...block, status: action.success ? ("success" as const) : ("error" as const) }
            : block,
        ),
      };
    }

    case "RECEIVE_FILE_READ": {
      if (state.phase === "paused") return state;
      const gateFileRead = gateSequencedStreamEvent(state, action.sequenceNum, action.jobId);
      if (!gateFileRead.accepted) return state;
      const nextSeqFileRead = gateFileRead.lastSeenSequenceNum;
      // Enrich the last pending tool_call block with file info (avoids duplicate blocks)
      const lastReadTool = [...state.streamingBlocks].reverse().find(
        (b) => b.type === "tool_call" && b.status === "pending"
      );
      // Shorten file path for activity display
      const shortFilePath = action.filePath.replace(/\/workspace\/repo\//g, "");
      const fileActivity = `Reading ${shortFilePath.length > 60 ? shortFilePath.slice(0, 60) + "..." : shortFilePath}`;
      if (lastReadTool && lastReadTool.type === "tool_call") {
        return {
          ...state,
          latestActivity: fileActivity,
          lastSeenSequenceNum: nextSeqFileRead,
          activeStreamJobId: gateFileRead.activeStreamJobId,
          streamingBlocks: state.streamingBlocks.map((block) =>
            block === lastReadTool
              ? { ...block, filePath: action.filePath, lineRange: action.lineRange }
              : block,
          ),
        };
      }
      return {
        ...state,
        latestActivity: fileActivity,
        lastSeenSequenceNum: nextSeqFileRead,
        activeStreamJobId: gateFileRead.activeStreamJobId,
        streamingBlocks: [...state.streamingBlocks, { type: "file_read" as const, filePath: action.filePath, lineRange: action.lineRange }],
      };
    }

    case "RECEIVE_FILE_CHANGE": {
      if (state.phase === "paused") return state;
      const gateFileChange = gateSequencedStreamEvent(state, action.sequenceNum, action.jobId);
      if (!gateFileChange.accepted) return state;
      const nextSeqFileChange = gateFileChange.lastSeenSequenceNum;
      const lastChangeTool = [...state.streamingBlocks].reverse().find(
        (b) => b.type === "tool_call" && b.status === "pending"
      );
      if (lastChangeTool && lastChangeTool.type === "tool_call") {
        return {
          ...state,
          lastSeenSequenceNum: nextSeqFileChange,
          activeStreamJobId: gateFileChange.activeStreamJobId,
          streamingBlocks: state.streamingBlocks.map((block) =>
            block === lastChangeTool
              ? { ...block, filePath: action.filePath }
              : block,
          ),
        };
      }
      return {
        ...state,
        lastSeenSequenceNum: nextSeqFileChange,
        activeStreamJobId: gateFileChange.activeStreamJobId,
        streamingBlocks: [...state.streamingBlocks, { type: "file_change" as const, filePath: action.filePath, operation: action.operation }],
      };
    }

    case "RECEIVE_BASH_EXECUTE": {
      if (state.phase === "paused") return state;
      const gateBash = gateSequencedStreamEvent(state, action.sequenceNum, action.jobId);
      if (!gateBash.accepted) return state;
      const nextSeqBash = gateBash.lastSeenSequenceNum;
      const lastBashTool = [...state.streamingBlocks].reverse().find(
        (b) => b.type === "tool_call" && b.status === "pending"
      );
      // Shorten command for activity display
      const shortCommand = action.command.length > 50 ? action.command.slice(0, 50) + "..." : action.command;
      const bashActivity = `Running ${shortCommand}`;
      if (lastBashTool && lastBashTool.type === "tool_call") {
        return {
          ...state,
          latestActivity: bashActivity,
          lastSeenSequenceNum: nextSeqBash,
          activeStreamJobId: gateBash.activeStreamJobId,
          streamingBlocks: state.streamingBlocks.map((block) =>
            block === lastBashTool
              ? { ...block, command: action.command, description: action.description }
              : block,
          ),
        };
      }
      return {
        ...state,
        latestActivity: bashActivity,
        lastSeenSequenceNum: nextSeqBash,
        activeStreamJobId: gateBash.activeStreamJobId,
        streamingBlocks: [...state.streamingBlocks, { type: "bash" as const, command: action.command, description: action.description }],
      };
    }

    case "RECEIVE_SUBAGENT_SPAWN": {
      if (state.phase === "paused") return state;
      const gateSpawn = gateSequencedStreamEvent(state, action.sequenceNum, action.jobId);
      if (!gateSpawn.accepted) return state;
      const nextSeqSpawn = gateSpawn.lastSeenSequenceNum;
      // Update existing block if already spawned (early spawn → full data arrives later)
      const existingSpawnIdx = state.streamingBlocks.findIndex(
        (b) => b.type === "subagent" && b.subagentId === action.subagentId,
      );
      // Shorten description for activity display
      const shortDesc = action.description.length > 50 ? action.description.slice(0, 50) + "..." : action.description;
      const subagentActivity = `Agente: ${shortDesc}`;
      if (existingSpawnIdx >= 0) {
        return {
          ...state,
          latestActivity: subagentActivity,
          lastSeenSequenceNum: nextSeqSpawn,
          activeStreamJobId: gateSpawn.activeStreamJobId,
          streamingBlocks: state.streamingBlocks.map((block, i) =>
            i === existingSpawnIdx && block.type === "subagent"
              ? {
                  ...block,
                  description: action.description || block.description,
                  subagentType: action.subagentType || block.subagentType,
                }
              : block,
          ),
        };
      }
      return {
        ...state,
        latestActivity: subagentActivity,
        lastSeenSequenceNum: nextSeqSpawn,
        activeStreamJobId: gateSpawn.activeStreamJobId,
        streamingBlocks: [
          ...state.streamingBlocks,
          {
            type: "subagent" as const,
            subagentId: action.subagentId,
            description: action.description,
            isBackground: action.isBackground,
            status: "running" as const,
            subagentType: action.subagentType,
          },
        ],
      };
    }

    case "RECEIVE_SUBAGENT_COMPLETE": {
      if (state.phase === "paused") return state;
      const gateSubagentComplete = gateSequencedStreamEvent(state, action.sequenceNum, action.jobId);
      if (!gateSubagentComplete.accepted) return state;
      return {
        ...state,
        lastSeenSequenceNum: gateSubagentComplete.lastSeenSequenceNum,
        activeStreamJobId: gateSubagentComplete.activeStreamJobId,
        streamingBlocks: state.streamingBlocks.map((block) =>
          block.type === "subagent" && block.subagentId === action.subagentId
            ? { ...block, status: "done" as const }
            : block,
        ),
      };
    }

    case "RECEIVE_TOKEN_USAGE":
      return {
        ...state,
        tokenUsage: {
          input: action.totalInput ?? (state.tokenUsage.input + action.inputTokens),
          output: action.totalOutput ?? (state.tokenUsage.output + action.outputTokens),
          model: action.model ?? state.tokenUsage.model,
        },
      };

    case "RECEIVE_STEP": {
      const gateStep = gateSequencedStreamEvent(state, action.sequenceNum, action.jobId);
      if (!gateStep.accepted) return state;
      return {
        ...state,
        currentStep: { name: action.stepName, index: action.stepIndex },
        lastSeenSequenceNum: gateStep.lastSeenSequenceNum,
        activeStreamJobId: gateStep.activeStreamJobId,
      };
    }

    case "RECEIVE_QUESTION": {
      const incomingQuestionSignature = buildQuestionSignature({
        questionText: action.questionText,
        questions: action.questions,
      });
      if (
        state.answeredQuestionIds.includes(action.questionId) ||
        state.answeredQuestionSignatures.includes(incomingQuestionSignature ?? "") ||
        state.pendingQuestion?.questionId === action.questionId ||
        state.deferredQuestion?.questionId === action.questionId
      ) {
        return state;
      }

      // Buffer the question — don't show the wizard yet.
      // The agent may still be streaming text/blocks that should appear before
      // the wizard. The deferred question will be flushed when
      // RECEIVE_RESPONSE_COMPLETE arrives (from the synthetic session.idle
      // that the claude-adapter emits right after question.asked).
      return {
        ...state,
        // Don't set expiresAt here — wait until the deferred question is
        // flushed in RECEIVE_RESPONSE_COMPLETE so the countdown timer
        // doesn't start before the wizard is visible.
        deferredQuestion: {
          questionId: action.questionId,
          questionText: action.questionText,
          options: action.options,
          ...(action.questions ? { questions: action.questions } : {}),
          questionType: action.questionType,
          expiresAt: action.expiresAt ?? null,
          source: action.source,
        },
      };
    }

    case "ADD_USER_MESSAGE": {
      const userMsg: PlanningMessage = {
        id: `user-${Date.now()}`,
        sessionId: state.sessionId ?? "",
        role: "user",
        content: action.content,
        messageType: null,
        inputTokens: null,
        outputTokens: null,
        metadata: action.seeds ? { seeds: action.seeds } : {},
        createdAt: new Date().toISOString(),
        deliveryStatus: action.queued ? "sending" : "delivered",
      };
      if (action.queued) {
        // Store as pending — shown below Processing indicator with "queued" style.
        // Promoted into timeline when agent starts new turn (START_STREAMING).
        return { ...state, pendingUserMessage: userMsg };
      }
      // Direct add to timeline (not streaming — message processes immediately)
      return { ...state, messages: [...state.messages, userMsg] };
    }

    case "PROMPT_ACK": {
      const msgs = [...state.messages];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === "user" && msgs[i].deliveryStatus === "sending") {
          msgs[i] = { ...msgs[i], deliveryStatus: action.status };
          break;
        }
      }
      return { ...state, messages: msgs };
    }

    case "MESSAGE_DEQUEUED": {
      // Find the pending user message and promote it to timeline as "processing"
      if (state.pendingUserMessage) {
        return {
          ...state,
          messages: [...state.messages, { ...state.pendingUserMessage, deliveryStatus: "processing" as const }],
          pendingUserMessage: null,
        };
      }
      // Also check messages array for any with "queued" status
      const dqMsgs = state.messages.map(m =>
        m.role === "user" && m.deliveryStatus === "queued"
          ? { ...m, deliveryStatus: "processing" as const }
          : m
      );
      return { ...state, messages: dqMsgs };
    }

    case "ANSWER_QUESTION": {
      // Graduate ALL streaming blocks (including completed turns) to messages
      // in chronological order. This preserves the exact timeline:
      // thinking → text → tool_call → subagent → text → question → answer
      const graduatedMessages = [...state.messages];
      const sid = state.sessionId ?? "";

      // 1. Convert completed turn blocks to inline messages first (earlier turns)
      for (const turnBlocks of state.completedTurnBlocks) {
        graduatedMessages.push(...graduateBlocksToMessages(turnBlocks, sid));
      }

      // 2. Convert current streaming blocks to inline messages
      const blockMsgs = graduateBlocksToMessages(state.streamingBlocks, sid);
      graduatedMessages.push(...blockMsgs);

      const answeredQuestionSignature = buildQuestionSignature(
        state.pendingQuestion ?? state.deferredQuestion,
      );
      // 2. Add user's answer as the last message (always provided)
      // No synthetic system question message needed — the user answer already contains
      // "Q → A" lines that chat-message.tsx renders as a styled questionnaire card.
      graduatedMessages.push({
        id: `user-${Date.now()}`,
        sessionId: sid,
        role: "user",
        content: action.answer,
        messageType: null,
        inputTokens: null,
        outputTokens: null,
        metadata: {},
        createdAt: new Date().toISOString(),
      });

      // Handover del turno al agente: intentar entrar en "streaming" desde cualquier
      // phase compatible (waiting_for_answer, chatting, thinking, paused, ...).
      // Restringir sólo a waiting_for_answer dejaba la phase intacta cuando el
      // cuestionario se respondía con la sesión en chatting/thinking/paused, por
      // lo que isStreaming quedaba en false y el StreamingActivityIndicator no
      // aparecía al entregar el turno.
      const answerPhase = canTransition(state.phase, "streaming")
        ? "streaming"
        : state.phase;
      return {
        ...state,
        phase: answerPhase,
        messages: graduatedMessages,
        pendingQuestion: null,
        deferredQuestion: null,
        expiresAt: null,
        streamingContent: "",
        streamingThinkingContent: "",
        streamingBlocks: [],
        // Clear completedTurnBlocks — they've been graduated to inline messages above
        completedTurnBlocks: [],
        // Reset del temporizador del indicador de actividad para el nuevo turno
        // del agente: garantiza que el elapsed counter del
        // StreamingActivityIndicator arranque desde el instante del hand-off.
        processingStartedAt: Date.now(),
        answeredQuestionIds: action.questionId
          ? appendUniqueQuestionId(state.answeredQuestionIds, action.questionId)
          : state.answeredQuestionIds,
        answeredQuestionSignatures: appendUniqueQuestionSignature(
          state.answeredQuestionSignatures,
          answeredQuestionSignature,
        ),
      };
    }

    case "MARK_QUESTION_ANSWERED":
      return {
        ...state,
        answeredQuestionIds: appendUniqueQuestionId(
          state.answeredQuestionIds,
          action.questionId,
        ),
      };

    case "RECEIVE_WAVE_START":
      return {
        ...state,
        waveInfo: {
          agents: action.agents.map((a) => ({
            ...a,
            done: false,
            success: undefined,
          })),
          successCount: 0,
          totalCount: action.agents.length,
        },
      };

    case "RECEIVE_AGENT_DONE": {
      if (!state.waveInfo) return state;
      return {
        ...state,
        waveInfo: {
          ...state.waveInfo,
          agents: state.waveInfo.agents.map((agent) =>
            agent.id === action.agentId
              ? { ...agent, done: true, success: action.success }
              : agent
          ),
        },
      };
    }

    case "RECEIVE_WAVE_END": {
      if (!state.waveInfo) return state;

      let remainingSuccesses = Math.max(
        0,
        action.successCount -
          state.waveInfo.agents.filter((agent) => agent.done && agent.success === true).length,
      );
      let remainingFailures = Math.max(
        0,
        action.totalCount -
          action.successCount -
          state.waveInfo.agents.filter((agent) => agent.done && agent.success === false).length,
      );

      return {
        ...state,
        waveInfo: {
          ...state.waveInfo,
          agents: state.waveInfo.agents.map((agent) => {
            if (agent.done) return agent;

            if (remainingSuccesses > 0) {
              remainingSuccesses -= 1;
              return { ...agent, done: true, success: true };
            }

            if (remainingFailures > 0) {
              remainingFailures -= 1;
              return { ...agent, done: true, success: false };
            }

            // A wave-end signal means the wave is no longer in progress. If the
            // aggregate counts are inconsistent with the known agents, prefer a
            // completed failure over leaving the UI in a forever-pending state.
            return { ...agent, done: true, success: false };
          }),
          successCount: action.successCount,
          totalCount: action.totalCount,
        },
      };
    }

    case "RECEIVE_DONE": {
      const targetPhase = "reviewing";
      if (!canTransition(state.phase, targetPhase)) {
        // If we can't transition to reviewing, still store items.
        // Clear streaming content to avoid stale data (self-contained,
        // no separate FLUSH_STREAM needed).
        return {
          ...state,
          generatedItems: action.generatedItems,
          streamingContent: "",
          streamingThinkingContent: "",
          latestActivity: null,
        };
      }
      return {
        ...state,
        phase: targetPhase,
        generatedItems: action.generatedItems,
        streamingContent: "",
        streamingThinkingContent: "",
        currentStep: null,
        latestActivity: null,
        processingStartedAt: null,
      };
    }

    case "RECEIVE_RESPONSE_COMPLETE": {
      // Graduate ALL streaming blocks (text, thinking, tool_call, etc.) to messages.
      // This preserves the full timeline so that text/thinking blocks aren't lost
      // when START_STREAMING fires on the next user message.
      const rcSid = state.sessionId ?? "";
      let rcMsgs = [...state.messages];

      // Graduate completed turn blocks from earlier turns first
      for (const turnBlocks of state.completedTurnBlocks) {
        rcMsgs.push(...graduateBlocksToMessages(turnBlocks, rcSid));
      }

      // Graduate current streaming blocks.
      // When a question is pending, the streaming text blocks contain the
      // question text that will be shown in the wizard — trim only the
      // duplicated trailing question so the earlier planning text survives in
      // the timeline.
      if (state.streamingBlocks.length > 0) {
        const blocksToGraduate = state.deferredQuestion
          ? stripDeferredQuestionFromStreamingBlocks(
              state.streamingBlocks,
              state.deferredQuestion.questionText,
            )
          : state.streamingBlocks;
        rcMsgs.push(...graduateBlocksToMessages(blocksToGraduate, rcSid));
      }

      // Promote pending user message if any
      if (state.pendingUserMessage) {
        rcMsgs.push({ ...state.pendingUserMessage, deliveryStatus: "delivered" as const });
      }

      // Mark all pending user messages as delivered
      rcMsgs = rcMsgs.map(m =>
        m.role === "user" && m.deliveryStatus && m.deliveryStatus !== "delivered"
          ? { ...m, deliveryStatus: "delivered" as const }
          : m
      );
      // If there's a deferred question, flush it now — all text/blocks have
      // arrived and been graduated above, so the wizard appears after them.
      if (state.deferredQuestion) {
        const { expiresAt: deferredExpires, source, ...deferredQ } =
          state.deferredQuestion;

        if (source === "agent_follow_up") {
          const targetPhase = canTransition(state.phase, "chatting")
            ? "chatting"
            : state.phase;
          return {
            ...state,
            messages: rcMsgs,
            pendingUserMessage: null,
            phase: targetPhase,
            currentStep: null,
            latestActivity: null,
            streamingContent: "",
            streamingThinkingContent: "",
            streamingBlocks: [],
            completedTurnBlocks: [],
            pendingQuestion: null,
            deferredQuestion: null,
            pendingFollowUp: true,
            followUpPrompt: deferredQ.questionText,
            expiresAt: deferredExpires ?? null,
            processingStartedAt: null,
          };
        }

        const questionPhase = canTransition(state.phase, "waiting_for_answer")
          ? "waiting_for_answer"
          : state.phase;
        return {
          ...state,
          messages: rcMsgs,
          pendingUserMessage: null,
          phase: questionPhase,
          currentStep: null,
          latestActivity: null,
          streamingContent: "",
          streamingThinkingContent: "",
          streamingBlocks: [],
          completedTurnBlocks: [],
          pendingQuestion: deferredQ,
          deferredQuestion: null,
          expiresAt: deferredExpires ?? null,
          processingStartedAt: null,
        };
      }

      const targetPhase = canTransition(state.phase, "chatting")
        ? "chatting"
        : state.phase;
      return {
        ...state,
        messages: rcMsgs,
        pendingUserMessage: null,
        phase: targetPhase,
        currentStep: null,
        latestActivity: null,
        // Clear ALL streaming state — everything is now in messages.
        // Explicitly clear streamingContent/streamingThinkingContent here
        // (self-contained; no longer depends on a prior FLUSH_STREAM dispatch).
        streamingContent: "",
        streamingThinkingContent: "",
        streamingBlocks: [],
        completedTurnBlocks: [],
        // Set follow-up state if the agent needs a user response to continue
        pendingFollowUp: action.requiresFollowUp ?? false,
        followUpPrompt: action.followUpPrompt ?? null,
        // Set expiresAt from response-complete for countdown timer (e.g. Codex sessions)
        expiresAt: action.expiresAt ?? state.expiresAt,
        processingStartedAt: null,
      };
    }

    case "RECEIVE_ERROR":
      return {
        ...state,
        error: action.error,
        // Fall back to idle on error for recovery
        phase: canTransition(state.phase, "idle") ? "idle" : state.phase,
        processingStartedAt: null,
      };

    case "COMPLETE": {
      const completedAt =
        state.session?.completedAt ?? new Date().toISOString();

      // Graduate ALL streaming blocks to messages (preserves chronological timeline)
      const completedMessages = [...state.messages];
      const sidC = state.sessionId ?? "";
      const blockMsgsC = graduateBlocksToMessages(state.streamingBlocks, sidC);
      completedMessages.push(...blockMsgsC);

      return {
        ...state,
        phase: "completed",
        session: state.session
          ? {
              ...state.session,
              status: "completed",
              result: action.result ?? state.session.result,
              completedAt,
            }
          : state.session,
        messages: completedMessages,
        streamingContent: "",
        streamingThinkingContent: "",
        streamingBlocks: [],
        completedTurnBlocks: state.completedTurnBlocks,
        currentStep: null,
        pendingQuestion: null,
        deferredQuestion: null,
        processingStartedAt: null,
      };
    }

    case "RESET":
      return { ...INITIAL_STATE };

    case "FLUSH_STREAM": {
      // Clear text buffers — the backend already persists this content.
      // Keep streamingBlocks so tool/subagent/thinking blocks remain visible
      // after the turn completes. They get cleared on START_STREAMING (next turn).
      if (!state.streamingContent && !state.streamingThinkingContent) {
        return state;
      }
      return {
        ...state,
        streamingContent: "",
        streamingThinkingContent: "",
      };
    }

    case "CANCEL_SESSION": {
      // Graduate ALL streaming blocks to messages (preserves chronological timeline)
      const cancelledMessages = [...state.messages];
      const sidX = state.sessionId ?? "";
      const blockMsgsX = graduateBlocksToMessages(state.streamingBlocks, sidX);
      cancelledMessages.push(...blockMsgsX);

      return {
        ...state,
        phase: "idle",
        messages: cancelledMessages,
        streamingContent: "",
        streamingThinkingContent: "",
        streamingBlocks: [],
        completedTurnBlocks: state.completedTurnBlocks,
        currentStep: null,
        pendingQuestion: null,
        deferredQuestion: null,
        latestActivity: action.latestActivity ?? null,
        processingStartedAt: null,
      };
    }

    case "LOAD_SESSION": {
      const isCompleted = action.session.status === "completed";
      const isArchived = action.session.status === "archived";
      const isInterrupted = action.session.status === "interrupted";
      const hasStartedPlanningTurn = hasHistoricalUserPrompt(action.messages);
      const answeredQuestionTexts = extractAnsweredQuestionTexts(
        action.messages,
      );
      const restoredAnsweredQuestionIds = action.answeredQuestionIds ?? [];
      let restoredExpiresAt: string | null = null;

      // Use pending question from loadMessagesFromLogs (detected from AskUserQuestion tool_use
      // without a following user_input). Falls back only for legacy control-token sessions.
      let restoredQuestion: PendingQuestion | null = action.pendingQuestion ?? null;

      if (
        hasQuestionIdAlreadyBeenAnswered(
          restoredAnsweredQuestionIds,
          restoredQuestion?.questionId,
        ) ||
        hasRestoredQuestionAlreadyBeenAnswered(
          answeredQuestionTexts,
          restoredQuestion,
        )
      ) {
        restoredQuestion = null;
      }

      // If no question from logs, try the API-provided pendingInteraction
      // (canonical awaiting-user handoff or legacy waiting fallback).
      let restoredFollowUp = false;
      let restoredFollowUpPrompt: string | null = null;

      if (!restoredQuestion && !isCompleted && !isArchived && !isInterrupted && action.pendingInteraction) {
        const pi = action.pendingInteraction;
        const source =
          pi.questionContext && typeof pi.questionContext.source === "string"
            ? pi.questionContext.source
            : null;
        const isAwaitingUserSource =
          source === "session.awaiting_user" || source === "agent_follow_up";

        if (pi.questionType === "free_text" && pi.questionText && isAwaitingUserSource) {
          restoredFollowUp = true;
          restoredFollowUpPrompt = pi.questionText;
          restoredExpiresAt = pi.expiresAt ?? null;
        } else if (pi.questionText) {
          const questions = extractStructuredQuestionsFromContext(
            pi.questionContext,
          );
          const candidateQuestion = {
            questionId: pi.id,
            questionText: pi.questionText,
            options: pi.options ?? [],
            ...(questions ? { questions } : {}),
            ...(normalizePendingInteractionQuestionType(pi.questionType)
              ? { questionType: normalizePendingInteractionQuestionType(pi.questionType) }
              : {}),
          };

          if (
            !hasQuestionIdAlreadyBeenAnswered(
              restoredAnsweredQuestionIds,
              candidateQuestion.questionId,
            ) &&
            !hasRestoredQuestionAlreadyBeenAnswered(
              answeredQuestionTexts,
              candidateQuestion,
            )
          ) {
            restoredQuestion = candidateQuestion;
            restoredExpiresAt = pi.expiresAt ?? null;
          }
        }
      }

      const shouldRestoreActiveSpinner =
        !isCompleted &&
        !isArchived &&
        !isInterrupted &&
        hasStartedPlanningTurn &&
        !restoredQuestion &&
        !restoredFollowUp &&
        (action.activeJobStatus === "queued" ||
          action.activeJobStatus === "running" ||
          action.activeJobStatus === "finalizing");
      const restoredProcessingStartedAt =
        shouldRestoreActiveSpinner && action.activeJobStartedAt
          ? Date.parse(action.activeJobStartedAt)
          : null;

      const loadedPhase: PlanningPhase =
        isInterrupted ? "interrupted" :
        isCompleted || isArchived ? "completed" :
        restoredQuestion ? "waiting_for_answer" :
        shouldRestoreActiveSpinner ? "booting" :
        "chatting";
      const localMessagesForSession = filterMessagesForSession(
        state.messages,
        action.session.id,
      );
      const hydratedMessages = mergeHydratedMessagesWithLocalMessages(
        action.messages,
        localMessagesForSession,
      );
      const pendingUserMessageForSession = getPendingUserMessageForSession(
        state.pendingUserMessage,
        action.session.id,
      );
      const restoredPendingUserMessage =
        pendingUserMessageForSession &&
        !hasMatchingUserMessage(hydratedMessages, pendingUserMessageForSession)
          ? pendingUserMessageForSession
          : null;

      return {
        ...state,
        phase: loadedPhase,
        sessionId: action.session.id,
        session: action.session,
        messages: hydratedMessages,
        generatedItems: action.generatedItems ?? [],
        pendingQuestion: restoredQuestion,
        completedTurnBlocks: action.turnBlocks ?? [],
        streamingContent: "",
        streamingThinkingContent: "",
        streamingBlocks: [],
        currentStep: null,
        latestActivity: null,
        waveInfo: null,
        error: null,
        expiresAt: restoredExpiresAt,
        pendingUserMessage: restoredPendingUserMessage,
        pendingFollowUp: restoredFollowUp,
        followUpPrompt: restoredFollowUpPrompt,
        processingStartedAt:
          restoredProcessingStartedAt !== null &&
          !Number.isNaN(restoredProcessingStartedAt)
            ? restoredProcessingStartedAt
            : null,
        answeredQuestionIds: restoredAnsweredQuestionIds,
        answeredQuestionSignatures:
          state.sessionId === action.session.id
            ? state.answeredQuestionSignatures
            : [],
        resumeStep: null,
        interruptionReason: isInterrupted
          ? ((action.session.result as Record<string, unknown> | null)?.interruptionContext as Record<string, unknown> | undefined)?.reason as string ?? "unknown"
          : null,
      };
    }

    case "RECOVER_SESSION": {
      const isCompleted = action.session.status === "completed";
      const isArchived = action.session.status === "archived";
      const recoveredPhase: PlanningPhase =
        isCompleted || isArchived ? "completed" : state.phase;
      // Graduate streaming blocks to messages before clearing them.
      // During WS reconnection, all agent content (text, thinking, tool_calls)
      // lives in streamingBlocks — losing them wipes the visible timeline.
      const recSid = state.sessionId ?? "";
      let recoveredMessages = [...state.messages];
      for (const turnBlocks of state.completedTurnBlocks) {
        recoveredMessages.push(...graduateBlocksToMessages(turnBlocks, recSid));
      }
      if (state.streamingBlocks.length > 0) {
        recoveredMessages.push(...graduateBlocksToMessages(state.streamingBlocks, recSid));
      }
      // Fall back to API messages only if local state has nothing
      if (recoveredMessages.length === 0) {
        recoveredMessages = action.messages;
      } else if (action.messages.length > 0) {
        recoveredMessages = mergeHydratedMessagesWithLocalMessages(
          action.messages,
          recoveredMessages,
        );
      }
      const recoveredPendingUserMessage =
        state.pendingUserMessage &&
        !hasMatchingUserMessage(recoveredMessages, state.pendingUserMessage)
          ? state.pendingUserMessage
          : null;
      return {
        ...state,
        phase: recoveredPhase,
        sessionId: action.session.id,
        session: action.session,
        messages: recoveredMessages,
        streamingContent: "",
        streamingThinkingContent: "",
        streamingBlocks: [],
        completedTurnBlocks: [],
        generatedItems: action.generatedItems ?? state.generatedItems,
        error: null,
        pendingUserMessage: recoveredPendingUserMessage,
        processingStartedAt: isCompleted || isArchived ? null : state.processingStartedAt,
      };
    }

    case "RESUME_SESSION": {
      // Use pending question from loadMessagesFromLogs, with pendingInteraction fallback
      let resumedQuestion: PendingQuestion | null = action.pendingQuestion ?? null;
      let resumedFollowUp = false;
      let resumedFollowUpPrompt: string | null = null;
      let resumedExpiresAt: string | null = null;
      const resumedAnsweredQuestionIds = action.answeredQuestionIds ?? [];
      const answeredQuestionTexts = extractAnsweredQuestionTexts(
        action.messages,
      );

      if (
        hasQuestionIdAlreadyBeenAnswered(
          resumedAnsweredQuestionIds,
          resumedQuestion?.questionId,
        ) ||
        hasRestoredQuestionAlreadyBeenAnswered(
          answeredQuestionTexts,
          resumedQuestion,
        )
      ) {
        resumedQuestion = null;
      }

      if (!resumedQuestion && action.pendingInteraction) {
        const pi = action.pendingInteraction;
        const source =
          pi.questionContext && typeof pi.questionContext.source === "string"
            ? pi.questionContext.source
            : null;
        const isAwaitingUserSource =
          source === "session.awaiting_user" || source === "agent_follow_up";

        if (pi.questionType === "free_text" && pi.questionText && isAwaitingUserSource) {
          resumedFollowUp = true;
          resumedFollowUpPrompt = pi.questionText;
          resumedExpiresAt = pi.expiresAt ?? null;
        } else if (pi.questionText) {
          const questions = extractStructuredQuestionsFromContext(
            pi.questionContext,
          );
          const candidateQuestion = {
            questionId: pi.id,
            questionText: pi.questionText,
            options: pi.options ?? [],
            ...(questions ? { questions } : {}),
            ...(normalizePendingInteractionQuestionType(pi.questionType)
              ? { questionType: normalizePendingInteractionQuestionType(pi.questionType) }
              : {}),
          };

          if (
            !hasQuestionIdAlreadyBeenAnswered(
              resumedAnsweredQuestionIds,
              candidateQuestion.questionId,
            ) &&
            !hasRestoredQuestionAlreadyBeenAnswered(
              answeredQuestionTexts,
              candidateQuestion,
            )
          ) {
            resumedQuestion = candidateQuestion;
            resumedExpiresAt = pi.expiresAt ?? null;
          }
        }
      }

      // Preserve optimistic local user messages until the replay catches up.
      const localMessagesForSession = filterMessagesForSession(
        state.messages,
        action.session.id,
      );
      const resumedMessages = mergeHydratedMessagesWithLocalMessages(
        action.messages.length > 0 ? action.messages : localMessagesForSession,
        localMessagesForSession,
      );
      const pendingUserMessageForSession = getPendingUserMessageForSession(
        state.pendingUserMessage,
        action.session.id,
      );
      const resumedPendingUserMessage =
        pendingUserMessageForSession &&
        !hasMatchingUserMessage(resumedMessages, pendingUserMessageForSession)
          ? pendingUserMessageForSession
          : null;

      return {
        ...state,
        phase: resumedQuestion ? "waiting_for_answer" : "chatting",
        sessionId: action.session.id,
        session: action.session,
        messages: resumedMessages,
        streamingContent: "",
        streamingThinkingContent: "",
        streamingBlocks: [],
        completedTurnBlocks: action.turnBlocks ?? [],
        currentStep: null,
        pendingQuestion: resumedQuestion,
        generatedItems: action.generatedItems ?? [],
        waveInfo: null,
        error: null,
        expiresAt: resumedExpiresAt,
        pendingUserMessage: resumedPendingUserMessage,
        pendingFollowUp: resumedFollowUp,
        followUpPrompt: resumedFollowUpPrompt,
        processingStartedAt: null,
        answeredQuestionIds: resumedAnsweredQuestionIds,
        answeredQuestionSignatures:
          state.sessionId === action.session.id
            ? state.answeredQuestionSignatures
            : [],
      };
    }

    case "INTERRUPT_SESSION": {
      // Optimistic: immediately show paused state
      if (!canTransition(state.phase, "paused")) {
        return state;
      }
      return {
        ...state,
        phase: "paused" as PlanningPhase,
        latestActivity: action.latestActivity ?? null,
      };
    }

    case "RECEIVE_PAUSED": {
      // Server confirmed pause
      return {
        ...state,
        phase: "paused" as PlanningPhase,
        latestActivity: action.latestActivity ?? state.latestActivity,
      };
    }

    case "RECEIVE_INTERRUPTED": {
      if (!canTransition(state.phase, "interrupted")) {
        return state;
      }
      return {
        ...state,
        phase: "interrupted" as PlanningPhase,
        streamingContent: "",
        streamingThinkingContent: "",
        streamingBlocks: [],
        pendingQuestion: null,
        deferredQuestion: null,
        interruptionReason: action.reason,
        latestActivity: null,
        processingStartedAt: null,
      };
    }

    case "START_RESUMING": {
      if (!canTransition(state.phase, "resuming")) {
        return state;
      }
      return {
        ...state,
        phase: "resuming" as PlanningPhase,
        resumeStep: "queued",
        interruptionReason: null,
      };
    }

    case "SET_RESUME_STEP": {
      if (state.phase !== "resuming") return state;
      return {
        ...state,
        resumeStep: action.step,
      };
    }

    default:
      return state;
  }
};

// --- Return type ---

export interface UsePlanningSessionReturn {
  // State
  phase: PlanningPhase;
  sessionId: string | null;
  session: PlanningSession | null;
  messages: PlanningMessage[];
  streamingContent: string;
  streamingThinkingContent: string;
  streamingBlocks: StreamingBlock[];
  completedTurnBlocks: StreamingBlock[][];
  currentStep: CurrentStep | null;
  pendingQuestion: PendingQuestion | null;
  /** ISO timestamp when the current interaction expires (for countdown timer). */
  expiresAt: string | null;
  generatedItems: GeneratedWorkItem[];
  waveInfo: WaveInfo | null;
  error: string | null;
  isStreaming: boolean;
  isWsConnected: boolean;
  tokenUsage: { input: number; output: number; model?: string };
  /** Latest real tool activity for the streaming indicator. */
  latestActivity: string | null;
  /** Current step during session resumption. */
  resumeStep: ResumeStep | null;
  /** Reason why the session was interrupted. */
  interruptionReason: string | null;
  /** User message waiting to be processed by the agent. */
  pendingUserMessage: PlanningMessage | null;
  /** Whether the agent is waiting for a follow-up response from the user. */
  pendingFollowUp: boolean;
  /** Contextual prompt text for the follow-up (e.g., agent's last question). */
  followUpPrompt: string | null;
  /** Timestamp in ms when the current processing turn started. */
  processingStartedAt: number | null;

  // Actions
  createSession: (
    data: CreatePlanningSessionRequest
  ) => Promise<PlanningSession>;
  startSession: (
    sessionId: string,
    userMessage: string,
    seedIds?: string[],
    agentConfig?: { provider?: string; codingAgent?: string; model?: string }
  ) => void;
  addUserMessage: (content: string, seeds?: Array<{ id: string; title: string; description?: string }>, queued?: boolean) => void;
  sendAnswer: (questionId: string, answer: string) => void;
  sendPrompt: (prompt: string) => void;
  cancelSession: () => void;
  killSession: () => void;
  interruptSession: () => void;
  loadSession: (sessionId: string) => Promise<void>;
  resumeSession: (sessionId: string, forceClose?: boolean) => Promise<PlanningSession>;
  completeSession: () => void;
  reset: () => void;
}

const DEFAULT_PERSISTED_PRIORITY: GeneratedWorkItem["priority"] = "medium";

const loadGeneratedItemsFromSession = async (
  sessionId: string,
): Promise<GeneratedWorkItem[]> => {
  const workItems = await planningSessionsApi.getWorkItems(sessionId);
  return workItems.map((item) => ({
    tempId: item.workItemId,
    type: item.type as GeneratedWorkItem["type"],
    title: item.title,
    description: "",
    priority: DEFAULT_PERSISTED_PRIORITY,
  }));
};

type HistoricalPlanningReplayJob = {
  id: string;
  status?: AgentJobStatus;
  provider?: string | null;
  config?: Record<string, unknown>;
  createdAt?: string;
  startedAt?: string | null;
};

type AgentJobStatus =
  | "queued"
  | "running"
  | "finalizing"
  | "completed"
  | "incomplete"
  | "failed"
  | "cancelled"
  | "waiting_for_input"
  | "paused";

type PlanningReplayLoadResult = {
  messages: PlanningMessage[];
  turnBlocks: StreamingBlock[][];
  pendingQuestion?: {
    questionId: string;
    questionText: string;
    options: string[];
    questions?: PendingQuestion["questions"];
  };
  activeJobStatus?: AgentJobStatus;
  activeJobStartedAt?: string | null;
};

type AgentJobOutputPage = {
  chunks: AgentLogChunk[];
  nextCursor: number | null;
  hasMore?: boolean;
};

export interface PlanningReplayTrace {
  rawChunks: AgentLogChunk[];
  displayChunks: AgentLogChunk[];
  fallbackUserMessage?: string;
  fallbackUserTimestamp?: string;
}

type AgentJobOutputPageLoader = (
  cursor?: number,
) => Promise<AgentJobOutputPage>;

const MAX_REPLAY_OUTPUT_PAGES = 20;
const MAX_REPLAY_OUTPUT_CHUNKS = 20_000;

export const loadPaginatedAgentJobOutput = async (
  loadPage: AgentJobOutputPageLoader,
): Promise<AgentLogChunk[]> => {
  const chunks: AgentLogChunk[] = [];
  let cursor: number | undefined;
  let pageCount = 0;

  while (pageCount < MAX_REPLAY_OUTPUT_PAGES) {
    const page = await loadPage(cursor);
    if (page.chunks.length === 0) break;

    chunks.push(...page.chunks);
    pageCount += 1;

    if (!page.hasMore || page.nextCursor === null) {
      break;
    }

    if (chunks.length >= MAX_REPLAY_OUTPUT_CHUNKS) {
      return chunks.slice(0, MAX_REPLAY_OUTPUT_CHUNKS);
    }

    cursor = page.nextCursor;
  }

  return chunks.slice(0, MAX_REPLAY_OUTPUT_CHUNKS);
};

const sortAgentChunksByTime = (chunks: AgentLogChunk[]): AgentLogChunk[] =>
  [...chunks].sort((left, right) => {
    const timestampDiff =
      new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime();
    if (timestampDiff !== 0) return timestampDiff;
    return left.seq - right.seq;
  });

const toPlanningMessage = (
  sessionId: string,
  message: ConversationMessage,
): PlanningMessage => ({
  id: `history-${message.id}`,
  sessionId,
  role: message.role,
  content: message.content,
  messageType:
    message.messageType ??
    (message.role === "assistant"
      ? "stream"
      : message.role === "system"
        ? "system"
        : "user"),
  inputTokens: null,
  outputTokens: null,
  metadata: {
    ...(message.metadata ?? {}),
    ...(message.seeds ? { seeds: message.seeds } : {}),
  },
  createdAt: message.timestamp ?? new Date().toISOString(),
  deliveryStatus: message.deliveryStatus,
});

const buildReplayDisplayChunks = (
  rawChunks: AgentLogChunk[],
  sessionEvents: SessionEventRecord[],
  provider: string | null | undefined,
): AgentLogChunk[] => {
  if (rawChunks.length === 0 && sessionEvents.length > 0) {
    return buildSessionDisplayChunks(rawChunks, sessionEvents, "codex");
  }

  return buildSessionDisplayChunks(rawChunks, sessionEvents, provider);
};

export const buildPlanningReplayFromHistory = (
  sessionId: string,
  traces: PlanningReplayTrace[],
): { messages: PlanningMessage[]; turnBlocks: StreamingBlock[][] } => {
  const messages: PlanningMessage[] = [];

  for (const trace of traces) {
    const conversationChunks = [
      ...trace.rawChunks.filter(
        (chunk) =>
          chunk.phase === "session" && chunk.eventType === "prompt.sent",
      ),
      ...trace.displayChunks.filter(
        (chunk) =>
          !(chunk.phase === "session" && chunk.eventType === "prompt.sent"),
      ),
    ];
    const transcriptMessages = chunksToConversationMessages(conversationChunks);
    const sortedDisplayChunks = sortAgentChunksByTime(trace.displayChunks);
    const assistantChunks: AgentLogChunk[] = [];
    let sawExplicitUserInput = false;

    const flushAssistantChunks = () => {
      if (assistantChunks.length === 0) return;
      const assistantBlocks = parseChunksToStreamingBlocks(assistantChunks, false);
      if (assistantBlocks.length > 0) {
        messages.push(...graduateBlocksToMessages(assistantBlocks, sessionId));
      }
      assistantChunks.length = 0;
    };

    for (const chunk of sortedDisplayChunks) {
      if (chunk.phase === "transcript" && chunk.contentType === "user_input") {
        if (sawExplicitUserInput) {
          flushAssistantChunks();
        }
        sawExplicitUserInput = true;
        messages.push(
          toPlanningMessage(sessionId, {
            id: chunk.id,
            role: "user",
            content: chunk.message,
            timestamp: chunk.timestamp,
            messageType: "user",
            metadata: chunk.payload ?? undefined,
            seeds:
              (chunk.payload?.seeds as ConversationMessage["seeds"] | undefined)
                ?.length
                ? (chunk.payload?.seeds as ConversationMessage["seeds"])
                : undefined,
          }),
        );
        continue;
      }

      assistantChunks.push(chunk);
    }

    if (!sawExplicitUserInput) {
      const fallbackUserMessage =
        trace.fallbackUserMessage
          ? {
              id: `fallback-${sessionId}`,
              role: "user" as const,
              content: trace.fallbackUserMessage,
              timestamp:
                trace.fallbackUserTimestamp ?? new Date().toISOString(),
            }
          : transcriptMessages.find((message) => message.role === "user") ??
            null;

      if (fallbackUserMessage) {
        messages.push(toPlanningMessage(sessionId, fallbackUserMessage));
      }
    }

    flushAssistantChunks();
  }

  return { messages, turnBlocks: [] };
};

const loadReplayTraceForJob = async (
  job: HistoricalPlanningReplayJob,
): Promise<PlanningReplayTrace> => {
  let rawChunks: AgentLogChunk[] = [];
  let sessionEvents: SessionEventRecord[] = [];

  try {
    rawChunks = await loadPaginatedAgentJobOutput((cursor) =>
      request<AgentJobOutputPage>(
        `/agent-jobs/${job.id}/output?limit=5000${
          cursor !== undefined ? `&cursor=${cursor}` : ""
        }`,
      ),
    );
  } catch {
    rawChunks = [];
  }

  if (job.provider === "codex" || rawChunks.length === 0) {
    try {
      sessionEvents = await request<SessionEventRecord[]>(
        `/agent-jobs/${job.id}/session-events?limit=5000`,
      );
    } catch {
      sessionEvents = [];
    }
  }

  return {
    rawChunks,
    displayChunks: buildReplayDisplayChunks(
      rawChunks,
      sessionEvents,
      job.provider,
    ),
    fallbackUserMessage: job.config?.userMessage as string | undefined,
    fallbackUserTimestamp: job.createdAt,
  };
};

/**
 * Load historical planning replay using the same canonical chunk pipeline used by
 * the sessions detail view. Falls back to planning-session level canonical events
 * when the original agent job rows are gone but replayable events still exist.
 */
const loadMessagesFromLogs = async (
  sessionId: string,
): Promise<PlanningReplayLoadResult> => {
  try {
    const jobs = await request<HistoricalPlanningReplayJob[]>(
      `/agent-jobs?planningSessionId=${sessionId}&limit=5`,
    ).catch(() => []);

    const sortedJobs = [...jobs].sort((left, right) => {
      const leftTime = new Date(left.createdAt ?? 0).getTime();
      const rightTime = new Date(right.createdAt ?? 0).getTime();
      return leftTime - rightTime;
    });

    const traces =
      sortedJobs.length > 0
        ? await Promise.all(sortedJobs.map(loadReplayTraceForJob))
        : [];
    const latestJobStatus = sortedJobs.at(-1)?.status;
    const latestJobStartedAt =
      sortedJobs.at(-1)?.startedAt ?? sortedJobs.at(-1)?.createdAt ?? null;

    const replay =
      traces.length > 0
        ? buildPlanningReplayFromHistory(sessionId, traces)
        : { messages: [], turnBlocks: [] as StreamingBlock[][] };

    if (replay.messages.length > 0 || replay.turnBlocks.length > 0) {
      return {
        ...replay,
        activeJobStatus: latestJobStatus,
        activeJobStartedAt: latestJobStartedAt,
      };
    }

    const sessionEvents = await planningSessionsApi
      .getSessionEvents(sessionId)
      .catch(() => []);
    if (sessionEvents.length === 0) {
      return {
        ...replay,
        activeJobStatus: latestJobStatus,
        activeJobStartedAt: latestJobStartedAt,
      };
    }

    return {
      ...buildPlanningReplayFromHistory(sessionId, [
      {
        rawChunks: [],
        displayChunks: buildReplayDisplayChunks([], sessionEvents, "codex"),
      },
      ]),
      activeJobStatus: latestJobStatus,
      activeJobStartedAt: latestJobStartedAt,
    };
  } catch {
    return { messages: [], turnBlocks: [] };
  }
};

// --- Hook ---

export const usePlanningSession = (): UsePlanningSessionReturn => {
  const t = useTranslations("planning.session");
  const wsContext = useWsContextOptional();
  const [state, dispatch] = useReducer(withTraceSinkReducer(planningReducer), INITIAL_STATE);

  // Derive isStreaming from phase
  const isStreaming =
    state.phase === "streaming" ||
    state.phase === "thinking" ||
    state.phase === "booting";

  // Refs updated only inside effects for safe access in async callbacks
  const sessionIdRef = useRef<string | null>(state.sessionId);
  const phaseRef = useRef(state.phase);
  const streamingContentRef = useRef(state.streamingContent);
  const streamingThinkingContentRef = useRef(state.streamingThinkingContent);
  const messagesRef = useRef(state.messages);
  const streamingReplayBaselineRef = useRef("");
  const thinkingReplayBaselineRef = useRef("");
  const reconnectDedupeUntilRef = useRef(0);
  const idleTimeoutToastSessionIdRef = useRef<string | null>(null);

  const primeReplayDedupWindow = useCallback((messages: PlanningMessage[]) => {
    messagesRef.current = messages;
    streamingReplayBaselineRef.current = getReplayDedupBaselineFromMessages(
      messages,
      "stream",
    );
    thinkingReplayBaselineRef.current = getReplayDedupBaselineFromMessages(
      messages,
      "thinking",
    );
    reconnectDedupeUntilRef.current =
      Date.now() + RECENT_RECONNECT_DEDUP_WINDOW_MS;
  }, []);

  useEffect(() => {
    sessionIdRef.current = state.sessionId;
  }, [state.sessionId]);

  useEffect(() => {
    phaseRef.current = state.phase;
  }, [state.phase]);

  useEffect(() => {
    streamingContentRef.current = state.streamingContent;
  }, [state.streamingContent]);

  useEffect(() => {
    streamingThinkingContentRef.current = state.streamingThinkingContent;
  }, [state.streamingThinkingContent]);

  useEffect(() => {
    messagesRef.current = state.messages;
  }, [state.messages]);

  const isWsConnected = wsContext?.isConnected ?? false;

  // Subscribe to all planning:* WS events
  useEffect(() => {
    if (!wsContext) return;

    const matchesSession = (sessionId: string): boolean => {
      return sessionIdRef.current === sessionId;
    };

    const handleText = (message: WsServerMessage) => {
      const msg = message as WsServerPlanningText;
      if (!matchesSession(msg.payload.sessionId)) return;
      const dedupeBase =
        streamingReplayBaselineRef.current || streamingContentRef.current;
      const content =
        Date.now() < reconnectDedupeUntilRef.current
          ? stripRetransmittedStreamingChunk(
              dedupeBase,
              msg.payload.content,
            )
          : msg.payload.content;
      if (!content) return;
      streamingReplayBaselineRef.current = `${dedupeBase}${content}`;
      streamingContentRef.current += content;
      dispatch({ type: "RECEIVE_TEXT", content, sequenceNum: msg.payload.sequenceNum, jobId: msg.payload.jobId });
    };

    const handleThinking = (message: WsServerMessage) => {
      const msg = message as WsServerPlanningThinking;
      if (!matchesSession(msg.payload.sessionId)) return;
      const dedupeBase =
        thinkingReplayBaselineRef.current || streamingThinkingContentRef.current;
      const content =
        Date.now() < reconnectDedupeUntilRef.current
          ? stripRetransmittedStreamingChunk(
              dedupeBase,
              msg.payload.content,
            )
          : msg.payload.content;
      if (!content) return;
      thinkingReplayBaselineRef.current = `${dedupeBase}${content}`;
      streamingThinkingContentRef.current += content;
      dispatch({ type: "RECEIVE_THINKING", content, sequenceNum: msg.payload.sequenceNum, jobId: msg.payload.jobId });
    };

    const handleStep = (message: WsServerMessage) => {
      const msg = message as WsServerPlanningStep;
      if (!matchesSession(msg.payload.sessionId)) return;
      dispatch({
        type: "RECEIVE_STEP",
        stepName: msg.payload.stepName,
        stepIndex: msg.payload.stepIndex,
        sequenceNum: msg.payload.sequenceNum,
        jobId: msg.payload.jobId,
      });
    };

    const handleQuestion = (message: WsServerMessage) => {
      const msg = message as WsServerPlanningQuestion;
      if (!matchesSession(msg.payload.sessionId)) return;
      dispatch({
        type: "RECEIVE_QUESTION",
        questionId: msg.payload.questionId,
        questionText: msg.payload.questionText,
        options: msg.payload.options,
        questions: msg.payload.questions,
        questionType: msg.payload.questionType,
        expiresAt: msg.payload.expiresAt,
        source: msg.payload.source,
      });
    };

    const handleAnswerReceived = (message: WsServerMessage) => {
      const msg = message as WsServerPlanningAnswerReceived;
      if (!matchesSession(msg.payload.sessionId)) return;
      dispatch({
        type: "MARK_QUESTION_ANSWERED",
        questionId: msg.payload.questionId,
      });
    };

    const handleDone = (message: WsServerMessage) => {
      const msg = message as WsServerPlanningDone;
      if (!matchesSession(msg.payload.sessionId)) return;

      // No separate FLUSH_STREAM dispatch — RECEIVE_DONE handles clearing.
      // Dispatching FLUSH_STREAM first can cause a React useReducer bail-out
      // (returns same state ref when content is already empty) which prevents
      // the subsequent dispatch from triggering a re-render in production.
      const items: GeneratedWorkItem[] = (
        msg.payload.generatedItems ?? []
      ).map((item) => ({
        tempId: item.tempId,
        type: item.type as GeneratedWorkItem["type"],
        title: item.title,
        description: item.description,
        priority: item.priority as GeneratedWorkItem["priority"],
        parentTempId: item.parentTempId,
        fromSeedId: item.fromSeedId,
      }));

      // Deduplicate timeout/killed toasts when the same planning:done event is replayed after WS reconnect.
      const summary = msg.payload.summary ?? "";
      if (
        shouldShowIdleTimeoutToast({
          generatedItemsCount: items.length,
          summary,
          sessionId: msg.payload.sessionId,
          lastNotifiedSessionId: idleTimeoutToastSessionIdRef.current,
        })
      ) {
        idleTimeoutToastSessionIdRef.current = msg.payload.sessionId;
        showToast.warning(t("idleTimeoutToast"), {
          duration: 8000,
          id: `planning-idle-timeout:${msg.payload.sessionId}`,
        });
      }

      dispatch({ type: "RECEIVE_DONE", generatedItems: items, summary });
    };

    const handleResponseComplete = (message: WsServerMessage) => {
      const msg = message as WsServerPlanningResponseComplete;
      if (!matchesSession(msg.payload.sessionId)) return;
      reconnectDedupeUntilRef.current = 0;
      streamingReplayBaselineRef.current = "";
      thinkingReplayBaselineRef.current = "";
      // Single dispatch — RECEIVE_RESPONSE_COMPLETE clears streaming state
      // itself. A separate FLUSH_STREAM dispatch can bail out (return same
      // state ref) when content is already empty, which in React production
      // mode can prevent the batched RECEIVE_RESPONSE_COMPLETE from
      // triggering a re-render (React useReducer bail-out bug).
      dispatch({
        type: "RECEIVE_RESPONSE_COMPLETE",
        summary: msg.payload.summary,
        requiresFollowUp: msg.payload.requiresFollowUp,
        followUpPrompt: (msg.payload as { followUpPrompt?: string }).followUpPrompt,
        expiresAt: msg.payload.expiresAt,
      });
    };

    const handleError = (message: WsServerMessage) => {
      const msg = message as WsServerPlanningError;
      if (!matchesSession(msg.payload.sessionId)) return;
      reconnectDedupeUntilRef.current = 0;
      streamingReplayBaselineRef.current = "";
      thinkingReplayBaselineRef.current = "";
      dispatch({ type: "RECEIVE_ERROR", error: msg.payload.message });
    };

    const handleSessionCompleted = (message: WsServerMessage) => {
      const msg = message as WsServerPlanningSessionCompleted;
      if (!matchesSession(msg.payload.sessionId)) return;
      reconnectDedupeUntilRef.current = 0;
      streamingReplayBaselineRef.current = "";
      thinkingReplayBaselineRef.current = "";
      dispatch({ type: "COMPLETE", result: msg.payload.result });
    };

    const handleSessionResumed = (message: WsServerMessage) => {
      const msg = message as WsServerPlanningSessionResumed;
      if (!matchesSession(msg.payload.sessionId)) return;
      // Session was resumed — the reducer will handle state via RESUME_SESSION
      // dispatched from the resumeSession action. This handler is for
      // external broadcasts (e.g. another tab).
    };

    const handleWaveStart = (message: WsServerMessage) => {
      const msg = message as WsServerPlanningWaveStart;
      if (!matchesSession(msg.payload.sessionId)) return;
      dispatch({ type: "RECEIVE_WAVE_START", agents: msg.payload.agents });
    };

    const handleAgentDone = (message: WsServerMessage) => {
      const msg = message as WsServerPlanningAgentDone;
      if (!matchesSession(msg.payload.sessionId)) return;
      dispatch({
        type: "RECEIVE_AGENT_DONE",
        agentId: msg.payload.agentId,
        success: msg.payload.success,
        reason: msg.payload.reason,
      });
    };

    const handleWaveEnd = (message: WsServerMessage) => {
      const msg = message as WsServerPlanningWaveEnd;
      if (!matchesSession(msg.payload.sessionId)) return;
      dispatch({
        type: "RECEIVE_WAVE_END",
        successCount: msg.payload.successCount,
        totalCount: msg.payload.totalCount,
      });
    };

    const handleToolCallStart = (message: WsServerMessage) => {
      const msg = message as WsServerPlanningToolCallStart;
      if (!matchesSession(msg.payload.sessionId)) return;
      console.log(`[ws-event] tool-call-start: ${msg.payload.toolName} (${msg.payload.toolCallId}) preview=${msg.payload.inputPreview?.slice(0, 80)}`);
      dispatch({
        type: "RECEIVE_TOOL_CALL_START",
        toolCallId: msg.payload.toolCallId,
        toolName: msg.payload.toolName,
        inputPreview: msg.payload.inputPreview,
        sequenceNum: msg.payload.sequenceNum,
        jobId: msg.payload.jobId,
      });
    };

    const handleToolCallResult = (message: WsServerMessage) => {
      const msg = message as WsServerPlanningToolCallResult;
      if (!matchesSession(msg.payload.sessionId)) return;
      console.log(`[ws-event] tool-call-result: ${msg.payload.toolCallId} success=${msg.payload.success}`);
      dispatch({
        type: "RECEIVE_TOOL_CALL_RESULT",
        toolCallId: msg.payload.toolCallId,
        success: msg.payload.success,
        sequenceNum: msg.payload.sequenceNum,
        jobId: msg.payload.jobId,
      });
    };

    const handleFileRead = (message: WsServerMessage) => {
      const msg = message as WsServerPlanningFileRead;
      if (!matchesSession(msg.payload.sessionId)) return;
      console.log(`[ws-event] file-read: ${msg.payload.filePath}`);
      dispatch({
        type: "RECEIVE_FILE_READ",
        filePath: msg.payload.filePath,
        lineRange: msg.payload.lineRange,
        sequenceNum: msg.payload.sequenceNum,
        jobId: msg.payload.jobId,
      });
    };

    const handleFileChange = (message: WsServerMessage) => {
      const msg = message as WsServerPlanningFileChange;
      if (!matchesSession(msg.payload.sessionId)) return;
      console.log(`[ws-event] file-change: ${msg.payload.filePath} op=${msg.payload.operation}`);
      dispatch({
        type: "RECEIVE_FILE_CHANGE",
        filePath: msg.payload.filePath,
        operation: msg.payload.operation,
        sequenceNum: msg.payload.sequenceNum,
        jobId: msg.payload.jobId,
      });
    };

    const handleBashExecute = (message: WsServerMessage) => {
      const msg = message as WsServerPlanningBashExecute;
      if (!matchesSession(msg.payload.sessionId)) return;
      console.log(`[ws-event] bash-execute: ${msg.payload.command?.slice(0, 80)}`);
      dispatch({
        type: "RECEIVE_BASH_EXECUTE",
        command: msg.payload.command,
        description: msg.payload.description,
        sequenceNum: msg.payload.sequenceNum,
        jobId: msg.payload.jobId,
      });
    };

    const handleSubagentSpawn = (message: WsServerMessage) => {
      const msg = message as WsServerPlanningSubagentSpawn;
      if (!matchesSession(msg.payload.sessionId)) return;
      console.log(`[ws-event] subagent-spawn: ${msg.payload.subagentId} type=${msg.payload.subagentType} desc=${msg.payload.description?.slice(0, 80)}`);
      dispatch({
        type: "RECEIVE_SUBAGENT_SPAWN",
        subagentId: msg.payload.subagentId,
        description: msg.payload.description,
        isBackground: msg.payload.isBackground,
        subagentType: msg.payload.subagentType,
        sequenceNum: msg.payload.sequenceNum,
        jobId: msg.payload.jobId,
      });
    };

    const handleSubagentComplete = (message: WsServerMessage) => {
      const msg = message as WsServerPlanningSubagentComplete;
      if (!matchesSession(msg.payload.sessionId)) return;
      console.log(`[ws-event] subagent-complete: ${msg.payload.subagentId} success=${msg.payload.success}`);
      dispatch({
        type: "RECEIVE_SUBAGENT_COMPLETE",
        subagentId: msg.payload.subagentId,
        success: msg.payload.success,
        sequenceNum: msg.payload.sequenceNum,
        jobId: msg.payload.jobId,
      });
    };

    const handleTokenUsage = (message: WsServerMessage) => {
      const msg = message as WsServerPlanningTokenUsage;
      if (!matchesSession(msg.payload.sessionId)) return;
      dispatch({
        type: "RECEIVE_TOKEN_USAGE",
        inputTokens: msg.payload.inputTokens,
        outputTokens: msg.payload.outputTokens,
        totalInput: msg.payload.totalInputTokens,
        totalOutput: msg.payload.totalOutputTokens,
        model: msg.payload.model,
      });
    };

    const handlePaused = (message: WsServerMessage) => {
      const msg = message as WsServerPlanningPaused;
      if (!matchesSession(msg.payload.sessionId)) return;
      dispatch({ type: "RECEIVE_PAUSED", latestActivity: t("pausedActivity") });
    };

    const handleInterrupted = (message: WsServerMessage) => {
      const msg = message as WsServerPlanningSessionInterrupted;
      if (!matchesSession(msg.payload.sessionId)) return;
      dispatch({
        type: "RECEIVE_INTERRUPTED",
        reason: msg.payload.reason,
        pendingQuestionText: msg.payload.pendingQuestionText,
        workItemsCreated: msg.payload.workItemsCreated,
      });
    };

    const handlePromptAck = (message: WsServerMessage) => {
      const msg = message as WsServerPlanningPromptAck;
      if (!matchesSession(msg.payload.sessionId)) return;
      dispatch({ type: "PROMPT_ACK", status: msg.payload.status });
    };

    const handleMessageQueued = (message: WsServerMessage) => {
      const msg = message as WsServerPlanningMessageQueued;
      if (!matchesSession(msg.payload.sessionId)) return;
      dispatch({ type: "PROMPT_ACK", status: "queued" });
    };

    const handleMessageDequeued = (message: WsServerMessage) => {
      const msg = message as WsServerPlanningMessageDequeued;
      if (!matchesSession(msg.payload.sessionId)) return;
      dispatch({ type: "MESSAGE_DEQUEUED" });
    };

    const unsubs = [
      wsContext.subscribe("planning:text", handleText),
      wsContext.subscribe("planning:thinking", handleThinking),
      wsContext.subscribe("planning:step", handleStep),
      wsContext.subscribe("planning:question", handleQuestion),
      wsContext.subscribe("planning:answer-received", handleAnswerReceived),
      wsContext.subscribe("planning:done", handleDone),
      wsContext.subscribe("planning:response-complete", handleResponseComplete),
      wsContext.subscribe("planning:error", handleError),
      wsContext.subscribe("planning-session:completed", handleSessionCompleted),
      wsContext.subscribe("planning-session:resumed", handleSessionResumed),
      wsContext.subscribe("planning:wave-start", handleWaveStart),
      wsContext.subscribe("planning:agent-done", handleAgentDone),
      wsContext.subscribe("planning:wave-end", handleWaveEnd),
      wsContext.subscribe("planning:tool-call-start", handleToolCallStart),
      wsContext.subscribe("planning:tool-call-result", handleToolCallResult),
      wsContext.subscribe("planning:file-read", handleFileRead),
      wsContext.subscribe("planning:file-change", handleFileChange),
      wsContext.subscribe("planning:bash-execute", handleBashExecute),
      wsContext.subscribe("planning:subagent-spawn", handleSubagentSpawn),
      wsContext.subscribe("planning:subagent-complete", handleSubagentComplete),
      wsContext.subscribe("planning:token-usage", handleTokenUsage),
      wsContext.subscribe("planning:paused", handlePaused),
      wsContext.subscribe("planning-session:interrupted", handleInterrupted),
      wsContext.subscribe("planning:prompt-ack", handlePromptAck),
      wsContext.subscribe("planning:message-queued", handleMessageQueued),
      wsContext.subscribe("planning:message-dequeued", handleMessageDequeued),
    ];

    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  }, [wsContext, t]);

  // Recover session on WS reconnection
  const prevConnectedRef = useRef(isWsConnected);
  useEffect(() => {
    const wasDisconnected = !prevConnectedRef.current;
    const isNowConnected = isWsConnected;
    prevConnectedRef.current = isNowConnected;

    if (wasDisconnected && isNowConnected && sessionIdRef.current) {
      const activePhase = phaseRef.current;
      if (
        activePhase === "streaming" ||
        activePhase === "thinking" ||
        activePhase === "booting" ||
        activePhase === "chatting"
      ) {
        // Re-fetch session AND messages to recover state after reconnection.
        // "chatting" is included so that when the user returns to the tab and
        // the WS reconnects, we re-sync against the authoritative backend state
        // instead of trusting replayed planning:* events to decide whether a
        // turn is actually in progress.
        // Previously we passed messages: [] which caused empty timelines when
        // local state had no messages (e.g., after a Suspense remount).
        const sessionId = sessionIdRef.current;
        void (async () => {
          try {
            const [session, { messages: apiMessages }, generatedItems] = await Promise.all([
              planningSessionsApi.get(sessionId),
              loadMessagesFromLogs(sessionId),
              loadGeneratedItemsFromSession(sessionId).catch(() => []),
            ]);
            primeReplayDedupWindow(apiMessages);
            dispatch({
              type: "RECOVER_SESSION",
              session,
              messages: apiMessages,
              generatedItems,
            });
          } catch {
            // If recovery fails, leave current state intact
          }
        })();
      }
    }
  }, [isWsConnected, primeReplayDedupWindow]);

  // --- Actions ---

  const createSession = useCallback(
    async (data: CreatePlanningSessionRequest): Promise<PlanningSession> => {
      const session = await planningSessionsApi.create(data);
      dispatch({ type: "SET_SESSION", session });
      return session;
    },
    []
  );

  const startSession = useCallback(
    (sessionId: string, userMessage: string, seedIds?: string[], agentConfig?: { provider?: string; codingAgent?: string; model?: string }) => {
      if (!wsContext?.isConnected) {
        console.warn("[planning] startSession skipped: WS not connected", { isConnected: wsContext?.isConnected, hasContext: !!wsContext });
        return;
      }
      console.info("[planning] startSession: sending planning:start", { sessionId, agentConfig });

      dispatch({ type: "START_STREAMING" });

      wsContext.sendMessage({
        type: "planning:start",
        clientActionId: crypto.randomUUID(),
        payload: {
          sessionId,
          userMessage,
          ...(seedIds && seedIds.length > 0 ? { seedIds } : {}),
          ...(agentConfig?.provider ? { provider: agentConfig.provider } : {}),
          ...(agentConfig?.codingAgent ? { codingAgent: agentConfig.codingAgent } : {}),
          ...(agentConfig?.model ? { model: agentConfig.model } : {}),
        },
      });
    },
    [wsContext]
  );

  const sendAnswer = useCallback(
    (questionId: string, answer: string) => {
      if (!wsContext || !state.sessionId) return;

      persistAnsweredQuestionId(state.sessionId, questionId);

      // Single dispatch: graduates streaming blocks + adds answer
      // in correct chronological order (no separate ADD_USER_MESSAGE needed)
      dispatch({ type: "ANSWER_QUESTION", questionId, answer });

      // sendMessage encola internamente si el WS no está OPEN y dispara
      // reconexión; no debemos gatear por isConnected aquí para evitar drops
      // silenciosos de respuestas del cuestionario.
      if (!wsContext.isConnected) {
        showToast.info(t("answerQueuedOffline"));
      }

      // Use planning:prompt instead of planning:answer — the prompt handler
      // finds the pending interaction by jobId, avoiding the empty questionId
      // issue with canonical events.
      wsContext.sendMessage({
        type: "planning:prompt",
        clientActionId: crypto.randomUUID(),
        payload: {
          sessionId: state.sessionId,
          prompt: answer,
          questionId,
        },
      });
    },
    [wsContext, state.sessionId, t]
  );

  const sendPrompt = useCallback(
    (prompt: string) => {
      if (!wsContext || !state.sessionId) return;
      const trimmedPrompt = prompt.trim();
      if (!trimmedPrompt) return;

      if (state.pendingQuestion) {
        persistAnsweredQuestionId(
          state.sessionId,
          state.pendingQuestion.questionId,
        );
        // Answer via chat input: ANSWER_QUESTION handles graduating blocks + user answer
        dispatch({
          type: "ANSWER_QUESTION",
          questionId: state.pendingQuestion.questionId,
          answer: trimmedPrompt,
        });
      } else if (!isStreaming) {
        dispatch({ type: "START_STREAMING" });
      }

      // sendMessage encola internamente si el WS no está OPEN; evitamos el
      // drop silencioso por desconexión transitoria y avisamos al usuario.
      if (!wsContext.isConnected) {
        showToast.info(t("answerQueuedOffline"));
      }

      wsContext.sendMessage({
        type: "planning:prompt",
        clientActionId: crypto.randomUUID(),
        payload: {
          sessionId: state.sessionId,
          prompt: trimmedPrompt,
          ...(state.pendingQuestion
            ? { questionId: state.pendingQuestion.questionId }
            : {}),
        },
      });
    },
    [wsContext, state.sessionId, state.pendingQuestion, isStreaming, t]
  );

  const cancelSession = useCallback(() => {
    // Optimistic UI: immediately update local state
    dispatch({ type: "CANCEL_SESSION", latestActivity: t("cancelledToast") });

    // Send cancel to backend
    if (wsContext?.isConnected && state.sessionId) {
      wsContext.sendMessage({
        type: "planning:cancel",
        clientActionId: crypto.randomUUID(),
        payload: {
          sessionId: state.sessionId,
        },
      });
    }

    showToast.info(t("cancelledToast"));
  }, [wsContext, state.sessionId, t]);

  const killSession = useCallback(() => {
    // Optimistic UI: immediately update local state (same as cancel)
    dispatch({ type: "CANCEL_SESSION", latestActivity: t("killedToast") });

    // Send kill to backend (marks session as completed with reason killed_by_user)
    if (wsContext?.isConnected && state.sessionId) {
      wsContext.sendMessage({
        type: "planning:kill",
        clientActionId: crypto.randomUUID(),
        payload: {
          sessionId: state.sessionId,
        },
      });
    }

    showToast.info(t("killedToast"));
  }, [wsContext, state.sessionId, t]);

  const interruptSession = useCallback(() => {
    dispatch({ type: "INTERRUPT_SESSION", latestActivity: t("waitingInstructions") });

    if (wsContext?.isConnected && state.sessionId) {
      wsContext.sendMessage({
        type: "planning:interrupt",
        clientActionId: crypto.randomUUID(),
        payload: { sessionId: state.sessionId },
      });
    }

    showToast.info(t("pausedToast"));
  }, [wsContext, state.sessionId, t]);

  const loadSession = useCallback(
    async (sessionId: string): Promise<void> => {
      const [sessionResponse, logResult, generatedItems] = await Promise.all([
        planningSessionsApi.get(sessionId),
        loadMessagesFromLogs(sessionId),
        loadGeneratedItemsFromSession(sessionId).catch(() => []),
      ]);
      const isLiveSession =
        sessionResponse.status === "active" &&
        (logResult.activeJobStatus === "queued" ||
          logResult.activeJobStatus === "running" ||
          logResult.activeJobStatus === "finalizing");
      if (isLiveSession) {
        primeReplayDedupWindow(logResult.messages);
      }
      // Extract pendingInteraction from the API response (may not exist on older backends)
      const { pendingInteraction, ...session } =
        sessionResponse as PlanningSessionWithPendingInteraction;
      dispatch({
        type: "LOAD_SESSION",
        session,
        messages: logResult.messages,
        generatedItems,
        turnBlocks: logResult.turnBlocks,
        pendingQuestion: logResult.pendingQuestion,
        pendingInteraction: pendingInteraction ?? null,
        activeJobStatus: logResult.activeJobStatus,
        activeJobStartedAt: logResult.activeJobStartedAt,
        answeredQuestionIds: readPersistedAnsweredQuestionIds(sessionId),
      });
    },
    [primeReplayDedupWindow]
  );

  const resumeSession = useCallback(
    async (sessionId: string, forceClose?: boolean): Promise<PlanningSession> => {
      const [resumedRaw, logResult, generatedItems] = await Promise.all([
        planningSessionsApi.resume(sessionId, forceClose),
        loadMessagesFromLogs(sessionId),
        loadGeneratedItemsFromSession(sessionId).catch(() => []),
      ]);
      primeReplayDedupWindow(logResult.messages);
      // Extract pendingInteraction from the enriched resume response
      const { pendingInteraction, ...resumed } = resumedRaw;
      dispatch({
        type: "RESUME_SESSION",
        session: resumed,
        messages: logResult.messages,
        generatedItems,
        turnBlocks: logResult.turnBlocks,
        pendingQuestion: logResult.pendingQuestion,
        pendingInteraction: pendingInteraction ?? null,
        answeredQuestionIds: readPersistedAnsweredQuestionIds(sessionId),
      });
      return resumed;
    },
    [primeReplayDedupWindow]
  );

  const completeSession = useCallback(() => {
    dispatch({ type: "COMPLETE" });
  }, []);

  const addUserMessage = useCallback((content: string, seeds?: Array<{ id: string; title: string; description?: string }>, queued?: boolean) => {
    dispatch({ type: "ADD_USER_MESSAGE", content, seeds, queued });
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: "RESET" });
  }, []);

  return {
    // State
    phase: state.phase,
    sessionId: state.sessionId,
    session: state.session,
    messages: state.messages,
    streamingContent: state.streamingContent,
    streamingThinkingContent: state.streamingThinkingContent,
    streamingBlocks: state.streamingBlocks,
    completedTurnBlocks: state.completedTurnBlocks,
    currentStep: state.currentStep,
    pendingQuestion: state.pendingQuestion,
    expiresAt: state.expiresAt,
    generatedItems: state.generatedItems,
    waveInfo: state.waveInfo,
    error: state.error,
    isStreaming,
    isWsConnected,
    tokenUsage: state.tokenUsage,
    latestActivity: state.latestActivity,
    resumeStep: state.resumeStep,
    interruptionReason: state.interruptionReason,
    pendingUserMessage: state.pendingUserMessage,
    pendingFollowUp: state.pendingFollowUp,
    followUpPrompt: state.followUpPrompt,
    processingStartedAt: state.processingStartedAt,

    // Actions
    createSession,
    startSession,
    addUserMessage,
    sendAnswer,
    sendPrompt,
    cancelSession,
    killSession,
    interruptSession,
    loadSession,
    resumeSession,
    completeSession,
    reset,
  };
};
