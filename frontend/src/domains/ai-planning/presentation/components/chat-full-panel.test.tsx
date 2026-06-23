import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import type { ChatFullPanelProps } from "../../domain/types";

mock.module("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));

mock.module("@/lib/hooks", () => ({
  useIsMobile: () => false,
}));

mock.module("../../application/hooks/use-countdown-timer", () => ({
  useCountdownTimer: () => ({
    formatted: "",
    isActive: false,
    isWarning: false,
    isCritical: false,
  }),
}));

mock.module("./chat-message-list", () => ({
  ChatMessageList: () => <div data-testid="chat-message-list" />,
}));

mock.module("./chat-input", () => ({
  ChatInput: ({
    disabled,
    followUpHint,
    placeholder,
  }: {
    disabled?: boolean;
    followUpHint?: string | null;
    placeholder?: string;
  }) => (
    <div data-testid="chat-input">
      <span data-testid="chat-input-state">{disabled ? "disabled" : "enabled"}</span>
      {followUpHint ? <span data-testid="follow-up-hint">{followUpHint}</span> : null}
      {placeholder ? <span data-testid="chat-input-placeholder">{placeholder}</span> : null}
    </div>
  ),
}));

mock.module("./question-wizard", () => ({
  QuestionWizard: ({
    questionText,
    onCancel,
  }: {
    questionText: string;
    onCancel?: () => void;
  }) => {
    const [initialQuestionText] = useState(questionText);
    return (
      <div>
        <div data-testid="question-wizard">{initialQuestionText}</div>
        {onCancel ? (
          <button type="button" onClick={onCancel}>
            cancel-question
          </button>
        ) : null}
      </div>
    );
  },
}));

mock.module("./generation-confirm-panel", () => ({
  GenerationConfirmPanel: () => <div data-testid="generation-confirm-panel" />,
}));

mock.module("./interrupted-banner", () => ({
  InterruptedBanner: () => <div data-testid="interrupted-banner" />,
}));

mock.module("./session-ended-banner", () => ({
  SessionEndedBanner: () => <div data-testid="session-ended-banner" />,
}));

mock.module("./resume-stepper", () => ({
  ResumeStepper: () => <div data-testid="resume-stepper" />,
}));

mock.module("./session-completed-summary", () => ({
  SessionCompletedSummary: () => <div data-testid="session-completed-summary" />,
}));

const { ChatFullPanel } = await import("./chat-full-panel");

const createBaseProps = (): ChatFullPanelProps => ({
  providerLabel: "Codex",
  model: "gpt-5.4",
  showModelBadge: false,
  messages: [],
  streamingContent: "",
  isStreaming: false,
  onSendMessage: () => {},
  showGeneration: false,
  previewItems: [],
  columns: [],
  activeColumnId: "",
  activeItemCount: 0,
  isConfirming: false,
  onUpdateItem: () => {},
  onRemoveItem: () => {},
  onColumnChange: () => {},
  onConfirmGeneration: () => {},
  onCancelGeneration: () => {},
  chatInputValue: "",
  chatInputOnChange: () => {},
  chatInputCanSend: true,
  chatInputOnSend: () => {},
  chatInputOnKeyDown: () => {},
});

describe("ChatFullPanel", () => {
  it("renders the question wizard when a restored session has a pending question but no persisted messages yet", () => {
    render(
      <ChatFullPanel
        {...createBaseProps()}
        pendingQuestion={{
          questionId: "question-1",
          questionText: "¿Qué alcance quieres aprobar?",
          options: ["A", "B"],
          questionType: "single_choice",
        }}
        onAnswerQuestion={() => {}}
      />,
    );

    expect(screen.queryByText("welcomeGreeting")).not.toBeInTheDocument();
    expect(screen.getByTestId("question-wizard")).toHaveTextContent(
      "¿Qué alcance quieres aprobar?",
    );
  });

  it("remonta el wizard cuando cambia la pregunta pendiente", () => {
    const { rerender } = render(
      <ChatFullPanel
        {...createBaseProps()}
        pendingQuestion={{
          questionId: "question-1",
          questionText: "Primera pregunta",
          options: ["A"],
          questionType: "single_choice",
        }}
        onAnswerQuestion={() => {}}
      />,
    );

    expect(screen.getByTestId("question-wizard")).toHaveTextContent(
      "Primera pregunta",
    );

    rerender(
      <ChatFullPanel
        {...createBaseProps()}
        pendingQuestion={{
          questionId: "question-2",
          questionText: "Segunda pregunta",
          options: ["B"],
          questionType: "single_choice",
        }}
        onAnswerQuestion={() => {}}
      />,
    );

    expect(screen.getByTestId("question-wizard")).toHaveTextContent(
      "Segunda pregunta",
    );
  });

  it("renders the follow-up input when a restored session is awaiting free-text input with no persisted messages", () => {
    render(
      <ChatFullPanel
        {...createBaseProps()}
        pendingFollowUp
        followUpPrompt="Necesito más detalle sobre el alcance"
      />,
    );

    expect(screen.queryByText("welcomeGreeting")).not.toBeInTheDocument();
    expect(screen.getByTestId("chat-input")).toBeInTheDocument();
    expect(screen.getByTestId("follow-up-hint")).toHaveTextContent(
      "Necesito más detalle sobre el alcance",
    );
  });

  it("dismisses the questionnaire locally and exposes the normal chat input", () => {
    render(
      <ChatFullPanel
        {...createBaseProps()}
        pendingQuestion={{
          questionId: "question-1",
          questionText: "¿Qué alcance quieres aprobar?",
          options: ["A", "B"],
          questionType: "single_choice",
        }}
        onAnswerQuestion={() => {}}
      />,
    );

    fireEvent.click(screen.getByText("cancel-question"));

    expect(screen.queryByTestId("question-wizard")).not.toBeInTheDocument();
    expect(screen.getByTestId("chat-input")).toBeInTheDocument();
    expect(screen.getByTestId("follow-up-hint")).toHaveTextContent(
      "¿Qué alcance quieres aprobar?",
    );
  });
});
