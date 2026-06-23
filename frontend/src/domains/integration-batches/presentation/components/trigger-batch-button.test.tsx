import { describe, expect, it, mock } from "bun:test";
import { render, screen, fireEvent } from "@testing-library/react";
import { TriggerBatchButton } from "./trigger-batch-button";

describe("TriggerBatchButton", () => {
  it("shows the count of items ready to integrate", () => {
    render(
      <TriggerBatchButton
        validatingItemCount={3}
        hasActiveBatch={false}
        isLoading={false}
        onTrigger={() => {}}
      />,
    );
    expect(screen.getByText(/3/)).toBeDefined();
  });

  it("calls onTrigger when clicked", () => {
    const onTrigger = mock(() => {});
    render(
      <TriggerBatchButton
        validatingItemCount={2}
        hasActiveBatch={false}
        isLoading={false}
        onTrigger={onTrigger}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("is disabled when there is an active batch", () => {
    render(
      <TriggerBatchButton
        validatingItemCount={2}
        hasActiveBatch={true}
        isLoading={false}
        onTrigger={() => {}}
      />,
    );
    expect(screen.getByRole("button")).toHaveProperty("disabled", true);
  });

  it("is disabled when there are zero items", () => {
    render(
      <TriggerBatchButton
        validatingItemCount={0}
        hasActiveBatch={false}
        isLoading={false}
        onTrigger={() => {}}
      />,
    );
    expect(screen.getByRole("button")).toHaveProperty("disabled", true);
  });

  it("is disabled while loading", () => {
    render(
      <TriggerBatchButton
        validatingItemCount={3}
        hasActiveBatch={false}
        isLoading={true}
        onTrigger={() => {}}
      />,
    );
    expect(screen.getByRole("button")).toHaveProperty("disabled", true);
  });
});
