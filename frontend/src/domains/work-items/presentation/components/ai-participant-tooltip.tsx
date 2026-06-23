"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AiParticipant } from "../../domain/types";

interface AiParticipantTooltipProps {
  participant: AiParticipant;
  children: React.ReactNode;
}

export const AiParticipantTooltip: React.FC<AiParticipantTooltipProps> = ({
  participant,
  children,
}) => {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs space-y-1 py-2">
        <p className="text-xs font-semibold">{participant.label}</p>
        {participant.isProcessing && (
          <p className="text-[11px] text-primary-foreground/70">
            Procesando...
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
};
