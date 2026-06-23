import { useState, useCallback } from "react";
import { CheckCircle2, Clock, Copy, Check, Loader2, MessageSquareWarning, ThumbsUp, ThumbsDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { MarkdownPreview } from "@/domains/shared/presentation/components/markdown-preview";
import { ThinkingBlock } from "@/domains/shared/presentation/components/streaming-blocks";
import type {
  ConversationMessageLabels,
  ConversationMessageProps,
  ConversationUserSeed,
  QuickFeedbackSentiment,
} from "../../domain/conversation-types";
import { useTypewriter } from "../../application/hooks/use-typewriter";

const DEFAULT_LABELS: Required<
  Omit<ConversationMessageLabels, "summary">
> = {
  thinking: "Thinking...",
  reasoning: "Reasoning",
  questionnaire: "Questionnaire",
  responseSingular: "response",
  responsePlural: "responses",
  sending: "Sending...",
  queued: "Queued",
  copy: "Copy message",
  feedback: "Send feedback",
  feedbackPlaceholder: "What could be improved?",
  feedbackSubmit: "Submit",
  feedbackSuccess: "Thanks!",
};

const CopyMessageButton: React.FC<{
  content: string;
  copyLabel: string;
}> = ({ content, copyLabel }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback silently
    }
  }, [content]);

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8 text-muted-foreground/50 hover:text-muted-foreground"
      onClick={handleCopy}
      aria-label={copyLabel}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </Button>
  );
};

interface QuickFeedbackButtonProps {
  feedbackLabel: string;
  placeholderLabel: string;
  submitLabel: string;
  successLabel: string;
  onSubmit: (content: string, sentiment: QuickFeedbackSentiment) => void;
}

