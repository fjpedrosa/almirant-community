import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { GenerationConfirmPanelProps } from "../../domain/types";

mock.module("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

mock.module("./work-item-preview-tree", () => ({
  WorkItemPreviewTree: ({ readOnly }: { readOnly?: boolean }) => (
    <div data-testid="preview-tree" data-read-only={readOnly ? "true" : "false"} />
  ),
}));

const synthesizerCapability = {
  connectionRef: "prs1.test-synthesizer",
  name: "Team Synthesizer",
  provider: "anthropic" as const,
  models: ["claude-sonnet-4-5"],
};

let capabilities = [synthesizerCapability];

mock.module("@/lib/api/client", () => ({
  aiApi: {
    getPlanReviewCapabilities: async () => capabilities,
  },
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

beforeEach(() => {
  capabilities = [synthesizerCapability];
});

describe("GenerationConfirmPanel plan-review states", () => {
  test.each([2, 3, 4] as const)("submits the selected critic count (%s)", async (requestedCriticCount) => {
    const onConfirm = mock(() => {});
    render(<GenerationConfirmPanel {...baseProps()} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(screen.getByLabelText("synthesizerConnection")).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText("synthesizerConnection"), {
      target: { value: "prs1.test-synthesizer" },
    });
    fireEvent.change(screen.getByLabelText("synthesizerModel"), {
      target: { value: "claude-sonnet-4-5" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: /criticCount/ }), {
      target: { value: String(requestedCriticCount) },
    });
    fireEvent.click(screen.getByRole("button", { name: /createAll/ }));

    expect(onConfirm).toHaveBeenCalledWith({
      enabled: true,
      requestedCriticCount,
      synthesizerConnectionRef: "prs1.test-synthesizer",
      synthesizerModel: "claude-sonnet-4-5",
    });
  });

  test("shows persistent retry UI after mismatch or polling failure", async () => {
    const onConfirm = mock(() => {});
    render(
      <GenerationConfirmPanel
        {...baseProps()}
        onConfirm={onConfirm}
        planReviewError="Review status could not be verified."
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Review status could not be verified.");
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(screen.getByLabelText("synthesizerConnection")).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText("synthesizerConnection"), {
      target: { value: "prs1.test-synthesizer" },
    });
    fireEvent.change(screen.getByLabelText("synthesizerModel"), {
      target: { value: "claude-sonnet-4-5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "retryPlanReview" }));
    expect(onConfirm).toHaveBeenCalledWith({
      enabled: true,
      requestedCriticCount: 2,
      synthesizerConnectionRef: "prs1.test-synthesizer",
      synthesizerModel: "claude-sonnet-4-5",
    });
  });

  test("freezes queued previews and renders applied previews read-only", () => {
    const { rerender } = render(<GenerationConfirmPanel {...baseProps()} isPendingReview />);
    expect(screen.getByTestId("preview-tree")).toHaveAttribute("data-read-only", "true");
    expect(screen.queryByText("reviewBeforeCreating")).not.toBeInTheDocument();

    rerender(<GenerationConfirmPanel {...baseProps()} isAlreadyCreated />);
    expect(screen.getByTestId("preview-tree")).toHaveAttribute("data-read-only", "true");
    expect(screen.getByRole("button", { name: "done" })).toBeInTheDocument();
  });

  test("does not auto-select a synthesizer or submit review before explicit choices", async () => {
    const onConfirm = mock(() => {});
    render(<GenerationConfirmPanel {...baseProps()} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(screen.getByLabelText("synthesizerConnection")).not.toBeDisabled());

    expect((screen.getByLabelText("synthesizerConnection") as HTMLSelectElement).value).toBe("");
    expect((screen.getByLabelText("synthesizerModel") as HTMLSelectElement).value).toBe("");

    const createButton = screen.getByRole("button", { name: /createAll/ });
    expect(createButton).toBeDisabled();
    fireEvent.click(createButton);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test("keeps review disabled and reports an empty capability state", async () => {
    capabilities = [];
    const onConfirm = mock(() => {});
    render(<GenerationConfirmPanel {...baseProps()} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("noSynthesizerCapabilities"));

    expect(screen.getByRole("button", { name: /createAll/ })).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
