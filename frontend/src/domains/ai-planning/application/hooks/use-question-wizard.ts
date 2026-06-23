"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  parseMultiQuestions,
  type ParsedQuestion,
} from "../utils/parse-multi-questions";

export interface QuestionAnswer {
  /** For single-select or free text: the selected value. For multi-select: comma-joined. */
  value: string;
  /** Whether the answer is a free-text response */
  isFreeText: boolean;
  /** Selected option labels (for multi-select mode). */
  selectedOptions?: string[];
}

export interface UseQuestionWizardReturn {
  /** All parsed questions */
  questions: ParsedQuestion[];
  /** Total number of questions */
  totalQuestions: number;
  /** Whether this is a multi-question wizard (vs single question) */
  isMultiQuestion: boolean;
  /** Current step index (0-based) */
  currentStep: number;
  /** Current question */
  currentQuestion: ParsedQuestion;
  /** Map of step index → answer */
  answers: Map<number, QuestionAnswer>;
  /** Whether all questions have been answered */
  allAnswered: boolean;
  /** Number of answered questions */
  answeredCount: number;
  /** Whether we can go back */
  canGoBack: boolean;
  /** Whether we can go forward */
  canGoForward: boolean;
  /** Whether we're on the last step */
  isLastStep: boolean;
  /** Go to previous question */
  goBack: () => void;
  /** Go to next question */
  goNext: () => void;
  /** Go to a specific step */
  goToStep: (step: number) => void;
  /** Select an option for the current question */
  selectOption: (option: string) => void;
  /** Set free text for the current question */
  setFreeText: (text: string) => void;
  /** Clear answer for the current question */
  clearAnswer: () => void;
  /** Get the concatenated answer string for submission */
  buildAnswerString: () => string;
  /** Get the answer for a specific step */
  getAnswer: (step: number) => QuestionAnswer | undefined;
}

export const useQuestionWizard = (
  questionText: string,
  options: string[],
  questionType?: "single_choice" | "multi_choice" | "free_text",
  structuredQuestions?: ParsedQuestion[],
): UseQuestionWizardReturn => {
  const questions = useMemo(
    () => parseMultiQuestions(questionText, options, structuredQuestions),
    [questionText, options, structuredQuestions],
  );

  const totalQuestions = questions.length;
  const isMultiQuestion = totalQuestions > 1;

  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<Map<number, QuestionAnswer>>(
    () => new Map(),
  );

  // Track whether user navigated manually (disables auto-advance)
  const manualNavRef = useRef(false);
  const autoAdvanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (autoAdvanceTimerRef.current) {
        clearTimeout(autoAdvanceTimerRef.current);
      }
    };
  }, []);

  const currentQuestion = questions[currentStep] ?? questions[0];
  const allAnswered = answers.size === totalQuestions;
  const answeredCount = answers.size;
  const canGoBack = currentStep > 0;
  const canGoForward = currentStep < totalQuestions - 1;
  const isLastStep = currentStep === totalQuestions - 1;

  const goBack = useCallback(() => {
    manualNavRef.current = true;
    setCurrentStep((s) => Math.max(0, s - 1));
  }, []);

  const goNextLockRef = useRef(false);
  const goNext = useCallback(() => {
    if (goNextLockRef.current) return;
    goNextLockRef.current = true;
    setCurrentStep((s) => Math.min(totalQuestions - 1, s + 1));
    setTimeout(() => { goNextLockRef.current = false; }, 300);
  }, [totalQuestions]);

  const goToStep = useCallback(
    (step: number) => {
      manualNavRef.current = true;
      setCurrentStep(Math.max(0, Math.min(totalQuestions - 1, step)));
    },
    [totalQuestions],
  );

  const selectOption = useCallback(
    (option: string) => {
      // Clear any pending auto-advance
      if (autoAdvanceTimerRef.current) {
        clearTimeout(autoAdvanceTimerRef.current);
        autoAdvanceTimerRef.current = null;
      }

      setAnswers((prev) => {
        const next = new Map(prev);

        if (questionType === "single_choice") {
          // Single-choice: replace selection (toggle off if already selected)
          const current = prev.get(currentStep);
          const isAlreadySelected =
            current?.selectedOptions?.length === 1 &&
            current.selectedOptions[0] === option;

          if (isAlreadySelected) {
            next.delete(currentStep);
          } else {
            next.set(currentStep, {
              value: option,
              isFreeText: false,
              selectedOptions: [option],
            });
          }
        } else {
          // Multi-choice (default): toggle in array
          const current = prev.get(currentStep);
          const currentOptions = current?.selectedOptions ?? [];

          const isSelected = currentOptions.includes(option);
          const newOptions = isSelected
            ? currentOptions.filter((o) => o !== option)
            : [...currentOptions, option];

          if (newOptions.length === 0) {
            next.delete(currentStep);
          } else {
            next.set(currentStep, {
              value: newOptions.join(", "),
              isFreeText: false,
              selectedOptions: newOptions,
            });
          }
        }
        return next;
      });

      // Reset manual nav flag after selecting (user engaged with current question)
      if (manualNavRef.current) {
        manualNavRef.current = false;
      }
    },
    [currentStep, questionType],
  );

  const setFreeText = useCallback(
    (text: string) => {
      // Cancel auto-advance when user types
      if (autoAdvanceTimerRef.current) {
        clearTimeout(autoAdvanceTimerRef.current);
        autoAdvanceTimerRef.current = null;
      }

      if (text.trim()) {
        setAnswers((prev) => {
          const next = new Map(prev);
          // Clear any selected options when setting free text
          next.set(currentStep, {
            value: text.trim(),
            isFreeText: true,
            selectedOptions: undefined,
          });
          return next;
        });
      } else {
        // Clear answer if text is empty
        setAnswers((prev) => {
          const next = new Map(prev);
          next.delete(currentStep);
          return next;
        });
      }
    },
    [currentStep],
  );

  const clearAnswer = useCallback(() => {
    setAnswers((prev) => {
      const next = new Map(prev);
      next.delete(currentStep);
      return next;
    });
  }, [currentStep]);

  const getAnswer = useCallback(
    (step: number) => answers.get(step),
    [answers],
  );

  const buildAnswerString = useCallback((): string => {
    if (totalQuestions === 1) {
      return answers.get(0)?.value ?? "";
    }

    const parts: string[] = [];
    for (let i = 0; i < totalQuestions; i++) {
      const answer = answers.get(i);
      if (answer) {
        parts.push(`${questions[i].text} → ${answer.value}`);
      }
    }
    return parts.join("\n");
  }, [answers, questions, totalQuestions]);

  return {
    questions,
    totalQuestions,
    isMultiQuestion,
    currentStep,
    currentQuestion,
    answers,
    allAnswered,
    answeredCount,
    canGoBack,
    canGoForward,
    isLastStep,
    goBack,
    goNext,
    goToStep,
    selectOption,
    setFreeText,
    clearAnswer,
    buildAnswerString,
    getAnswer,
  };
};
