import { useTranslations } from "next-intl";
import { ConversationMessage } from "@/domains/shared/presentation/components/conversation-message";
import type { ChatMessageProps } from "../../domain/types";

export const ChatMessage: React.FC<ChatMessageProps> = (props) => {
  const t = useTranslations("aiPlanning");

  return (
    <ConversationMessage
      {...props}
      labels={{
        thinking: props.messageType === "thinking" ? (props.thinkingLabel ?? t("thinking")) : undefined,
        reasoning: props.messageType === "thinking" ? (props.reasoningLabel ?? t("reasoning")) : undefined,
        questionnaire: t("questionnaire.title"),
        responseSingular: t("questionnaire.response"),
        responsePlural: t("questionnaire.responses"),
        summary: t("planSummary"),
      }}
    />
  );
};
