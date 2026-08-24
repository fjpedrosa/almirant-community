import { fireEvent, render, screen } from "@testing-library/react";
import { afterAll, describe, expect, mock, test } from "bun:test";
import type { ModelsSectionProps } from "../../domain/types";

mock.module("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    children: React.ReactNode;
  }) => (
    <select
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      aria-label="model-setting"
    >
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: () => null,
}));

const { ModelsSection } = await import("./models-section");

afterAll(() => mock.restore());

const baseProps = (): ModelsSectionProps => ({
  provider: "openai",
  availableModels: [
    { id: "gpt-5.6-sol", displayName: "GPT-5.6 Sol", category: "best" },
    { id: "gpt-5.5", displayName: "GPT-5.5", category: "best" },
  ],
  modelSettings: {
    planningModel: "",
    implementationModel: "",
    validationModel: "",
    planReviewModel: "",
    planningReasoningBudget: "",
    implementationReasoningBudget: "",
    validationReasoningBudget: "",
  },
  hasModelChanges: false,
  isSavingModelSettings: false,
  onModelSettingChange: mock(() => {}),
  onSaveModelSettings: () => {},
  connectionCount: 1,
  expanded: true,
  onExpandedChange: () => {},
});

describe("ModelsSection Plan Review settings", () => {
  test("exposes the critic model selector through the existing provider settings form", () => {
    const props = baseProps();
    render(<ModelsSection {...props} />);

    const selectors = screen.getAllByRole("combobox");
    expect(screen.getByRole("option", { name: "Disabled for Plan Review" })).toBeInTheDocument();

    fireEvent.change(selectors[3]!, { target: { value: "gpt-5.5" } });
    fireEvent.change(selectors[3]!, { target: { value: "__default__" } });

    expect(props.onModelSettingChange).toHaveBeenNthCalledWith(1, "planReviewModel", "gpt-5.5");
    expect(props.onModelSettingChange).toHaveBeenNthCalledWith(2, "planReviewModel", "");
  });
});