const QuickFeedbackButton: React.FC<QuickFeedbackButtonProps> = ({
  feedbackLabel,
  placeholderLabel,
  submitLabel,
  successLabel,
  onSubmit,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [sentiment, setSentiment] = useState<QuickFeedbackSentiment>("negative");
  const [feedbackText, setFeedbackText] = useState("");
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleSubmit = useCallback(() => {
    if (!feedbackText.trim()) return;
    onSubmit(feedbackText.trim(), sentiment);
    setIsSubmitted(true);
    setTimeout(() => {
      setIsOpen(false);
      setIsSubmitted(false);
      setFeedbackText("");
      setSentiment("negative");
    }, 1500);
  }, [feedbackText, sentiment, onSubmit]);

  const handleOpenChange = useCallback((open: boolean) => {
    setIsOpen(open);
    if (!open) {
      // Reset state when closing
      setIsSubmitted(false);
      setFeedbackText("");
      setSentiment("negative");
    }
  }, []);

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          data-chat-feedback-trigger=""
          className="size-8 text-muted-foreground/50 hover:text-muted-foreground"
          aria-label={feedbackLabel}
        >
          <MessageSquareWarning className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        data-chat-feedback-content=""
        className="w-64 p-3"
      >
        {isSubmitted ? (
          <div className="flex items-center justify-center gap-2 py-2">
            <Check className="size-4 text-green-500" />
            <span className="text-sm font-medium text-green-500">{successLabel}</span>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {/* Sentiment selector */}
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant={sentiment === "positive" ? "default" : "ghost"}
                size="sm"
                className={`h-7 px-2 ${sentiment === "positive" ? "bg-green-600 hover:bg-green-700 text-white" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setSentiment("positive")}
              >
                <ThumbsUp className="size-3.5 mr-1" />
                <span className="text-xs">Good</span>
              </Button>
              <Button
                type="button"
                variant={sentiment === "negative" ? "default" : "ghost"}
                size="sm"
                className={`h-7 px-2 ${sentiment === "negative" ? "bg-amber-600 hover:bg-amber-700 text-white" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setSentiment("negative")}
              >
                <ThumbsDown className="size-3.5 mr-1" />
                <span className="text-xs">Needs work</span>
              </Button>
            </div>
            {/* Textarea */}
            <Textarea
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              placeholder={placeholderLabel}
              rows={2}
              className="text-sm resize-none"
            />
            {/* Submit button */}
            <Button
              type="button"
              size="sm"
              className="h-7"
              disabled={!feedbackText.trim()}
              onClick={handleSubmit}
            >
              {submitLabel}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};

const noop = () => {};

const DEFAULT_TRANSCRIPT_TIME_ZONE = "Europe/Madrid";

const resolveTranscriptTimeZone = (timeZone?: string): string => {
  if (timeZone?.trim()) return timeZone;
  return DEFAULT_TRANSCRIPT_TIME_ZONE;
};

const formatTranscriptTime = (timestamp: string | undefined, timeZone?: string): string | null => {
  if (!timestamp) return null;

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;

  const resolvedTimeZone = resolveTranscriptTimeZone(timeZone);
  const formatterOptions: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: resolvedTimeZone,
  };

  try {
    return new Intl.DateTimeFormat("es-ES", formatterOptions).format(date);
  } catch {
    return new Intl.DateTimeFormat("es-ES", {
      ...formatterOptions,
      timeZone: DEFAULT_TRANSCRIPT_TIME_ZONE,
    }).format(date);
  }
};

const MessageTimestamp: React.FC<{
  timestamp?: string;
  timeZone?: string;
}> = ({ timestamp, timeZone }) => {
  const formattedTime = formatTranscriptTime(timestamp, timeZone);
  if (!timestamp || !formattedTime) return null;

  return (
    <time
      dateTime={timestamp}
      title={resolveTranscriptTimeZone(timeZone)}
      className="text-xs text-muted-foreground px-1 tabular-nums"
    >
      {formattedTime}
    </time>
  );
};

const SeedCards: React.FC<{ seeds: ConversationUserSeed[] }> = ({ seeds }) => (
  <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-thin scrollbar-thumb-muted-foreground/20">
    {seeds.map((seed) => (
      <div
        key={seed.id}
        className="flex-shrink-0 w-52 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2"
      >
        <p className="text-sm font-medium text-foreground truncate">{seed.title}</p>
        {seed.description && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{seed.description}</p>
        )}
      </div>
    ))}
  </div>
);

export const ConversationMessage: React.FC<ConversationMessageProps> = ({
  role,
  content,
  timestamp,
  timeZone,
  isStreaming,
  messageType,
  isCollapsed,
  onToggleCollapse,
  seeds,
  deliveryStatus,
  isLastMessage,
  isSessionCompleted,
  labels,
  markdownComponents,
  messageId,
  onFeedback,
}) => {
  const mergedLabels = {
    ...DEFAULT_LABELS,
    ...labels,
  };
  const isUser = role === "user";
  const isAssistantText = !isUser && messageType !== "thinking";
  const { content: revealedContent } = useTypewriter(
    content,
    isAssistantText && (isStreaming ?? false),
  );

  const handleFeedbackSubmit = useCallback(
    (feedbackContent: string, sentiment: QuickFeedbackSentiment) => {
      if (onFeedback && messageId) {
        onFeedback(messageId, { content: feedbackContent, sentiment });
      }
    },
    [onFeedback, messageId]
  );

  const showFeedbackButton = onFeedback && messageId && !isUser;

  if (messageType === "thinking") {
    return (
      <div className="flex flex-col gap-0 w-full items-start">
        <ThinkingBlock
          content={content}
          isStreaming={isStreaming ?? false}
          isCollapsed={isCollapsed ?? false}
          onToggleCollapse={onToggleCollapse ?? noop}
          thinkingLabel={mergedLabels.thinking}
          reasoningLabel={mergedLabels.reasoning}
        />
        <MessageTimestamp timestamp={timestamp} timeZone={timeZone} />
      </div>
    );
  }

  if (isUser) {
    const qaLines = content.split("\n").filter((line: string) => line.includes(" → "));
    const isQAAnswer = (messageType === "answer" || qaLines.length > 0) && !seeds?.length;

    if (isQAAnswer && qaLines.length > 0) {
      return (
        <div className="flex flex-col gap-1 w-full">
          <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 space-y-3">
            <p className="text-xs font-medium text-primary/70 uppercase tracking-wide">
              {mergedLabels.questionnaire} &middot; {qaLines.length}{" "}
              {qaLines.length === 1
                ? mergedLabels.responseSingular
                : mergedLabels.responsePlural}
            </p>
            <div className="space-y-2.5">
              {qaLines.map((line: string, index: number) => {
                const [question, ...answerParts] = line.split(" → ");
                const answer = answerParts.join(" → ");
                return (
                  <div
                    key={index}
                    className="rounded-lg border border-border/30 bg-background/50 px-3 py-2"
                  >
                    <p className="text-sm font-medium text-foreground">{question}</p>
                    <p className="text-sm font-medium text-primary mt-0.5">{answer}</p>
                  </div>
                );
              })}
            </div>
          </div>
          <MessageTimestamp timestamp={timestamp} timeZone={timeZone} />
        </div>
      );
    }

    return (
      <div className="group/msg flex flex-col gap-1 w-full items-end">
        <div className="max-w-[80%] rounded-2xl bg-muted/50 px-4 py-2.5 space-y-2">
          <p className="text-base whitespace-pre-wrap break-words text-foreground">
            {content}
          </p>
          {seeds && seeds.length > 0 && <SeedCards seeds={seeds} />}
        </div>
        <div className="relative flex items-center gap-1 flex-row-reverse">
          {deliveryStatus === "sending" && (
            <span className="text-xs text-muted-foreground animate-pulse motion-reduce:animate-none">
              {mergedLabels.sending}
            </span>
          )}
          {deliveryStatus === "queued" && (
            <span className="text-xs text-amber-400/80 flex items-center gap-1">
              <Clock className="size-3" />
              {mergedLabels.queued}
            </span>
          )}
          {deliveryStatus === "processing" && (
            <span className="text-xs text-primary/80 flex items-center gap-1">
              <Loader2 className="size-3 animate-spin" />
            </span>
          )}
          <MessageTimestamp timestamp={timestamp} timeZone={timeZone} />
          <div className="absolute right-full mr-1 hidden md:hidden md:group-hover/msg:block">
            <CopyMessageButton
              content={content}
              copyLabel={mergedLabels.copy}
            />
          </div>
        </div>
      </div>
    );
  }

  const hasVisibleContent = revealedContent.trim().length > 0;
  const isSummary =
    Boolean(labels?.summary) &&
    isLastMessage &&
    isSessionCompleted &&
    messageType !== "thinking";

  if (isSummary) {
    return (
      <div className="group/msg flex flex-col gap-1 w-full items-start">
        <div className="w-full rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
          <p className="text-xs font-medium text-primary/70 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <CheckCircle2 className="size-3.5" />
            {labels?.summary}
          </p>
          {hasVisibleContent && (
            <div className="text-base text-foreground">
              <MarkdownPreview
                content={revealedContent}
                size="base"
                components={markdownComponents}
              />
            </div>
          )}
        </div>
        <div className="relative flex items-center gap-1">
          <MessageTimestamp timestamp={timestamp} timeZone={timeZone} />
          {hasVisibleContent && (
            <div className="absolute left-full ml-1 hidden md:hidden md:group-hover/msg:flex md:has-[[data-state=open]]:flex items-center gap-0.5">
              <CopyMessageButton
                content={content}
                copyLabel={mergedLabels.copy}
              />
              {showFeedbackButton && (
                <QuickFeedbackButton
                  feedbackLabel={mergedLabels.feedback}
                  placeholderLabel={mergedLabels.feedbackPlaceholder}
                  submitLabel={mergedLabels.feedbackSubmit}
                  successLabel={mergedLabels.feedbackSuccess}
                  onSubmit={handleFeedbackSubmit}
                />
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="group/msg flex flex-col gap-1 w-full items-start">
      {hasVisibleContent && (
        <div className="w-full text-base text-foreground">
          <MarkdownPreview
            content={revealedContent}
            size="base"
            components={markdownComponents}
          />
        </div>
      )}
      {(timestamp || (hasVisibleContent && !isStreaming)) && (
        <div className="relative flex items-center gap-1">
          <MessageTimestamp timestamp={timestamp} timeZone={timeZone} />
          {hasVisibleContent && !isStreaming && (
            <div className="absolute left-full ml-1 hidden md:hidden md:group-hover/msg:flex md:has-[[data-state=open]]:flex items-center gap-0.5">
              <CopyMessageButton
                content={content}
                copyLabel={mergedLabels.copy}
              />
              {showFeedbackButton && (
                <QuickFeedbackButton
                  feedbackLabel={mergedLabels.feedback}
                  placeholderLabel={mergedLabels.feedbackPlaceholder}
                  submitLabel={mergedLabels.feedbackSubmit}
                  successLabel={mergedLabels.feedbackSuccess}
                  onSubmit={handleFeedbackSubmit}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
