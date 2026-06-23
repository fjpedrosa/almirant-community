import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import {
  HUMAN_ACTION_TOOLTIP_CONTENT_CLASS,
  HumanActionRequiredTooltipBody,
} from "./human-action-required-badge";

describe("HumanActionRequiredTooltipBody", () => {
  it("renders the exact human action for each blocked child task", () => {
    render(
      <HumanActionRequiredTooltipBody
        label="Human action required"
        actionLabel="What the human must do"
        message="Fallback action"
        requirements={[
          {
            itemId: "child-1",
            taskId: "ZC-142",
            message: "Run local database checks with a real PostgreSQL instance.",
          },
          {
            itemId: "child-2",
            taskId: "ZC-143",
            message: "Capture Lighthouse evidence in Chromium.",
          },
        ]}
      />,
    );

    expect(screen.getByText("Human action required")).toBeInTheDocument();
    expect(screen.getByText("What the human must do")).toBeInTheDocument();
    expect(screen.getByText("ZC-142")).toBeInTheDocument();
    expect(screen.getByText("Run local database checks with a real PostgreSQL instance.")).toBeInTheDocument();
    expect(screen.getByText("ZC-143")).toBeInTheDocument();
    expect(screen.getByText("Capture Lighthouse evidence in Chromium.")).toBeInTheDocument();
  });

  it("uses a readable popover surface instead of muted text on the primary tooltip", () => {
    expect(HUMAN_ACTION_TOOLTIP_CONTENT_CLASS).toContain("bg-popover");
    expect(HUMAN_ACTION_TOOLTIP_CONTENT_CLASS).toContain("text-popover-foreground");
    expect(HUMAN_ACTION_TOOLTIP_CONTENT_CLASS).toContain("overflow-y-auto");
  });
});
