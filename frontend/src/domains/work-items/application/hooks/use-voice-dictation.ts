"use client";

import { useCallback, useRef } from "react";

interface UseVoiceDictationReturn {
  handleStartDictation: () => void;
  handleInterimTranscript: (text: string) => void;
  handleTranscript: (text: string) => void;
}

export const useVoiceDictation = (
  onChange: (value: string) => void,
  getValue: () => string
): UseVoiceDictationReturn => {
  const baseValueRef = useRef("");
  const lastInterimRef = useRef("");

  const addSeparator = (base: string) =>
    base && !base.endsWith(" ") && !base.endsWith("\n") ? " " : "";

  const syncBase = useCallback(() => {
    const currentValue = getValue();
    const lastInterim = lastInterimRef.current;

    if (lastInterim) {
      const sep = addSeparator(baseValueRef.current);
      const expectedSuffix = sep + lastInterim;
      if (currentValue.endsWith(expectedSuffix)) {
        baseValueRef.current = currentValue.slice(0, currentValue.length - expectedSuffix.length);
      } else {
        baseValueRef.current = currentValue;
      }
    } else {
      baseValueRef.current = currentValue;
    }

    lastInterimRef.current = "";
  }, [getValue]);

  const handleStartDictation = useCallback(() => {
    baseValueRef.current = getValue();
    lastInterimRef.current = "";
  }, [getValue]);

  const handleInterimTranscript = useCallback(
    (text: string) => {
      syncBase();
      const sep = addSeparator(baseValueRef.current);
      onChange(baseValueRef.current + sep + text);
      lastInterimRef.current = text;
    },
    [onChange, syncBase]
  );

  const handleTranscript = useCallback(
    (text: string) => {
      syncBase();
      const sep = addSeparator(baseValueRef.current);
      baseValueRef.current = baseValueRef.current + sep + text;
      lastInterimRef.current = "";
      onChange(baseValueRef.current);
    },
    [onChange, syncBase]
  );

  return {
    handleStartDictation,
    handleInterimTranscript,
    handleTranscript,
  };
};
