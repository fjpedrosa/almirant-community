"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useSkillChat } from "../../application/hooks/use-skill-chat";
import { SkillChatCreator } from "../components/skill-chat-creator";
import type { GeneratedSkill } from "../../domain/types";

interface SkillChatCreatorContainerProps {
  /** Callback when user saves the generated skill */
  onSaveSkill: (skill: GeneratedSkill) => void;
  /** Existing skill to refine (refinement mode) */
  currentSkill?: { name: string; description: string; content: string };
  /** Provider key ID for model selection */
  providerKeyId?: string;
  /** Model name override */
  modelName?: string;
}

/**
 * Container for SkillChatCreator that wires up the useSkillChat hook
 * with the presentational component.
 *
 * Usage:
 * ```tsx
 * <SkillChatCreatorContainer
 *   onSaveSkill={(skill) => createSkillMutation.mutate(skill)}
 *   currentSkill={existingSkill} // optional, for refinement
 * />
 * ```
 */
export const SkillChatCreatorContainer = ({
  onSaveSkill,
  currentSkill,
  providerKeyId,
  modelName,
}: SkillChatCreatorContainerProps) => {
  const [inputValue, setInputValue] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const {
    messages,
    status,
    generatedSkill,
    error,
    sendMessage,
    reset,
    clearError,
  } = useSkillChat({
    currentSkill,
    providerKeyId,
    modelName,
  });

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const handleSendMessage = useCallback(
    async (content: string) => {
      setInputValue("");
      await sendMessage(content);
    },
    [sendMessage]
  );

  const handleReset = useCallback(() => {
    reset();
    setInputValue("");
  }, [reset]);

  return (
    <SkillChatCreator
      messages={messages}
      status={status}
      generatedSkill={generatedSkill}
      error={error}
      onSendMessage={handleSendMessage}
      onReset={handleReset}
      onClearError={clearError}
      onSaveSkill={onSaveSkill}
      inputValue={inputValue}
      onInputChange={setInputValue}
      scrollRef={scrollRef}
    />
  );
};
