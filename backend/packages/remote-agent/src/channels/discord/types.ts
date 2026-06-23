import type { ChannelAdapter, ChannelMessage, ChannelThread } from "../../core/types";

export const DISCORD_LIMITS = {
  messageContent: 2000,
  threadName: 100,
  embedTitle: 256,
  embedDescription: 4096,
  embedFieldName: 256,
  embedFieldValue: 1024,
  embedFieldCount: 25,
  embedTotalChars: 6000,
} as const;

export type DiscordAutoArchiveDurationMinutes = 60 | 1440 | 4320 | 10080;

export type DiscordApiConfig = {
  botToken: string;
  apiBaseUrl?: string;
  requestTimeoutMs?: number;
  messageEditThrottleMs?: number;
  defaultAutoArchiveMinutes?: DiscordAutoArchiveDurationMinutes;
  userAllowlist?: string[];
  pollIntervalMs?: number;
  responseTimeoutMs?: number;
};

export type DiscordEmbedField = {
  name: string;
  value: string;
  inline?: boolean;
};

export type DiscordEmbed = {
  title?: string;
  description?: string;
  color?: number;
  fields?: DiscordEmbedField[];
  footer?: { text: string };
  timestamp?: string;
};

export type DiscordAllowedMentions = {
  parse?: Array<"users" | "roles" | "everyone">;
  users?: string[];
  roles?: string[];
  replied_user?: boolean;
};

export type DiscordButtonStyle = 1 | 2 | 3 | 4 | 5;

export type DiscordButtonComponent = {
  type: 2;
  style: DiscordButtonStyle;
  label?: string;
  emoji?: { name: string; id?: string; animated?: boolean };
  custom_id?: string;
  url?: string;
  disabled?: boolean;
};

export type DiscordSelectMenuOption = {
  label: string;
  value: string;
  description?: string;
  emoji?: { name: string; id?: string; animated?: boolean };
  default?: boolean;
};

export type DiscordStringSelectComponent = {
  type: 3;
  custom_id: string;
  options: DiscordSelectMenuOption[];
  placeholder?: string;
  min_values?: number;
  max_values?: number;
  disabled?: boolean;
};

export type DiscordActionRowComponent =
  | DiscordButtonComponent
  | DiscordStringSelectComponent;

export type DiscordActionRow = {
  type: 1;
  components: DiscordActionRowComponent[];
};

export type DiscordMessagePayload = {
  content?: string;
  embeds?: DiscordEmbed[];
  allowed_mentions?: DiscordAllowedMentions;
  components?: DiscordActionRow[];
};

export type DiscordContextSummary = {
  branch?: string;
  model?: string;
  status?: string;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  spinner?: string;
};

export type DiscordWaveTreeNode = {
  agent: string;
  taskId: string;
  title: string;
  status?: "pending" | "running" | "success" | "failed";
};

export type DiscordQuestionPrompt = {
  question: string;
  options?: string[];
  jobId?: string;
  interactionId?: string;
};

export type DiscordApiUser = {
  id: string;
  username?: string;
  bot?: boolean;
};

export type DiscordApiMessage = {
  id: string;
  content: string;
  timestamp?: string;
  author?: DiscordApiUser;
};

export type DiscordThreadReply = {
  threadId: string;
  messageId: string;
  userId: string;
  content: string;
  createdAt: string;
};

export type DiscordInteractionSource = {
  waitForResponse: (args: {
    threadId: string;
    requesterId?: string;
    allowlist?: string[];
    timeoutMs: number;
    options?: string[];
  }) => Promise<DiscordThreadReply | null>;
};

export type DiscordRichChannelAdapter = ChannelAdapter & {
  deleteMessage: (threadId: string, messageId: string) => Promise<void>;
  sendRichMessage: (
    threadId: string,
    payload: DiscordMessagePayload
  ) => Promise<ChannelMessage>;
  editRichMessage: (
    threadId: string,
    messageId: string,
    payload: DiscordMessagePayload
  ) => Promise<ChannelMessage>;
  waitForThreadReply: (args: {
    threadId: string;
    requesterId?: string;
    allowlist?: string[];
    afterMessageId?: string;
    timeoutMs?: number;
    pollIntervalMs?: number;
  }) => Promise<DiscordThreadReply | null>;
  listThreadMessages: (args: {
    threadId: string;
    afterMessageId?: string;
    limit?: number;
  }) => Promise<DiscordApiMessage[]>;
};

export type ThreadLifecycleStatus = "completed" | "incomplete" | "failed" | "partial";

export type ThreadOpenSummary = {
  skill: string;
  taskIds: string[];
  requesterId?: string;
  model?: string;
  branch?: string;
};

export type ThreadCloseSummary = {
  status: ThreadLifecycleStatus;
  durationMs?: number;
  tokensUsed?: number;
  filesChanged?: number;
  prUrl?: string;
  notes?: string;
};

export type ThreadManagerLikeAdapter = Pick<
  DiscordRichChannelAdapter,
  "createThread" | "renameThread" | "archiveThread" | "sendMessage" | "sendRichMessage"
>;

export type DiscordChannelMessage = ChannelMessage & {
  raw?: DiscordApiMessage;
};

export type DiscordChannelThread = ChannelThread & {
  raw?: Record<string, unknown>;
};
