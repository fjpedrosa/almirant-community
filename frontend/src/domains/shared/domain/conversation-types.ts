import type React from "react";
import type { StreamingBlock } from "./streaming-block-types";

export type ConversationMessageRole = "user" | "assistant" | "system";

export interface ConversationUserSeed {
  id: string;
  title: string;
  description?: string;
}

export interface ConversationMessageLabels {
  thinking?: string;
  reasoning?: string;
  questionnaire?: string;
  responseSingular?: string;
  responsePlural?: string;
  sending?: string;
  queued?: string;
  copy?: string;
  summary?: string;
  feedback?: string;
  feedbackPlaceholder?: string;
  feedbackSubmit?: string;
  feedbackSuccess?: string;
}

export type QuickFeedbackSentiment = "positive" | "negative";

export interface QuickFeedbackData {
  content: string;
  sentiment: QuickFeedbackSentiment;
}

export interface ConversationMessage {
  id: string;
  role: ConversationMessageRole;
  content: string;
  timestamp?: string;
  messageType?: string;
  seeds?: ConversationUserSeed[];
  metadata?: Record<string, unknown>;
  deliveryStatus?: "sending" | "queued" | "processing" | "delivered";
}

export interface ConversationMessageProps {
  role: ConversationMessageRole;
  content: string;
  timestamp?: string;
  timeZone?: string;
  isStreaming?: boolean;
  messageType?: string;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  seeds?: ConversationUserSeed[];
  deliveryStatus?: "sending" | "queued" | "processing" | "delivered";
  isLastMessage?: boolean;
  isSessionCompleted?: boolean;
  labels?: ConversationMessageLabels;
  markdownComponents?: Record<string, React.ComponentType<Record<string, unknown>>>;
  messageId?: string;
  onFeedback?: (messageId: string, data: QuickFeedbackData) => void;
}

export interface ConversationTimelineProps {
  messages: ConversationMessage[];
  timeZone?: string;
  isStreaming: boolean;
  streamingContent?: string;
  streamingThinkingContent?: string;
  streamingBlocks?: StreamingBlock[];
  completedTurnBlocks?: StreamingBlock[][];
  thinkingBlockIsCollapsed?: (id: string) => boolean;
  thinkingBlockToggleCollapse?: (id: string) => void;
  isSessionCompleted?: boolean;
  labels?: ConversationMessageLabels;
  markdownComponents?: Record<string, React.ComponentType<Record<string, unknown>>>;
  className?: string;
  onFeedback?: (messageId: string, data: QuickFeedbackData) => void;
}
