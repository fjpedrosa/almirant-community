import { describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import { OrchestrationSettings } from "./orchestration-settings";

mock.module("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("OrchestrationSettings", () => {
  it("renderiza el contenido principal en layout responsive de dos columnas", () => {
    render(
      <OrchestrationSettings
        strategy="round_robin"
        isLoading={false}
        isSaving={false}
        connections={[
          {
            id: "connection-1",
            name: "OpenAI main",
            provider: "openai",
            isActive: true,
            suspendedAt: null,
            orchestrationEnabled: true,
          },
        ]}
        isLoadingConnections={false}
        onStrategyChange={() => {}}
      />,
    );

    expect(screen.getByTestId("orchestration-settings-layout")).toHaveClass(
      "xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]",
    );
    expect(screen.getByTestId("orchestration-strategy-grid")).toHaveClass(
      "md:grid-cols-2",
    );
  });
});
