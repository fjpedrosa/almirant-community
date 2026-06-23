import type { AgentLogChunk } from "@/domains/shared/domain/types";
import type {
  ConversationMessage,
  ConversationUserSeed,
} from "@/domains/shared/domain/conversation-types";
import { stripDanglingBacktickBoundaryLines } from "./transcript-content-sanitizer";

const LEGACY_CONTROL_TOKEN_LINE_PATTERN =
  /\[(?:STEP|WAVE_START|WAVE_END|AGENT_DONE|WAITING|RESPONSE_COMPLETE|DONE|WARN|ERROR|QUESTION|OPTIONS)\][^\n]*/g;
const INTERNAL_PROMPT_BLOCK_PATTERNS = [
  /<skill\s+name=[\s\S]*?<\/skill>\s*/gi,
  /<session_recovery>[\s\S]*?<\/session_recovery>\s*/gi,
  /<previous_conversation>[\s\S]*?<\/previous_conversation>\s*/gi,
  /^Seed IDs for context.*$/gim,
  /^\/[^\n]+$/gim,
];

const stripLegacyControlTokenLines = (content: string): string =>
  stripDanglingBacktickBoundaryLines(content.replace(LEGACY_CONTROL_TOKEN_LINE_PATTERN, ""))
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const stripLocalePreamble = (content: string): string => {
  if (!content.startsWith("IMPORTANT: You MUST respond in")) {
    return content.trim();
  }

  const separatorIndex = content.indexOf("\n\n");
  if (separatorIndex < 0) {
    return "";
  }

  return content.slice(separatorIndex + 2).trim();
};

const extractVisiblePrompt = (content: string): string | null => {
  let cleaned = stripLocalePreamble(content);

  for (const pattern of INTERNAL_PROMPT_BLOCK_PATTERNS) {
    cleaned = cleaned.replace(pattern, "");
  }

  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
  return cleaned.length > 0 ? cleaned : null;
};

export const chunksToConversationMessages = (
  chunks: AgentLogChunk[],
): ConversationMessage[] => {
  if (chunks.length === 0) return [];

  const sortedChunks = [...chunks].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  const messages: ConversationMessage[] = [];
  let currentAssistantContent = "";
  let currentAssistantStart: string | null = null;
  let promptSentMessage: { content: string; timestamp: string } | null = null;
  let hasUserMessage = false;
  let messageCounter = 0;

  const flushAssistant = () => {
    const cleaned = stripLegacyControlTokenLines(currentAssistantContent);
    if (cleaned) {
      messages.push({
        id: `session-assistant-${messageCounter++}`,
        role: "assistant",
        content: cleaned,
        timestamp: currentAssistantStart ?? new Date().toISOString(),
      });
    }
    currentAssistantContent = "";
    currentAssistantStart = null;
  };

  for (const chunk of sortedChunks) {
    if (
      chunk.phase === "session" &&
      chunk.eventType === "prompt.sent" &&
      !promptSentMessage &&
      chunk.message
    ) {
      const realPrompt = (chunk.payload?.prompt as string) ?? chunk.message;
      const visiblePrompt = extractVisiblePrompt(realPrompt);
      if (!visiblePrompt) {
        continue;
      }
      promptSentMessage = {
        content: visiblePrompt,
        timestamp: chunk.timestamp,
      };
    }

    if (chunk.phase !== "transcript") continue;

    if (chunk.contentType === "user_input") {
      flushAssistant();
      hasUserMessage = true;
      messages.push({
        id: `session-user-${messageCounter++}`,
        role: "user",
        content: chunk.message,
        timestamp: chunk.timestamp,
        seeds: (chunk.payload?.seeds as ConversationUserSeed[] | undefined)?.length
          ? (chunk.payload?.seeds as ConversationUserSeed[])
          : undefined,
        metadata: chunk.payload ?? undefined,
      });
      continue;
    }

    if (chunk.contentType === "thinking" || chunk.contentType === "tool_use") {
      flushAssistant();
      continue;
    }

    // Skip lifecycle event chunks — they are rendered as blocks by
    // parseChunksToStreamingBlocks, not as assistant text.
    if (
      chunk.eventType === "subagent.spawn" ||
      chunk.eventType === "subagent.complete" ||
      chunk.eventType === "agent.bash.execute" ||
      chunk.eventType === "agent.bash.output"
    ) {
      continue;
    }

    if (!chunk.message) continue;
    if (!currentAssistantStart) currentAssistantStart = chunk.timestamp;
    currentAssistantContent += chunk.message;
  }

  flushAssistant();

  if (!hasUserMessage && promptSentMessage) {
    messages.unshift({
      id: "session-user-fallback",
      role: "user",
      content: promptSentMessage.content,
      timestamp: promptSentMessage.timestamp,
    });
  }

  return messages;
};
