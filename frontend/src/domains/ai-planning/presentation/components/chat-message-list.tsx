import { useTranslations } from "next-intl";
import { MessageSquare, ArrowDown, Clock } from "lucide-react";
import { ConversationTimeline } from "@/domains/shared/presentation/components/conversation-timeline";
import { StreamingActivityIndicator } from "@/domains/shared/presentation/components/streaming-blocks";
import type { ChatMessageListProps } from "../../domain/types";

export const ChatMessageList: React.FC<ChatMessageListProps> = ({
  messages,
  streamingContent,
  isStreaming,
  emptyState,
  streamingThinkingContent,
  streamingBlocks,
  completedTurnBlocks,
  bottomRef,
  scrollRef,
  thinkingBlockIsCollapsed,
  thinkingBlockToggleCollapse,
  totalTokens,
  latestActivity,
  processingStartedAt,
  showScrollToBottom,
  onScrollToBottom,
  isSessionCompleted,
  pendingUserMessage,
  onFeedback,
}) => {
  const t = useTranslations("aiPlanning");
  const tFeedback = useTranslations("quickFeedback");
  const labels = {
    thinking: t("thinking"),
    reasoning: t("reasoning"),
    questionnaire: t("questionnaire.title"),
    responseSingular: t("questionnaire.response"),
    responsePlural: t("questionnaire.responses"),
    summary: t("planSummary"),
    feedback: tFeedback("buttonLabel"),
    feedbackPlaceholder: tFeedback("placeholder"),
    feedbackSubmit: tFeedback("submit"),
    feedbackSuccess: tFeedback("success"),
  };

  if (messages.length === 0 && !isStreaming) {
    if (emptyState) {
      return <>{emptyState}</>;
    }

    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground p-8">
        <MessageSquare className="size-10 opacity-40" />
        <p className="text-sm">{t("emptyChat")}</p>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto overflow-x-hidden p-4 px-6 md:px-4 flex flex-col"
    >
      <div className="max-w-3xl mx-auto w-full mt-auto">
        <ConversationTimeline
          className="space-y-4"
          messages={messages}
          streamingContent={streamingContent}
          isStreaming={isStreaming}
          streamingThinkingContent={streamingThinkingContent}
          streamingBlocks={streamingBlocks}
          completedTurnBlocks={completedTurnBlocks}
          thinkingBlockIsCollapsed={thinkingBlockIsCollapsed}
          thinkingBlockToggleCollapse={thinkingBlockToggleCollapse}
          isSessionCompleted={isSessionCompleted}
          labels={labels}
          onFeedback={onFeedback}
        />

        {isStreaming && (
          <StreamingActivityIndicator
            startedAt={processingStartedAt ?? undefined}
            totalTokens={totalTokens}
            latestActivity={latestActivity}
          />
        )}

        {pendingUserMessage && (
          <div className="flex flex-col gap-1 w-full items-end opacity-60">
            <div className="max-w-[80%] rounded-2xl bg-muted/30 border border-border/30 px-4 py-2.5">
              <p className="text-base whitespace-pre-wrap break-words text-foreground/70">
                {pendingUserMessage.content}
              </p>
            </div>
            <div className="flex items-center gap-1.5 flex-row-reverse">
              <span className="text-xs text-amber-400/80 flex items-center gap-1">
                <Clock className="size-3" />
                Queued
              </span>
            </div>
          </div>
        )}

        {pendingUserMessage && !isStreaming && (
          <div className="flex items-start gap-3 w-full">
            <div className="rounded-2xl bg-muted/50 border border-border/40 px-4 py-3 flex items-center gap-1">
              <span
                className="w-2 h-2 rounded-full bg-primary/70 animate-bounce"
                style={{ animationDelay: "0ms", animationDuration: "600ms" }}
              />
              <span
                className="w-2 h-2 rounded-full bg-primary/70 animate-bounce"
                style={{ animationDelay: "150ms", animationDuration: "600ms" }}
              />
              <span
                className="w-2 h-2 rounded-full bg-primary/70 animate-bounce"
                style={{ animationDelay: "300ms", animationDuration: "600ms" }}
              />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {showScrollToBottom && onScrollToBottom && (
        <button
          type="button"
          onClick={onScrollToBottom}
          className="sticky bottom-2 md:bottom-6 left-1/2 -translate-x-1/2 z-10 flex items-center justify-center w-9 h-9 min-w-9 min-h-9 rounded-full bg-foreground/80 text-background border border-border/50 shadow-xl hover:brightness-125 transition-all animate-in fade-in slide-in-from-bottom-2 duration-200 cursor-pointer"
        >
          <ArrowDown className="size-4" />
        </button>
      )}
    </div>
  );
};
