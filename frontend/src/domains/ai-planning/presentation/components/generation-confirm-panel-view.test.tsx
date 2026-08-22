import { fireEvent, render, screen } from "@testing-library/react";
import { afterAll, describe, expect, mock, test } from "bun:test";
import type { GenerationConfirmPanelProps } from "../../domain/types";

mock.module("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

mock.module("./work-item-preview-tree", () => ({
  WorkItemPreviewTree: ({ readOnly }: { readOnly?: boolean }) => (
    <div data-testid="preview-tree" data-read-only={readOnly ? "true" : "false"} />
  ),
}));

const { GenerationConfirmPanel } = await import("./generation-confirm-panel-view");

const baseProps = (): GenerationConfirmPanelProps => ({
  items: [{ tempId: "task-1", type: "task", title: "Task", priority: "medium", isEditing: false, isRemoved: false }],
  onUpdateItem: () => {},
  onRemoveItem: () => {},
  onConfirm: () => {},
  onCancel: () => {},
  isConfirming: false,
  itemCount: 1,
});

afterAll(() => mock.restore());

describe("GenerationConfirmPanel plan-review states", () => {
  test("shows persistent retry UI after mismatch or polling failure", () => {
    const onConfirm = mock(() => {});
    render(
      <GenerationConfirmPanel
        {...baseProps()}
        onConfirm={onConfirm}
        planReviewError="Review status could not be verified."
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Review status could not be verified.");
    fireEvent.click(screen.getByRole("button", { name: "retryPlanReview" }));
    expect(onConfirm).toHaveBeenCalledWith({ enabled: true, requestedCriticCount: 2 });
  });

  test("freezes queued previews and renders applied previews read-only", () => {
    const { rerender } = render(<GenerationConfirmPanel {...baseProps()} isPendingReview />);
    expect(screen.getByTestId("preview-tree")).toHaveAttribute("data-read-only", "true");
    expect(screen.queryByText("reviewBeforeCreating")).not.toBeInTheDocument();

    rerender(<GenerationConfirmPanel {...baseProps()} isAlreadyCreated />);
    expect(screen.getByTestId("preview-tree")).toHaveAttribute("data-read-only", "true");
    expect(screen.getByRole("button", { name: "done" })).toBeInTheDocument();
  });
});
