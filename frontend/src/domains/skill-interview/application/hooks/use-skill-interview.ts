"use client";

import { useCallback, useRef, useState } from "react";
import { skillInterviewApi } from "@/lib/api/client";
import type {
  GeneratedSkill,
  GeneratedSkillFrontmatter,
  SkillInterviewMessage,
} from "../../domain/types";

interface SkillInterviewState {
  messages: SkillInterviewMessage[];
  draftMessage: string;
  isStreaming: boolean;
  error: string | null;
  generatedSkill: GeneratedSkill | null;
  hasCopiedSkill: boolean;
  sendMessage: () => Promise<void>;
  setDraftMessage: (value: string) => void;
  clearGeneratedSkill: () => void;
  copyGeneratedSkill: () => Promise<void>;
  downloadGeneratedSkill: () => void;
}

interface ParsedSseEvent {
  event: string;
  data: string;
}

const FRONTMATTER_REGEX =
  /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/;

const generateId = (): string =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const parseSseEvents = (
  buffer: string,
): { events: ParsedSseEvent[]; remaining: string } => {
  const parts = buffer.split("\n\n");
  const remaining = parts.pop() ?? "";

  const events = parts.flatMap((part) => {
    if (!part.trim()) {
      return [];
    }

    let event = "message";
    let data = "";

    for (const line of part.split("\n")) {
      if (line.startsWith("event: ")) {
        event = line.slice(7).trim();
      }

      if (line.startsWith("data: ")) {
        data = line.slice(6);
      }
    }

    return data ? [{ event, data }] : [];
  });

  return { events, remaining };
};

const parseGeneratedSkill = (rawContent: string): GeneratedSkill | null => {
  const trimmedContent = rawContent.trim();
  const match = trimmedContent.match(FRONTMATTER_REGEX);

  if (!match) {
    return null;
  }

  const frontmatter = match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce<Partial<GeneratedSkillFrontmatter>>((acc, line) => {
      const [key, ...valueParts] = line.split(":");

      if (!key || valueParts.length === 0) {
        return acc;
      }

      const value = valueParts.join(":").trim();

      if (key === "name") {
        acc.name = value;
      }

      if (key === "description") {
        acc.description = value;
      }

      if (key === "argument-hint") {
        acc.argumentHint = value;
      }

      return acc;
    }, {});

  if (
    !frontmatter.name
    || !frontmatter.description
    || !frontmatter.argumentHint
  ) {
    return null;
  }

  return {
    rawContent: trimmedContent,
    frontmatter: {
      name: frontmatter.name,
      description: frontmatter.description,
      argumentHint: frontmatter.argumentHint,
    },
    body: match[2].trim(),
  };
};

export const useSkillInterview = (): SkillInterviewState => {
  const [messages, setMessages] = useState<SkillInterviewMessage[]>([]);
  const [draftMessage, setDraftMessage] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedSkill, setGeneratedSkill] = useState<GeneratedSkill | null>(
    null,
  );
  const [hasCopiedSkill, setHasCopiedSkill] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const clearGeneratedSkill = useCallback(() => {
    setGeneratedSkill(null);
    setHasCopiedSkill(false);
  }, []);

  const copyGeneratedSkill = useCallback(async () => {
    if (!generatedSkill) {
      return;
    }

    await navigator.clipboard.writeText(generatedSkill.rawContent);
    setHasCopiedSkill(true);

    window.setTimeout(() => {
      setHasCopiedSkill(false);
    }, 2000);
  }, [generatedSkill]);

  const downloadGeneratedSkill = useCallback(() => {
    if (!generatedSkill) {
      return;
    }

    const blob = new Blob([generatedSkill.rawContent], {
      type: "text/markdown;charset=utf-8",
    });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = "SKILL.md";
    link.click();
    URL.revokeObjectURL(objectUrl);
  }, [generatedSkill]);

  const sendMessage = useCallback(async () => {
    const content = draftMessage.trim();

    if (!content || isStreaming) {
      return;
    }

    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setError(null);
    setGeneratedSkill(null);
    setHasCopiedSkill(false);

    const userMessage: SkillInterviewMessage = {
      id: generateId(),
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };

    const assistantMessageId = generateId();
    const assistantMessage: SkillInterviewMessage = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
    };

    const nextMessages = [...messages, userMessage];

    setDraftMessage("");
    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setIsStreaming(true);

    try {
      const response = await skillInterviewApi.stream(
        {
          messages: nextMessages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        },
        abortController.signal,
      );

      if (!response.body) {
        throw new Error("Empty response body");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulatedAssistantContent = "";

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const { events, remaining } = parseSseEvents(buffer);
        buffer = remaining;

        for (const event of events) {
          if (event.event === "message") {
            const parsed = JSON.parse(event.data) as { content: string };
            accumulatedAssistantContent += parsed.content;

            setMessages((prev) =>
              prev.map((message) =>
                message.id === assistantMessageId
                  ? { ...message, content: accumulatedAssistantContent }
                  : message,
              ),
            );
            continue;
          }

          if (event.event === "skill-generated") {
            const parsed = JSON.parse(event.data) as { content: string };
            const parsedSkill = parseGeneratedSkill(parsed.content);

            if (parsedSkill) {
              setGeneratedSkill(parsedSkill);
            }
            continue;
          }

          if (event.event === "error") {
            const parsed = JSON.parse(event.data) as { message: string };
            setError(parsed.message);
          }
        }
      }
    } catch (errorValue) {
      if (
        errorValue instanceof Error
        && errorValue.name === "AbortError"
      ) {
        return;
      }

      setError(
        errorValue instanceof Error
          ? errorValue.message
          : "Unable to complete the skill interview.",
      );
      setMessages((prev) =>
        prev.filter((message) => message.id !== assistantMessageId),
      );
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
      setIsStreaming(false);
    }
  }, [draftMessage, isStreaming, messages]);

  return {
    messages,
    draftMessage,
    isStreaming,
    error,
    generatedSkill,
    hasCopiedSkill,
    sendMessage,
    setDraftMessage,
    clearGeneratedSkill,
    copyGeneratedSkill,
    downloadGeneratedSkill,
  };
};
