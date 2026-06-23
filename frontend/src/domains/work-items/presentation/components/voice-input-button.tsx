"use client";

import { Loader2, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTranslations } from "next-intl";
import { useSpeechToText } from "../../application/hooks/use-speech-to-text";

interface VoiceInputButtonProps {
  onTranscript: (text: string) => void;
  onInterimTranscript?: (text: string) => void;
  onStartDictation?: () => void;
  className?: string;
}

export const VoiceInputButton: React.FC<VoiceInputButtonProps> = ({
  onTranscript,
  onInterimTranscript,
  onStartDictation,
  className,
}) => {
  const t = useTranslations("workItems.voice");
  const { isListening, isReady, startListening, stopListening, isSupported, error } =
    useSpeechToText(onTranscript, onInterimTranscript);

  if (!isSupported) return null;

  const handleClick = () => {
    if (isListening) {
      stopListening();
    } else {
      onStartDictation?.();
      startListening();
    }
  };

  const isActivating = isListening && !isReady;

  const tooltipText = error
    ?? (isActivating ? t("activating") : isListening ? t("stopDictation") : t("dictate"));

  const micIcon = isActivating
    ? <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
    : isListening
      ? <Mic className="h-4 w-4 text-destructive animate-pulse" />
      : <Mic className="h-4 w-4 text-muted-foreground" />;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={className}
          onClick={handleClick}
          aria-label={tooltipText}
        >
          {micIcon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {tooltipText}
      </TooltipContent>
    </Tooltip>
  );
};
