import { describe, expect, mock, test } from "bun:test";
import {
  confirmAlreadyCreatedGeneration,
  isGenerationPreviewReadOnly,
  shouldShowGenerationReviewControls,
} from "./generation-confirm-panel-actions";

describe("confirmAlreadyCreatedGeneration", () => {
  test("does not forward the click event to the confirmation callback", () => {
    const onConfirm = mock(() => {});

    confirmAlreadyCreatedGeneration(onConfirm);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith();
  });

  test("freezes the preview and hides review controls while a review is pending", () => {
    expect(isGenerationPreviewReadOnly(false, true)).toBe(true);
    expect(shouldShowGenerationReviewControls(false, true)).toBe(false);
  });
});
