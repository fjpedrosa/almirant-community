"use client";

import { useState, useCallback, useRef } from "react";
import { API_BASE, getSessionToken } from "@/lib/api/client";
import type {
  SkillChatMessage,
  SkillChatState,
  GeneratedSkill,
} from "../../domain/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UseSkillChatOptions {
  /** Existing skill to refine (refinement mode) */
  currentSkill?: { name: string; description: string; content: string };
  /** Provider key ID for model selection */
  providerKeyId?: string;
  /** Model name override */
  modelName?: string;
}

interface UseSkillChatReturn {
  messages: SkillChatMessage[];
  status: SkillChatState;
  generatedSkill: GeneratedSkill | null;
  error: string | null;
  sendMessage: (content: string) => Promise<void>;
  reset: () => void;
  clearError: () => void;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

const generateId = (): string => {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
};

// ---------------------------------------------------------------------------
// SSE Event Parser
// ---------------------------------------------------------------------------

interface SSEEvent {
  event: string;
  data: string;
}

/**
 * Parses SSE events from a text buffer.
 * Returns parsed events and the remaining unparsed buffer.
 */
const parseSSEEvents = (
  buffer: string
): { events: SSEEvent[]; remaining: string } => {
  const events: SSEEvent[] = [];
  const parts = buffer.split("\n\n");

  // The last part may be incomplete, keep it as remaining
  const remaining = parts.pop() ?? "";

  for (const part of parts) {
    if (!part.trim()) continue;

    let eventType = "message";
    let data = "";

    const lines = part.split("\n");
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        eventType = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        data = line.slice(6);
      }
    }

    if (data) {
      events.push({ event: eventType, data });
    }
  }

  return { events, remaining };
};

// ---------------------------------------------------------------------------
// Hook: useSkillChat
// ---------------------------------------------------------------------------

/**
 * Manages the chat conversation state for AI-assisted skill creation.
 *
 * Usage:
 * ```tsx
 * const { messages, status, generatedSkill, sendMessage, reset } = useSkillChat();
 *
 * // Send a message to the AI
 * await sendMessage("Create a React component skill");
 *
 * // Check for generated skill
 * if (generatedSkill) {
 *   // Use generatedSkill.name, .description, .content
 * }
 *
 * // Reset conversation
 * reset();
 * ```
 */
export const useSkillChat = (
  options: UseSkillChatOptions = {}
): UseSkillChatReturn => {
  const { currentSkill, providerKeyId, modelName } = options;

  const [messages, setMessages] = useState<SkillChatMessage[]>([]);
  const [status, setStatus] = useState<SkillChatState>("idle");
  const [generatedSkill, setGeneratedSkill] = useState<GeneratedSkill | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  // Abort controller ref for cancelling ongoing requests
  const abortControllerRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async (content: string): Promise<void> => {
      const trimmedContent = content.trim();
      if (!trimmedContent) return;

      // Cancel any ongoing request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      // Clear previous error
      setError(null);

      // Add user message
      const userMessage: SkillChatMessage = {
        id: generateId(),
        role: "user",
        content: trimmedContent,
        timestamp: new Date(),
      };

      // Create assistant message placeholder
      const assistantMessageId = generateId();
      const assistantMessage: SkillChatMessage = {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      setStatus("sending");

      try {
        const token = getSessionToken();

        // Build messages array for API (excluding the empty assistant placeholder)
        const apiMessages = [...messages, userMessage].map((msg) => ({
          role: msg.role,
          content: msg.content,
        }));

        const response = await fetch(`${API_BASE}/ai/generate-skill`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            messages: apiMessages,
            currentSkill,
            providerKeyId,
            modelName,
          }),
          signal: abortController.signal,
        });

        if (!response.ok) {
          let errorMessage = `Request failed with status ${response.status}`;
          try {
            const errorData = (await response.json()) as { error?: string };
            if (errorData.error) {
              errorMessage = errorData.error;
            }
          } catch {
            // Ignore JSON parse errors
          }
          throw new Error(errorMessage);
        }

        if (!response.body) {
          throw new Error("Response body is empty");
        }

        setStatus("generating");

        // Read SSE stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = "";
        let accumulatedContent = "";

        while (true) {
          const { done, value } = await reader.read();

          if (done) break;

          sseBuffer += decoder.decode(value, { stream: true });
          const { events, remaining } = parseSSEEvents(sseBuffer);
          sseBuffer = remaining;

          for (const event of events) {
            switch (event.event) {
              case "message": {
                try {
                  const parsed = JSON.parse(event.data) as { content: string };
                  accumulatedContent += parsed.content;
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantMessageId
                        ? { ...msg, content: accumulatedContent }
                        : msg
                    )
                  );
                } catch {
                  // Ignore malformed message events
                }
                break;
              }

              case "skill": {
                try {
                  const parsed = JSON.parse(event.data) as GeneratedSkill;
                  setGeneratedSkill({
                    name: parsed.name,
                    description: parsed.description,
                    content: parsed.content,
                  });
                } catch {
                  // Ignore malformed skill events
                }
                break;
              }

              case "error": {
                try {
                  const parsed = JSON.parse(event.data) as { message: string };
                  setError(parsed.message);
                  setStatus("error");
                } catch {
                  setError("Unknown streaming error");
                  setStatus("error");
                }
                break;
              }

              case "done": {
                // Finalize the assistant message with final timestamp
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMessageId
                      ? { ...msg, timestamp: new Date() }
                      : msg
                  )
                );
                setStatus("idle");
                break;
              }
            }
          }
        }

        // Ensure we end in idle state if stream completes without done event
        setStatus((prev) => (prev === "generating" ? "idle" : prev));
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          // Request was cancelled, don't update state
          return;
        }

        const errorMessage =
          err instanceof Error ? err.message : "Failed to send message";
        setError(errorMessage);
        setStatus("error");

        // Remove the empty assistant message on error
        setMessages((prev) =>
          prev.filter((msg) => msg.id !== assistantMessageId)
        );
      } finally {
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null;
        }
      }
    },
    [messages, currentSkill, providerKeyId, modelName]
  );

  const reset = useCallback((): void => {
    // Cancel any ongoing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    setMessages([]);
    setStatus("idle");
    setGeneratedSkill(null);
    setError(null);
  }, []);

  const clearError = useCallback((): void => {
    setError(null);
    if (status === "error") {
      setStatus("idle");
    }
  }, [status]);

  return {
    messages,
    status,
    generatedSkill,
    error,
    sendMessage,
    reset,
    clearError,
  };
};
