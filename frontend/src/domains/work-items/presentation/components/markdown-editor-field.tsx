"use client";

import { useCallback, useRef, useEffect } from "react";
import { RichTextEditor } from "@/components/rich-text-editor";
import { VoiceInputButton } from "./voice-input-button";
import { AiFormatButton } from "./ai-format-button";
import { useVoiceDictation } from "../../application/hooks/use-voice-dictation";

interface MarkdownEditorFieldProps {
  value: string;
  onChange: (value: string) => void;
  height?: number;
  showVoiceInput?: boolean;
  onAiFormat?: () => void;
  isAiFormatting?: boolean;
  onImageUpload?: (file: File) => Promise<string>;
}

export const MarkdownEditorField: React.FC<MarkdownEditorFieldProps> = ({
  value,
  onChange,
  height = 200,
  showVoiceInput = true,
  onAiFormat,
  isAiFormatting,
  onImageUpload,
}) => {
  const valueRef = useRef(value);
  useEffect(() => { valueRef.current = value; }, [value]);

  const getValue = useCallback(() => valueRef.current, []);
  const { handleStartDictation, handleInterimTranscript, handleTranscript } =
    useVoiceDictation(onChange, getValue);

  return (
    <div className="relative overflow-hidden max-w-full">
      <RichTextEditor
        value={value}
        onChange={onChange}
        minHeight={height}
        onImageUpload={onImageUpload}
      />
      {(showVoiceInput || onAiFormat) && (
        <div className="absolute bottom-2 right-2 z-10 flex items-center gap-0.5">
          {onAiFormat && (
            <AiFormatButton
              onFormat={onAiFormat}
              isFormatting={isAiFormatting ?? false}
              disabled={!value.trim()}
            />
          )}
          {showVoiceInput && (
            <VoiceInputButton
              onTranscript={handleTranscript}
              onInterimTranscript={handleInterimTranscript}
              onStartDictation={handleStartDictation}
            />
          )}
        </div>
      )}
    </div>
  );
};
