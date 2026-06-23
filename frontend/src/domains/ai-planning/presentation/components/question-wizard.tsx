import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, ChevronDown, ArrowUp, Check, X, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { MicrophoneButton } from "./microphone-button";
import {
  useQuestionWizard,
  type QuestionAnswer,
} from "../../application/hooks/use-question-wizard";

/** Parse "label::description" format into parts. */
const parseOption = (raw: string): { label: string; description?: string } => {
  const sepIdx = raw.indexOf("::");
  if (sepIdx === -1) return { label: raw };
  return { label: raw.slice(0, sepIdx), description: raw.slice(sepIdx + 2) };
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const ProgressBar: React.FC<{
  total: number;
  current: number;
  answers: Map<number, QuestionAnswer>;
  onStepClick: (step: number) => void;
}> = ({ total, current, answers, onStepClick }) => (
  <div className="flex items-center gap-1.5 px-1">
    <div className="flex gap-1 flex-1">
      {Array.from({ length: total }, (_, i) => {
        const isAnswered = answers.has(i);
        const isCurrent = i === current;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onStepClick(i)}
            aria-label={`Question ${i + 1}`}
            className={cn(
              "h-2.5 flex-1 rounded-full transition-all duration-300 cursor-pointer min-h-[10px]",
              isCurrent && !isAnswered && "bg-primary/60 animate-pulse motion-reduce:animate-none",
              isCurrent && isAnswered && "bg-primary",
              !isCurrent && isAnswered && "bg-primary/40",
              !isCurrent && !isAnswered && "bg-muted-foreground/20",
            )}
          />
        );
      })}
    </div>
    <span className="text-xs text-muted-foreground tabular-nums shrink-0">
      {current + 1}/{total}
    </span>
  </div>
);

const OptionItem: React.FC<{
  label: string;
  description?: string;
  isSelected: boolean;
  disabled: boolean;
  onSelect: () => void;
}> = ({ label, description, isSelected, disabled, onSelect }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onSelect}
    className={cn(
      "text-left rounded-lg border px-3.5 py-2.5 transition-all duration-150 ease-out w-full",
      "disabled:opacity-50 disabled:pointer-events-none cursor-pointer group",
      isSelected
        ? "border-primary/40 bg-primary/10 border-l-2 border-l-primary"
        : "border-border bg-muted/40 hover:bg-accent hover:border-accent hover:shadow-sm",
    )}
  >
    <span className="flex items-center justify-between gap-2">
      <span
        className={cn(
          "text-base font-medium",
          isSelected
            ? "text-primary"
            : "text-foreground/90 group-hover:text-accent-foreground",
        )}
      >
        {label}
      </span>
      {isSelected && <Check className="size-3.5 text-primary shrink-0" />}
    </span>
    {description && (
      <p
        className={cn(
          "text-sm mt-0.5",
          isSelected
            ? "text-primary/70"
            : "text-muted-foreground group-hover:text-accent-foreground/70",
        )}
      >
        {description}
      </p>
    )}
  </button>
);

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface QuestionWizardProps {
  questionText: string;
  options: string[];
  questions?: Array<{ text: string; options: string[] }>;
  questionType?: "single_choice" | "multi_choice" | "free_text";
  onSubmitAnswers: (answer: string) => void;
  onCancel?: () => void;
  isSubmitting: boolean;
  /** Voice recording props (optional — hidden if not provided). */
  isRecording?: boolean;
  isTranscribing?: boolean;
  isVoiceSupported?: boolean;
  onStartRecording?: () => void;
  onStopRecording?: () => void;
  /** Ref callback to register a transcript handler (voice → textarea). */
  onTranscriptRef?: React.MutableRefObject<((text: string) => void) | null>;
  /** Callback to collapse the question panel. */
  onCollapse?: () => void;
}

