"use client";

import { useState } from "react";
import { Drawer } from "vaul";
import { MessageCircleQuestion } from "lucide-react";
import { QuestionWizard } from "./question-wizard";
import { parseMultiQuestions } from "../../application/utils/parse-multi-questions";

interface QuestionWizardDrawerProps {
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
}

// Vaul snap points: number = fraction of viewport height from top
// 0.06 ≈ 48px on 844px viewport (collapsed pill)
// 0.66 = 66% of viewport height (expanded)
const SNAP_COLLAPSED = 0.08;
const SNAP_EXPANDED = 0.7;

export const QuestionWizardDrawer: React.FC<QuestionWizardDrawerProps> = ({
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
  const [snap, setSnap] = useState<number | string | null>(SNAP_EXPANDED);
  const parsed = parseMultiQuestions(
    pendingQuestion.questionText,
    pendingQuestion.options,
    pendingQuestion.questions,
  );
  const totalQuestions = parsed.length;
  const isCollapsed = snap === SNAP_COLLAPSED;

  return (
    <Drawer.Root
      open
      snapPoints={[SNAP_COLLAPSED, SNAP_EXPANDED]}
      activeSnapPoint={snap}
      setActiveSnapPoint={setSnap}
      modal={false}
      dismissible={false}
      direction="bottom"
    >
      <Drawer.Portal>
        {/* Backdrop — only when expanded */}
        <Drawer.Overlay
          className={`fixed inset-0 z-40 transition-colors duration-300 ${
            isCollapsed ? "pointer-events-none bg-transparent" : "bg-black/30"
          }`}
        />

        <Drawer.Content
          className="fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-2xl bg-card border-t border-border shadow-2xl outline-none"
        >
          {/* Drag handle */}
          <Drawer.Handle className="mx-auto mt-3 mb-1 h-1.5 w-10 rounded-full bg-muted-foreground/30" />

          {/* Collapsed state: pill preview */}
          {isCollapsed && (
            <div className="flex items-center gap-2.5 px-5 pb-3">
              <MessageCircleQuestion className="size-4 text-primary shrink-0" />
              <span className="text-sm font-medium text-foreground truncate">
                Pregunta {totalQuestions > 1 ? `1/${totalQuestions}` : "pendiente"}
              </span>
            </div>
          )}

          {/* Expanded state: full wizard */}
          <div
            className={isCollapsed ? "hidden" : "flex-1 min-h-0 overflow-y-auto px-4 pb-2"}
          >
            <QuestionWizard
              key={pendingQuestion.questionId}
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

          {/* Accessible title/description for Vaul */}
          <Drawer.Title className="sr-only">Question Wizard</Drawer.Title>
          <Drawer.Description className="sr-only">Answer planning questions</Drawer.Description>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
};
