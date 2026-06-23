"use client";

import { useCallback, useRef, useEffect } from "react";
import { Textarea } from "@/components/ui/textarea";
import { VoiceInputButton } from "./voice-input-button";
import { AiFormatButton } from "./ai-format-button";
import { useVoiceDictation } from "../../application/hooks/use-voice-dictation";

interface TextareaWithVoiceProps {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  onAiFormat?: () => void;
  isAiFormatting?: boolean;
}

export const TextareaWithVoice: React.FC<TextareaWithVoiceProps> = ({
  value,
  onChange,
  rows = 3,
  placeholder,
  onAiFormat,
  isAiFormatting,
}) => {
  const valueRef = useRef(value);
  useEffect(() => { valueRef.current = value; }, [value]);

  const getValue = useCallback(() => valueRef.current, []);
  const { handleStartDictation, handleInterimTranscript, handleTranscript } =
    useVoiceDictation(onChange, getValue);

  const hasAiButton = !!onAiFormat;

  return (
    <div className="relative">
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        className={hasAiButton ? "pr-[4.5rem]" : "pr-9"}
      />
      <div className="absolute right-0.5 top-1.5 flex items-center gap-0.5">
        {onAiFormat && (
          <AiFormatButton
            onFormat={onAiFormat}
            isFormatting={isAiFormatting ?? false}
            disabled={!value.trim()}
            className="h-8 w-8"
          />
        )}
        <VoiceInputButton
          onTranscript={handleTranscript}
          onInterimTranscript={handleInterimTranscript}
          onStartDictation={handleStartDictation}
          className="h-8 w-8"
        />
      </div>
    </div>
  );
};
