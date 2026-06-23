"use client";

import { Loader2, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTranslations } from "next-intl";

// Presentational component for voice recording button.
// Three visual states: idle, recording (red pulse rings), transcribing (spinner).
// All logic is managed by the parent via props.

export interface MicrophoneButtonProps {
  isRecording: boolean;
  isTranscribing: boolean;
  isSupported: boolean;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}

export const MicrophoneButton: React.FC<MicrophoneButtonProps> = ({
  isRecording,
  isTranscribing,
  isSupported,
  onClick,
  disabled = false,
  className,
}) => {
  const t = useTranslations("aiPlanning.voice");

  const getTooltipText = () => {
    if (!isSupported) return t("notSupported");
    if (isTranscribing) return t("transcribing");
    if (isRecording) return t("stopRecording");
    return t("startRecording");
  };

  const isDisabled = disabled || isTranscribing || !isSupported;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={className}
          onClick={onClick}
          disabled={isDisabled}
          aria-label={getTooltipText()}
        >
          <span className="relative flex items-center justify-center">
            {/* Audio pulse rings — visible only while recording */}
            {isRecording && (
              <>
                <span className="absolute size-8 rounded-full border border-red-500/40 animate-ping motion-reduce:animate-none" />
                <span className="absolute size-6 rounded-full border border-red-500/60 animate-pulse motion-reduce:animate-none" />
              </>
            )}
            {isTranscribing ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <Mic
                className={
                  isRecording
                    ? "relative size-5 text-red-500"
                    : "relative size-5 text-muted-foreground"
                }
              />
            )}
          </span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{getTooltipText()}</TooltipContent>
    </Tooltip>
  );
};
