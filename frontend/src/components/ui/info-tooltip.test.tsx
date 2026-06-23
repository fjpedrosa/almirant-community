import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { InfoTooltip } from "./info-tooltip";

// Radix UI Tooltip requires a Provider; wrap the component so the Tooltip root
// has the context it needs without triggering pointer-event delays in tests.
const TooltipProviderWrapper = ({ children }: { children: React.ReactNode }) => {
  const { TooltipProvider } = require("@/components/ui/tooltip");
  return <TooltipProvider delayDuration={0}>{children}</TooltipProvider>;
};

describe("InfoTooltip", () => {
  it("renders with content prop", () => {
    render(
      <TooltipProviderWrapper>
        <InfoTooltip content="Helpful hint" />
      </TooltipProviderWrapper>,
    );
    // The trigger button must be present in the DOM
    const button = screen.getByRole("button");
    expect(button).toBeInTheDocument();
  });

  it("has role='button' trigger", () => {
    render(
      <TooltipProviderWrapper>
        <InfoTooltip content="Another hint" />
      </TooltipProviderWrapper>,
    );
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("accepts side prop without error", () => {
    const sides = ["top", "right", "bottom", "left"] as const;
    for (const side of sides) {
      const { unmount } = render(
        <TooltipProviderWrapper>
          <InfoTooltip content="Side test" side={side} />
        </TooltipProviderWrapper>,
      );
      // If rendering throws, this line will not be reached
      expect(screen.getByRole("button")).toBeInTheDocument();
      unmount();
    }
  });
});
