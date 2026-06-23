"use client";

import { useTranslations } from "next-intl";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getProviderIconComponent } from "@/domains/shared/presentation/utils/provider-icons";
import type { ParticipantOrAi } from "../../domain/types";
import { ParticipantTooltip } from "./participant-tooltip";
import { AiParticipantTooltip } from "./ai-participant-tooltip";

interface ParticipantAvatarsProps {
  participants: ParticipantOrAi[];
  creator?: { id: string; name: string; image: string | null } | null;
  maxVisible?: number;
}

const isAiParticipant = (p: ParticipantOrAi): p is ParticipantOrAi & { kind: "ai" } =>
  p.kind === "ai";

export const ParticipantAvatars: React.FC<ParticipantAvatarsProps> = ({
  participants,
  creator,
  maxVisible = 3,
}) => {
  const t = useTranslations("workItems");
  type RenderItem =
    | { kind: "creator"; id: string; name: string; image: string | null }
    | { kind: "human"; participant: Exclude<ParticipantOrAi, { kind: "ai" }> }
    | { kind: "ai"; participant: Extract<ParticipantOrAi, { kind: "ai" }> };

  const humanParticipants = participants.filter((participant) => !isAiParticipant(participant));
  const aiParticipants = participants.filter((participant) => isAiParticipant(participant));

  const renderItems: RenderItem[] = [];
  if (creator) {
    renderItems.push({
      kind: "creator",
      id: creator.id,
      name: creator.name,
      image: creator.image,
    });
  }

  for (const participant of humanParticipants) {
    const isCreator = creator?.id === participant.userId;
    if (isCreator) continue;
    renderItems.push({ kind: "human", participant });
  }

  for (const participant of aiParticipants) {
    renderItems.push({ kind: "ai", participant });
  }

  if (renderItems.length === 0) return null;

  const visible = renderItems.slice(0, maxVisible);
  const overflow = renderItems.length - visible.length;

  return (
    <div
      className="flex items-center"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {visible.map((item, index) => {
        if (item.kind === "ai") {
          const participant = item.participant;
          const ProviderIcon = getProviderIconComponent(participant.provider);

          return (
            <AiParticipantTooltip
              key={`ai-${participant.provider}`}
              participant={participant}
            >
              <span className={cn(index > 0 && "-ml-1.5")}>
                <span
                  className={cn(
                    "inline-flex items-center justify-center h-5 w-5 rounded-full border-2 border-card bg-muted",
                    participant.isProcessing && "animate-agent-pulse"
                  )}
                >
                  <ProviderIcon className="h-3 w-3" />
                </span>
              </span>
            </AiParticipantTooltip>
          );
        }

        if (item.kind === "creator") {
          const initials = item.name.charAt(0).toUpperCase();
          return (
            <Tooltip key={`creator-${item.id}`}>
              <TooltipTrigger asChild>
                <span className={cn(index > 0 && "-ml-1.5")}>
                  <Avatar className="h-5 w-5 border-2 border-card ring-[1.5px] ring-offset-1 ring-offset-card ring-violet-500">
                    {item.image ? (
                      <AvatarImage src={item.image} alt={item.name} />
                    ) : null}
                    <AvatarFallback className="text-[9px] font-medium bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p className="text-xs">{t("card.createdBy", { name: item.name })}</p>
              </TooltipContent>
            </Tooltip>
          );
        }

        const { participant } = item;
        const initials = (participant.userName ?? "?").charAt(0).toUpperCase();

        return (
          <ParticipantTooltip
            key={participant.userId}
            participant={participant}
          >
            <span className={cn(index > 0 && "-ml-1.5")}>
              <Avatar className="h-5 w-5 border-2 border-card">
                {participant.userImage ? (
                  <AvatarImage src={participant.userImage} alt={participant.userName ?? "Usuario"} />
                ) : null}
                <AvatarFallback className="text-[9px] font-medium bg-muted text-muted-foreground">
                  {initials}
                </AvatarFallback>
              </Avatar>
            </span>
          </ParticipantTooltip>
        );
      })}

      {overflow > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="-ml-1.5">
              <Avatar className="h-5 w-5 border-2 border-card">
                <AvatarFallback className="text-[9px] font-medium bg-muted text-muted-foreground">
                  +{overflow}
                </AvatarFallback>
              </Avatar>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="space-y-1">
            {renderItems.slice(maxVisible).map((item, itemIndex) => (
              <p
                key={
                  item.kind === "ai"
                    ? `ai-${item.participant.provider}-${itemIndex}`
                    : item.kind === "creator"
                      ? `creator-${item.id}`
                      : item.participant.userId
                }
                className="text-xs"
              >
                {item.kind === "ai"
                  ? item.participant.label
                  : item.kind === "creator"
                    ? `${item.name} (${t("card.creator")})`
                    : (item.participant.userName ?? "Usuario")}
              </p>
            ))}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
};
