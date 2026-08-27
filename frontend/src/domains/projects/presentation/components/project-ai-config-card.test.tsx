import React from "react";
import { describe, expect, test, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import { ProjectAiConfigCard } from "./project-ai-config-card";

mock.module("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

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

  test("shows the exact-tuple explanation for an admitted Pi implementation runtime", () => {
    globalThis.DocumentFragment = window.DocumentFragment;

    render(
      <ProjectAiConfigCard
        defaultProvider="claude-code"
        implementationDefaults={{
          codingAgent: "pi",
          aiProvider: "zai",
          model: "glm-5.3",
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

    expect(screen.getByText("piExactTuple")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "AI provider" })).not.toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Model" })).not.toBeDisabled();
  });

  test("renders retained notices for raw future values instead of replacing them", () => {
    globalThis.DocumentFragment = window.DocumentFragment;

    const { container } = render(
      <ProjectAiConfigCard
        defaultProvider="future-runner"
        implementationDefaults={{
          codingAgent: "future-agent",
          aiProvider: "future-provider",
          model: "future-model",
          reasoningLevel: "future-effort",
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

    const retainedNotices = [...container.querySelectorAll("p")]
      .filter((element) => element.textContent?.includes("retainedValue"));
    expect(retainedNotices).toHaveLength(5);
    expect(retainedNotices.map((element) => element.textContent).join(" ")).toContain("future-runner");
    expect(retainedNotices.map((element) => element.textContent).join(" ")).toContain("future-agent");
    expect(retainedNotices.map((element) => element.textContent).join(" ")).toContain("future-provider");
    expect(retainedNotices.map((element) => element.textContent).join(" ")).toContain("future-model");
    expect(retainedNotices.map((element) => element.textContent).join(" ")).toContain("future-effort");
  });
});
