import React from "react";
import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { ProjectAiConfigCard } from "./project-ai-config-card";

const noop = () => {};

describe("ProjectAiConfigCard", () => {
  test("keeps runtime selection enabled while disabling unsupported Haiku effort", () => {
    globalThis.DocumentFragment = window.DocumentFragment;

    render(
      <ProjectAiConfigCard
        defaultProvider="claude-code"
        implementationDefaults={{
          codingAgent: "claude-code",
          aiProvider: "anthropic",
          model: "claude-haiku-4-5",
          reasoningLevel: null,
        }}
        isSaving={false}
        hasChanges={false}
        errorMessage={null}
        onChange={noop}
        onCodingAgentChange={noop}
        onAiProviderChange={noop}
        onModelChange={noop}
        onReasoningLevelChange={noop}
        onSave={noop}
        onDiscard={noop}
      />,
    );

    const selects = screen.getAllByRole("combobox");

    expect(selects).toHaveLength(5);
    expect(selects[1]).not.toBeDisabled();
    expect(selects[4]).toBeDisabled();
  });
});
