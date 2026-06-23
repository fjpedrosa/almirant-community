"use client";

import { useCallback, useRef } from "react";
import { VoiceInputButton } from "./voice-input-button";
import { useVoiceDictation } from "../../application/hooks/use-voice-dictation";

interface InlineTitleInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  hasError?: boolean;
  errorMessage?: string;
}

export const InlineTitleInput: React.FC<InlineTitleInputProps> = ({
  value,
  onChange,
  placeholder,
  autoFocus,
  hasError,
  errorMessage,
}) => {
  const valueRef = useRef(value);
  // eslint-disable-next-line react-hooks/refs
  valueRef.current = value;

  const getValue = useCallback(() => valueRef.current, []);
  const { handleStartDictation, handleInterimTranscript, handleTranscript } =
    useVoiceDictation(onChange, getValue);

  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="text-xl font-semibold border-none outline-none focus:ring-0 bg-transparent w-full placeholder:text-muted-foreground/50 pr-9"
      />
      <VoiceInputButton
        onTranscript={handleTranscript}
        onInterimTranscript={handleInterimTranscript}
        onStartDictation={handleStartDictation}
        className="absolute right-0.5 top-1/2 -translate-y-1/2 h-8 w-8"
      />
      {hasError && errorMessage && (
        <p className="text-xs text-destructive mt-1">{errorMessage}</p>
      )}
    </div>
  );
};
