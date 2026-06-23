import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronUp, ChevronDown, MessageCircleQuestion, Pause, Timer } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { useCountdownTimer } from "../../application/hooks/use-countdown-timer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChatMessageList } from "./chat-message-list";
import { ChatInput } from "./chat-input";
import { QuestionWizard } from "./question-wizard";
import { QuestionWizardDrawer } from "./question-wizard-drawer";
import { parseMultiQuestions } from "../../application/utils/parse-multi-questions";
import { GenerationConfirmPanel } from "./generation-confirm-panel";
import { InterruptedBanner } from "./interrupted-banner";
import { SessionEndedBanner } from "./session-ended-banner";
import { ResumeStepper } from "./resume-stepper";
import { SessionCompletedSummary } from "./session-completed-summary";
import type { ChatFullPanelProps } from "../../domain/types";

// Usage:
// <ChatFullPanel
//   providerLabel="Anthropic" model="claude-opus-4-6" showModelBadge
//   messages={messages} streamingContent="" isStreaming={false}
//   onSendMessage={handleSend}
//   showGeneration={false} previewItems={[]} columns={columns}
//   activeColumnId="" activeItemCount={0} isConfirming={false}
//   onUpdateItem={handleUpdate} onRemoveItem={handleRemove}
//   onColumnChange={handleColumn} onConfirmGeneration={handleConfirm}
//   onCancelGeneration={handleCancel}
//   toolbar={<ChatInputToolbar onSeedsClick={openSeeds} />}
// />

// ---------------------------------------------------------------------------
// Collapsible question wizard wrapper
// ---------------------------------------------------------------------------

const QuestionWizardWrapper: React.FC<{
  pendingQuestion: {
    questionId: string;
    questionText: string;
    options: string[];
    questions?: Array<{ text: string; options: string[] }>;
    questionType?: "single_choice" | "multi_choice" | "free_text";
  };
  onAnswerQuestion: (questionId: string, answer: string) => void;
  onCancelQuestion?: () => void;
  isStreaming: boolean;
  isRecording?: boolean;
  isTranscribing?: boolean;
  isVoiceSupported?: boolean;
  onStartRecording?: () => void;
  onStopRecording?: () => void;
  wizardTranscriptRef?: React.MutableRefObject<((text: string) => void) | null>;
}> = ({
  pendingQuestion,
  onAnswerQuestion,
  onCancelQuestion,
  isStreaming,
  isRecording,
  isTranscribing,
  isVoiceSupported,
  onStartRecording,
  onStopRecording,
  wizardTranscriptRef,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const parsed = parseMultiQuestions(
    pendingQuestion.questionText,
    pendingQuestion.options,
    pendingQuestion.questions,
  );
  const totalQuestions = parsed.length;

  return (
    <>
      {/* Collapsed pill — visible when collapsed */}
      {isCollapsed && (
        <div className="px-4 pt-1 pb-2 md:pb-3 shrink-0" style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}>
          <div className="max-w-3xl mx-auto">
            <button
              type="button"
              onClick={() => setIsCollapsed(false)}
              className="w-full flex items-center justify-between gap-3 rounded-2xl border border-border bg-muted/60 px-4 py-3 min-h-[44px] cursor-pointer hover:bg-muted/80 transition-colors"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <MessageCircleQuestion className="size-4 text-primary shrink-0" />
                <span className="text-sm font-medium text-foreground truncate">
                  Pregunta {totalQuestions > 1 ? `1/${totalQuestions}` : "pendiente"}
                </span>
              </div>
              <ChevronUp className="size-4 text-muted-foreground shrink-0" />
            </button>
          </div>
        </div>
      )}

      {/* Expanded wizard — hidden via CSS when collapsed to preserve state */}
      <div className={isCollapsed ? "hidden" : "px-4 pt-1 pb-3 shrink-0"}>
        <div className="max-w-3xl mx-auto rounded-2xl border border-border bg-muted/60 p-4 shadow-lg">
          <QuestionWizard
            key={pendingQuestion.questionId}
            onCollapse={() => setIsCollapsed(true)}
            questionText={pendingQuestion.questionText}
            options={pendingQuestion.options}
            questions={pendingQuestion.questions}
            questionType={pendingQuestion.questionType}
            onSubmitAnswers={(answer) =>
              onAnswerQuestion(pendingQuestion.questionId, answer)
            }
            onCancel={onCancelQuestion}
            isSubmitting={isStreaming}
            isRecording={isRecording}
            isTranscribing={isTranscribing}
            isVoiceSupported={isVoiceSupported}
            onStartRecording={onStartRecording}
            onStopRecording={onStopRecording}
            onTranscriptRef={wizardTranscriptRef}
          />
        </div>
      </div>
    </>
  );
};

