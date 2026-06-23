"use client";

import { useState, useCallback, useRef } from "react";

// ---------------------------------------------------------------------------
// Hook: useChatInput
// ---------------------------------------------------------------------------
// Manages controlled input state for the chat input component.
// Extracted from ChatInput to keep the .tsx file purely presentational.
// ---------------------------------------------------------------------------

export const useChatInput = (
  onSend: (message: string) => void,
  disabled = false,
  hasAttachedSeeds = false,
  resetKey?: string | null,
) => {
  const activeScope = resetKey ?? null;
  const [draft, setDraft] = useState({ scope: activeScope, value: "" });
  const value = draft.scope === activeScope ? draft.value : "";

  const canSend = (value.trim().length > 0 || hasAttachedSeeds) && !disabled;

  const sendLockRef = useRef(false);
  const handleSend = useCallback(() => {
    if (disabled || sendLockRef.current) return;
    const trimmed = value.trim();
    if (!trimmed && !hasAttachedSeeds) return;
    sendLockRef.current = true;
    const message = trimmed || "Planifica con estos seeds";
    onSend(message);
    setDraft({ scope: activeScope, value: "" });
    setTimeout(() => { sendLockRef.current = false; }, 500);
  }, [value, disabled, hasAttachedSeeds, onSend, activeScope]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return {
    value,
    onChange: (nextValue: string) => setDraft({ scope: activeScope, value: nextValue }),
    canSend,
    onSend: handleSend,
    onKeyDown: handleKeyDown,
  };
};
