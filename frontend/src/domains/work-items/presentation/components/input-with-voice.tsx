"use client";

import { useCallback, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { VoiceInputButton } from "./voice-input-button";
import { useVoiceDictation } from "../../application/hooks/use-voice-dictation";

interface InputWithVoiceProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

export const InputWithVoice: React.FC<InputWithVoiceProps> = ({
  value,
  onChange,
  placeholder,
  autoFocus,
}) => {
  const valueRef = useRef(value);
  useEffect(() => { valueRef.current = value; }, [value]);

  const getValue = useCallback(() => valueRef.current, []);
  const { handleStartDictation, handleInterimTranscript, handleTranscript } =
    useVoiceDictation(onChange, getValue);

  return (
    <div className="relative">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="pr-9"
      />
      <VoiceInputButton
        onTranscript={handleTranscript}
        onInterimTranscript={handleInterimTranscript}
        onStartDictation={handleStartDictation}
        className="absolute right-0.5 top-1/2 -translate-y-1/2 h-8 w-8"
      />
    </div>
  );
};
