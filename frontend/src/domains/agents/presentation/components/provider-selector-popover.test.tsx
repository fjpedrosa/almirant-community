import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

mock.module("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const Passthrough = ({ children }: { children?: ReactNode }) => <>{children}</>;

mock.module("@/components/ui/popover", () => ({
  Popover: Passthrough,
  PopoverContent: Passthrough,
  PopoverTrigger: Passthrough,
}));

const { ProviderSelectorPopover } = await import("./provider-selector-popover");

describe("ProviderSelectorPopover", () => {
  it("offers only the admitted GLM-5.3 model for Pi and cannot submit disabled Z.AI models", () => {
    const onSelect = mock(() => {});
    render(<ProviderSelectorPopover onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: "Pi" }));

    expect(screen.getByRole("button", { name: /^GLM-5\.3/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^GLM-5\.2/ })).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /^GLM-5\.3/ }));

    expect(onSelect).toHaveBeenCalledWith({
      codingAgent: "pi",
      provider: "zipu",
      model: "glm-5.3",
    });
  });

  it("preserves the existing Claude Code Z.AI model catalog and ordering", () => {
    render(<ProviderSelectorPopover onSelect={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: /Claude Code.*Claude Code/ }));
    fireEvent.click(screen.getByRole("button", { name: /z\.ai/i }));

    const modelButtons = screen.getAllByRole("button").filter((button) =>
      button.textContent?.startsWith("GLM-"),
    );
    expect(modelButtons.slice(0, 3).map((button) => button.textContent)).toEqual([
      "GLM-5.3Best",
      "GLM-5.2Best",
      "GLM-5.1Reasoning",
    ]);
  });
});