export const QuestionWizard: React.FC<QuestionWizardProps> = ({
  questionText,
  options,
  questions,
  questionType,
  onSubmitAnswers,
  onCancel,
  isSubmitting,
  isRecording = false,
  isTranscribing = false,
  isVoiceSupported = false,
  onStartRecording,
  onStopRecording,
  onTranscriptRef,
  onCollapse,
}) => {
  const t = useTranslations("aiPlanning.wizard");
  const wizard = useQuestionWizard(questionText, options, questionType, questions);
  const freeTextRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!onTranscriptRef) return undefined;

    onTranscriptRef.current = (text: string) => {
      if (freeTextRef.current) {
        const current = freeTextRef.current.value;
        freeTextRef.current.value = current ? `${current} ${text}` : text;
        // Trigger resize
        freeTextRef.current.style.height = "auto";
        freeTextRef.current.style.height = `${Math.min(freeTextRef.current.scrollHeight, 88)}px`;
      }
    };

    return () => {
      onTranscriptRef.current = null;
    };
  }, [onTranscriptRef]);

  const currentAnswer = wizard.getAnswer(wizard.currentStep);
  const parsedOptions = wizard.currentQuestion.options.map(parseOption);

  const handleFreeTextSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const text = freeTextRef.current?.value?.trim();
    if (!text) return;
    wizard.setFreeText(text);
    if (!wizard.isLastStep) {
      wizard.goNext();
    }
  };

  const savePendingFreeText = () => {
    const text = freeTextRef.current?.value?.trim();
    if (text && !currentAnswer?.selectedOptions?.length) {
      wizard.setFreeText(text);
      return true;
    }
    return false;
  };

  const submitLockRef = useRef(false);
  const handleSubmit = () => {
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    setTimeout(() => { submitLockRef.current = false; }, 500);

    // For single question, format with "Q → A" so conversation-message.tsx renders the QA card
    if (!wizard.isMultiQuestion) {
      const questionText = wizard.questions[0].text;
      const existingAnswer = wizard.getAnswer(0);
      if (existingAnswer) {
        onSubmitAnswers(`${questionText} → ${existingAnswer.value}`);
        return;
      }
      // No stored answer - check the textarea
      const text = freeTextRef.current?.value?.trim();
      if (text) {
        onSubmitAnswers(`${questionText} → ${text}`);
        return;
      }
      // No answer at all - do nothing
      return;
    }

    // For multi-question, build answer string synchronously including any
    // pending free text from the textarea (avoids stale-closure from setState).
    const pendingText = freeTextRef.current?.value?.trim();
    const mergedAnswers = new Map(wizard.answers);
    if (pendingText && !mergedAnswers.get(wizard.currentStep)?.selectedOptions?.length) {
      mergedAnswers.set(wizard.currentStep, {
        value: pendingText,
        isFreeText: true,
        selectedOptions: undefined,
      });
    }

    const parts: string[] = [];
    for (let i = 0; i < wizard.totalQuestions; i++) {
      const answer = mergedAnswers.get(i);
      if (answer) {
        parts.push(`${wizard.questions[i].text} → ${answer.value}`);
      }
    }
    const finalAnswer = parts.join("\n");
    if (finalAnswer) {
      onSubmitAnswers(finalAnswer);
    }
  };

  const showVoice = isVoiceSupported && !!onStartRecording && !!onStopRecording;
  const isLastOrSingle = wizard.isLastStep || !wizard.isMultiQuestion;

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 ease-out flex flex-col max-h-[55vh]">
      {/* Scrollable content */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pb-2">
        {/* Progress bar + collapse button */}
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <ProgressBar
              total={wizard.totalQuestions}
              current={wizard.currentStep}
              answers={wizard.answers}
              onStepClick={wizard.goToStep}
            />
          </div>
          {onCollapse && (
            <Button
              variant="ghost"
              size="icon"
              className="size-11 text-muted-foreground shrink-0 -mr-1"
              onClick={onCollapse}
              aria-label="Collapse"
            >
              <ChevronDown className="size-4" />
            </Button>
          )}
        </div>

        {/* Question text */}
        <p className="text-lg font-medium text-foreground px-1">
          {wizard.currentQuestion.text}
        </p>

        {/* Options */}
        {parsedOptions.length > 0 && (
          <div className="flex flex-col gap-2 px-1">
            {parsedOptions.map(({ label, description }) => (
              <OptionItem
                key={label}
                label={label}
                description={description}
                isSelected={
                  currentAnswer != null &&
                  !currentAnswer.isFreeText &&
                  (currentAnswer.selectedOptions?.includes(label) ??
                    currentAnswer.value === label)
                }
                disabled={isSubmitting}
                onSelect={() => wizard.selectOption(label)}
              />
            ))}
          </div>
        )}

        {/* Free text section — key forces textarea remount on step change */}
        <div key={wizard.currentStep} className="px-1 space-y-3">
          {/* Show free text pill if answered with free text and not editing */}
          {currentAnswer?.isFreeText ? (
            <div className="flex items-center gap-2 rounded-lg bg-primary/10 border border-primary/20 px-4 py-3">
              <p className="text-base text-primary flex-1 truncate">
                {currentAnswer.value}
              </p>
              <button
                type="button"
                onClick={wizard.clearAnswer}
                className="text-primary/60 hover:text-primary shrink-0"
              >
                <X className="size-4" />
              </button>
            </div>
          ) : (
            <form onSubmit={handleFreeTextSubmit}>
              <div className="flex items-end gap-2 rounded-xl border border-border bg-muted/20 px-3 py-2.5">
                <Textarea
                  ref={freeTextRef}
                  name="freeText"
                  placeholder={t("freeTextPlaceholder")}
                  disabled={isSubmitting}
                  className="border-0 shadow-none focus-visible:ring-0 bg-transparent! min-h-[44px] max-h-[88px] resize-none px-0 py-1 text-base flex-1 placeholder:text-muted-foreground/50"
                  rows={1}
                  onInput={(e) => {
                    const target = e.currentTarget;
                    target.style.height = "auto";
                    target.style.height = `${Math.min(target.scrollHeight, 88)}px`;
                  }}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                      e.preventDefault();
                      const form = e.currentTarget.closest("form");
                      if (form) form.requestSubmit();
                    }
                  }}
                />
                {showVoice && (
                  <MicrophoneButton
                    isRecording={isRecording}
                    isTranscribing={isTranscribing}
                    isSupported={isVoiceSupported}
                    onClick={isRecording ? onStopRecording! : onStartRecording!}
                    disabled={isSubmitting}
                    className="shrink-0 size-11 rounded-full"
                  />
                )}
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Navigation footer - always visible, outside scroll area */}
      <div className="flex items-center justify-between px-3 py-3 shrink-0 border-t border-border/40 mt-2 bg-muted/30 -mx-1 rounded-b-xl">
        {/* Back / Cancel buttons */}
        <div className="flex items-center gap-1">
          {onCancel && (
            <Button
              variant="ghost"
              onClick={onCancel}
              disabled={isSubmitting}
              className="gap-1 text-muted-foreground hover:text-destructive min-h-[44px] px-3"
            >
              <X className="size-4" />
              {t("cancel")}
            </Button>
          )}
          {wizard.isMultiQuestion && wizard.canGoBack && (
            <Button
              variant="ghost"
              onClick={wizard.goBack}
              disabled={isSubmitting}
              className="gap-1 text-muted-foreground min-h-[44px] px-3"
            >
              <ChevronLeft className="size-4" />
              {t("back")}
            </Button>
          )}
        </div>

        {/* Answered indicator (center) */}
        {wizard.isMultiQuestion && (
          <div className="flex gap-1">
            {Array.from({ length: wizard.totalQuestions }, (_, i) => (
              <div
                key={i}
                className={cn(
                  "size-2 rounded-full transition-colors duration-200",
                  wizard.answers.has(i) ? "bg-primary" : "bg-muted-foreground/30",
                  i === wizard.currentStep && "ring-1 ring-primary/50 ring-offset-1 ring-offset-background",
                )}
              />
            ))}
          </div>
        )}

        {/* Next / Submit button — min 44px for mobile tap target */}
        <div className="flex justify-end">
          {wizard.isMultiQuestion && !wizard.isLastStep ? (
            <Button
              variant="ghost"
              onClick={() => {
                savePendingFreeText();
                wizard.goNext();
              }}
              disabled={isSubmitting}
              className="gap-1.5 text-muted-foreground hover:text-foreground min-h-[44px] px-4"
            >
              {t("next")}
              <ChevronRight className="size-4" />
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="gap-1.5 min-h-[44px] px-4"
            >
              <Send className="size-4" />
              {isLastOrSingle ? t("send") : t("next")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
