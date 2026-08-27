import React from "react";
import { describe, expect, test, mock } from "bun:test";
import { render, renderHook, screen } from "@testing-library/react";
import {
  ProjectRuntimeRejectionNotice,
  RetainedRuntimeNotice,
  retainedRuntimeSelectValue,
  useAiProviderOptions,
  useCodingAgentOptions,
} from "./project-dev-flow-runtime-options";

mock.module("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

describe("project dev-flow runtime options", () => {
  test("offers Pi for implementation but excludes it from read-only defaults", () => {
    const implementation = renderHook(() => useCodingAgentOptions("implementation"));
    const devFlow = renderHook(() => useCodingAgentOptions("dev-flow-default"));

    expect(implementation.result.current.map((option) => option.value)).toEqual([
      "claude-code",
      "codex",
      "opencode",
      "pi",
    ]);
    expect(devFlow.result.current.map((option) => option.value)).toEqual([
      "claude-code",
      "codex",
      "opencode",
    ]);
    expect(implementation.result.current.find((option) => option.value === "pi")?.label).toBe("pi");
  });

  test("filters providers by the exact coding-agent tuple", () => {
    const piProviders = renderHook(() => useAiProviderOptions("implementation", "pi"));
    const codexProviders = renderHook(() => useAiProviderOptions("implementation", "codex"));

    expect(piProviders.result.current.map((option) => option.value)).toEqual(["zai"]);
    expect(codexProviders.result.current.map((option) => option.value)).toEqual(["openai"]);
  });

  test("uses a stable sentinel for retained empty values", () => {
    expect(retainedRuntimeSelectValue("model", null)).toBe("__retained-default-model__");
    expect(retainedRuntimeSelectValue("model", "future-model")).toBe("future-model");
  });

  test("renders retained raw values with their field label", () => {
    render(<RetainedRuntimeNotice field="model" value="future-model" />);

    expect(screen.getByText(
      'retainedValue:{"field":"fields.model","value":"future-model"}',
    )).toBeInTheDocument();
  });

  test("renders known admission rejection copy and ignores unknown codes", () => {
    const { rerender } = render(
      <ProjectRuntimeRejectionNotice code="PI_CAPABILITY_READ_ONLY_ENFORCEMENT_DISABLED" />,
    );

    expect(screen.getByText(/rejections\.PI_CAPABILITY_READ_ONLY_ENFORCEMENT_DISABLED/)).toBeInTheDocument();
    expect(screen.getAllByText(/PI_CAPABILITY_READ_ONLY_ENFORCEMENT_DISABLED/).length).toBeGreaterThan(0);

    rerender(<ProjectRuntimeRejectionNotice code="UNKNOWN_CODE" />);
    expect(screen.queryByText(/UNKNOWN_CODE/)).toBeNull();
  });
});