// ---------------------------------------------------------------------------
// Countdown badge — shows remaining time before session timeout
// ---------------------------------------------------------------------------

const CountdownBadge: React.FC<{
  formatted: string;
  isWarning: boolean;
  isCritical: boolean;
}> = ({ formatted, isWarning, isCritical }) => (
  <div className={cn(
    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium tabular-nums transition-colors",
    isCritical
      ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400"
      : isWarning
        ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
        : "bg-muted text-muted-foreground"
  )}>
    <Timer className="size-3.5" />
    <span>{formatted}</span>
  </div>
);

export const ChatFullPanel: React.FC<ChatFullPanelProps> = ({
  providerLabel,
  model,
  showModelBadge,
  messages,
  streamingContent,
  isStreaming,
  onSendMessage,
  showGeneration,
  previewItems,
  columns,
  activeColumnId,
  activeItemCount,
  isConfirming,
  onUpdateItem,
  onRemoveItem,
  onColumnChange,
  onConfirmGeneration,
  onCancelGeneration,
  isAlreadyCreated,
  toolbar,
  emptyState,
  pendingQuestion,
  onAnswerQuestion,
  streamingThinkingContent,
  streamingBlocks,
  completedTurnBlocks,
  bottomRef: externalBottomRef,
  scrollRef,
  totalTokens,
  latestActivity,
  processingStartedAt,
  onStop,
  onKill,
  onPause,
  isPaused,
  thinkingBlockIsCollapsed,
  thinkingBlockToggleCollapse,
  chatInputValue,
  chatInputOnChange,
  chatInputCanSend,
  chatInputOnSend,
  chatInputOnKeyDown,
  questionInputRef,
  questionOnFormSubmit,
  showScrollToBottom,
  onScrollToBottom,
  isSessionCompleted,
  completedWorkItems,
  completedWorkItemCount,
  pendingUserMessage,
  isRecording,
  isTranscribing,
  isVoiceSupported,
  onStartRecording,
  onStopRecording,
  mediaStream,
  wizardTranscriptRef,
  isInterrupted,
  isResuming,
  interruptionReason,
  resumeStep,
  onResume,
  isSessionEnded,
  sessionEndReason,
  onRestartSession,
  onNewSession,
  isRestarting,
  pendingFollowUp,
  followUpPrompt,
  onFeedback,
  expiresAt,
}) => {
  const t = useTranslations("aiPlanning");
  const isMobile = useIsMobile();
  const countdown = useCountdownTimer(expiresAt ?? null);

  // Fallback bottomRef when not provided externally
  const fallbackRef = useRef<HTMLDivElement>(null);
  const bottomRef = externalBottomRef ?? fallbackRef;
  const [dismissedQuestionId, setDismissedQuestionId] = useState<string | null>(
    null,
  );
  const isPendingQuestionDismissed =
    !!pendingQuestion && dismissedQuestionId === pendingQuestion.questionId;

  const handleDismissPendingQuestion = () => {
    if (!pendingQuestion) return;
    setDismissedQuestionId(pendingQuestion.questionId);
  };

  const shouldShowWelcomeState =
    messages.length === 0 &&
    !isStreaming &&
    !isSessionCompleted &&
    !isSessionEnded &&
    !isInterrupted &&
    !pendingQuestion &&
    !pendingFollowUp;

  // When resuming, show the stepper as a full-screen loading state
  if (isResuming && resumeStep) {
    return (
      <div className="flex flex-col flex-1 min-h-0 w-full items-center justify-center">
        <ResumeStepper currentStep={resumeStep} />
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full">
      {showGeneration ? (
        <div className="flex flex-col flex-1 min-h-0">
          {/* Column selector (hidden when items are already created) */}
          {!isAlreadyCreated && (
            <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
              <label className="text-xs text-muted-foreground whitespace-nowrap">
                {t("selectColumn")}:
              </label>
              <Select value={activeColumnId} onValueChange={onColumnChange}>
                <SelectTrigger className="w-[200px] h-10 md:h-8 text-sm md:text-xs">
                  <SelectValue placeholder={t("selectColumn")} />
                </SelectTrigger>
                <SelectContent>
                  {columns
                    .filter((col) => !col.isDone)
                    .map((col) => (
                      <SelectItem key={col.id} value={col.id}>
                        <span className="flex items-center gap-2">
                          <span
                            className="size-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: col.color }}
                          />
                          {col.name}
                        </span>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto">
            <GenerationConfirmPanel
              items={previewItems}
              onUpdateItem={onUpdateItem}
              onRemoveItem={onRemoveItem}
              onConfirm={onConfirmGeneration}
              onCancel={onCancelGeneration}
              isConfirming={isConfirming}
              itemCount={activeItemCount}
              isAlreadyCreated={isAlreadyCreated}
            />
          </div>
        </div>
      ) : shouldShowWelcomeState ? (
        /* ---- Welcome screen: centered greeting + input (like ChatGPT) ---- */
        <div className="flex-1 flex flex-col items-center px-4 pt-24 md:pt-0 md:justify-center">
          <div className="max-w-3xl w-full flex flex-col items-center gap-6 md:-mt-16">
            <h2 className="text-2xl font-semibold text-foreground">
              {t("welcomeGreeting")}
            </h2>
            <div className="w-full">
              <ChatInput
                onSend={onSendMessage}
                isStreaming={isStreaming}
                disabled={!!pendingQuestion}
                onStop={onStop}
                onKill={onKill}
                onPause={onPause}
                isPaused={isPaused}
                toolbar={toolbar}
                value={chatInputValue}
                onChange={chatInputOnChange}
                canSend={chatInputCanSend}
                onSendAction={chatInputOnSend}
                onKeyDown={chatInputOnKeyDown}
                isRecording={isRecording}
                isTranscribing={isTranscribing}
                isVoiceSupported={isVoiceSupported}
                onStartRecording={onStartRecording}
                onStopRecording={onStopRecording}
                mediaStream={mediaStream}
                mobileCompact={false}
              />
            </div>
          </div>
        </div>
      ) : (
        /* ---- Active chat: messages + input at bottom ---- */
        <>
          <ChatMessageList
            messages={messages}
            streamingContent={streamingContent}
            streamingThinkingContent={streamingThinkingContent}
            streamingBlocks={streamingBlocks}
            completedTurnBlocks={completedTurnBlocks}
            isStreaming={isStreaming}
            emptyState={emptyState}
            bottomRef={bottomRef}
            scrollRef={scrollRef}
            totalTokens={totalTokens}
            latestActivity={latestActivity}
            processingStartedAt={processingStartedAt}
            thinkingBlockIsCollapsed={thinkingBlockIsCollapsed}
            thinkingBlockToggleCollapse={thinkingBlockToggleCollapse}
            showScrollToBottom={showScrollToBottom && !pendingQuestion}
            onScrollToBottom={onScrollToBottom}
            isSessionCompleted={isSessionCompleted}
            pendingUserMessage={pendingUserMessage}
            onFeedback={onFeedback}
          />
          {/* Interrupted banner — shown above the chat input when session is interrupted */}
          {isInterrupted && onResume && (
            <InterruptedBanner
              reason={interruptionReason ?? "unknown"}
              onResume={onResume}
              isResuming={!!isResuming}
            />
          )}
          {isSessionCompleted && !showGeneration ? (
            /* Session completed summary — shows work items created */
            <SessionCompletedSummary
              workItemCount={completedWorkItemCount ?? 0}
              generatedItems={completedWorkItems ?? []}
            />
          ) : isInterrupted ? (
            /* When interrupted, hide the input (banner above handles resume) */
            null
          ) : pendingQuestion && onAnswerQuestion && !isPendingQuestionDismissed ? (
            isMobile ? (
              <QuestionWizardDrawer
                key={pendingQuestion.questionId}
                pendingQuestion={pendingQuestion}
                onAnswerQuestion={onAnswerQuestion}
                onCancelQuestion={handleDismissPendingQuestion}
                isStreaming={isStreaming}
                isRecording={isRecording}
                isTranscribing={isTranscribing}
                isVoiceSupported={isVoiceSupported}
                onStartRecording={onStartRecording}
                onStopRecording={onStopRecording}
                wizardTranscriptRef={wizardTranscriptRef}
              />
            ) : (
              <>
                {countdown.isActive && (
                  <div className="px-4 shrink-0">
                    <div className="max-w-3xl mx-auto flex justify-end">
                      <CountdownBadge formatted={countdown.formatted} isWarning={countdown.isWarning} isCritical={countdown.isCritical} />
                    </div>
                  </div>
                )}
                <QuestionWizardWrapper
                  pendingQuestion={pendingQuestion}
                  onAnswerQuestion={onAnswerQuestion}
                  onCancelQuestion={handleDismissPendingQuestion}
                  isStreaming={isStreaming}
                  isRecording={isRecording}
                  isTranscribing={isTranscribing}
                  isVoiceSupported={isVoiceSupported}
                  onStartRecording={onStartRecording}
                  onStopRecording={onStopRecording}
                  wizardTranscriptRef={wizardTranscriptRef}
                />
              </>
            )
          ) : isSessionEnded && onRestartSession ? (
            /* Session ended without success — show restart button */
            <SessionEndedBanner
              onRestart={onRestartSession}
              onNewSession={onNewSession}
              isRestarting={!!isRestarting}
              reason={sessionEndReason}
            />
          ) : (
            <>
              {/* Paused banner — subtle indicator above the input */}
              {isPaused && (
                <div className="px-4 pt-2 shrink-0">
                  <div className="max-w-3xl mx-auto flex items-center gap-2 rounded-lg border border-amber-300/50 bg-amber-50/50 px-3 py-2 dark:border-amber-700/50 dark:bg-amber-950/20">
                    <Pause className="size-3.5 text-amber-500 shrink-0" />
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      {t("pausedBanner")}
                    </p>
                  </div>
                </div>
              )}
              <ChatInput
                followUpHint={
                  isPendingQuestionDismissed
                    ? pendingQuestion?.questionText ?? null
                    : pendingFollowUp && !isPaused
                      ? (followUpPrompt || t("followUpNeeded"))
                      : null
                }
                onSend={onSendMessage}
                isStreaming={isStreaming}
                disabled={false}
                onStop={onStop}
                onKill={onKill}
                onPause={onPause}
                isPaused={isPaused}
                toolbar={toolbar}
                value={chatInputValue}
                onChange={chatInputOnChange}
                canSend={chatInputCanSend}
                onSendAction={chatInputOnSend}
                onKeyDown={chatInputOnKeyDown}
                isRecording={isRecording}
                isTranscribing={isTranscribing}
                isVoiceSupported={isVoiceSupported}
                onStartRecording={onStartRecording}
                onStopRecording={onStopRecording}
                placeholder={pendingFollowUp ? t("followUpPlaceholder") : undefined}
                expiresAt={expiresAt}
              />
            </>
          )}
        </>
      )}
    </div>
  );
};
