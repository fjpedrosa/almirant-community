"use client";

import { useCallback, useRef } from "react";

// ---------------------------------------------------------------------------
// Hook: useQuestionCard
// ---------------------------------------------------------------------------
// Manages form submission logic for the QuestionCard component.
// Extracted from QuestionCard.tsx to keep the .tsx file purely presentational.
// ---------------------------------------------------------------------------

export const useQuestionCard = (onSubmitFreeText: (text: string) => void) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFormSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const input = inputRef.current;
      if (!input) return;
      const value = input.value.trim();
      if (!value) return;
      onSubmitFreeText(value);
      input.value = "";
    },
    [onSubmitFreeText],
  );

  return {
    inputRef,
    onFormSubmit: handleFormSubmit,
  };
};
