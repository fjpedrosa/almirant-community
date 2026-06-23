import type { ConversationMessage } from "@/domains/shared/domain/conversation-types";
import type { AskHistoryItem } from "../../domain/types";

// ---------------------------------------------------------------------------
// Utility: mapAskToConversation
// ---------------------------------------------------------------------------
// Pure function that converts AskHistoryItem[] into ConversationMessage[] for
// the chat timeline. Each history item produces two messages: user + assistant.
// Ask-specific data (confidence, citations, isAbstention) is stored in metadata.
// ---------------------------------------------------------------------------

export const mapAskToConversation = (
  history: AskHistoryItem[]
): ConversationMessage[] => {
  const messages: ConversationMessage[] = [];

  for (const item of history) {
    // User message
    messages.push({
      id: `${item.id}-user`,
      role: "user",
      content: item.question,
      timestamp: item.createdAt,
    });

    // Assistant message — content and metadata depend on state
    if (item.state === "loading") {
      messages.push({
        id: `${item.id}-assistant`,
        role: "assistant",
        content: "",
        timestamp: item.createdAt,
        deliveryStatus: "processing",
      });
    } else if (item.state === "error") {
      messages.push({
        id: `${item.id}-assistant`,
        role: "assistant",
        content: item.errorMessage ?? "An error occurred.",
        timestamp: item.createdAt,
        metadata: { isError: true },
      });
    } else if (item.response) {
      messages.push({
        id: `${item.id}-assistant`,
        role: "assistant",
        content: item.response.answer,
        timestamp: item.createdAt,
        metadata: {
          confidenceLevel: item.response.confidenceLevel,
          confidence: item.response.confidence,
          citations: item.response.citations,
          isAbstention: item.response.isAbstention,
          sessionId: item.response.sessionId,
        },
      });
    }
  }

  return messages;
};
