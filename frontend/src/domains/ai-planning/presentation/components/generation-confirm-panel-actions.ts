import type { GenerationConfirmPanelProps } from "../../domain/types";

export const confirmAlreadyCreatedGeneration = (
  onConfirm: GenerationConfirmPanelProps["onConfirm"],
): void => {
  onConfirm();
};

export const isGenerationPreviewReadOnly = (
  isAlreadyCreated: boolean | undefined,
  isPendingReview: boolean | undefined,
): boolean => Boolean(isAlreadyCreated || isPendingReview);

export const shouldShowGenerationReviewControls = (
  isAlreadyCreated: boolean | undefined,
  isPendingReview: boolean | undefined,
): boolean => !isAlreadyCreated && !isPendingReview;
