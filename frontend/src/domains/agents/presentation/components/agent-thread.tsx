"use client";

import { MessageSquare } from "lucide-react";
import { useTranslations } from "next-intl";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AgentQuestionMessage } from "./agent-question-message";
import { AgentStatusMessage } from "./agent-status-message";
import { AgentAnswerMessage } from "./agent-answer-message";
import type { AgentThreadProps, WorkerInteraction } from "../../domain/types";

const EmptyThread: React.FC<{ message: string }> = ({ message }) => (
  <div className="flex flex-col items-center justify-center py-12 text-center">
    <MessageSquare className="mb-3 h-10 w-10 text-muted-foreground" />
    <p className="text-sm text-muted-foreground">{message}</p>
  </div>
);

const InteractionEntry: React.FC<{
  interaction: WorkerInteraction;
  onRespond: (interactionId: string, answer: string) => void;
  isResponding: boolean;
}> = ({ interaction, onRespond, isResponding }) => {
  if (
    interaction.status === "expired" ||
    interaction.status === "cancelled"
  ) {
    return <AgentStatusMessage interaction={interaction} />;
  }

  if (interaction.status === "answered") {
    return (
      <div className="flex flex-col gap-2">
        <AgentQuestionMessage
          interaction={interaction}
          onRespond={onRespond}
          isResponding={false}
        />
        <AgentAnswerMessage interaction={interaction} />
      </div>
    );
  }

  return (
    <AgentQuestionMessage
      interaction={interaction}
      onRespond={onRespond}
      isResponding={isResponding}
    />
  );
};

export const AgentThread: React.FC<AgentThreadProps> = ({
  interactions,
  onRespond,
  isResponding = false,
}) => {
  const t = useTranslations("agents.thread");
  const safeInteractions = Array.isArray(interactions) ? interactions : [];

  if (safeInteractions.length === 0) {
    return <EmptyThread message={t("empty")} />;
  }

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-3 p-4">
        {safeInteractions.map((interaction) => (
          <InteractionEntry
            key={interaction.id}
            interaction={interaction}
            onRespond={onRespond}
            isResponding={isResponding}
          />
        ))}
      </div>
    </ScrollArea>
  );
};
