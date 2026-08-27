import { beforeEach, describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CodingAgent } from "@/domains/agents/domain/coding-agent-compatibility";

interface ProviderKeyFixture {
  id: string;
  name: string;
  provider: string;
  isActive: boolean;
  lastUsedAt: string | null;
}

let providerKeys: ProviderKeyFixture[] = [];
let preferredKeyId: string | null = null;
const persistPreference = mock((keyId: string | null) => {
  preferredKeyId = keyId;
});

mock.module("@/domains/integrations/application/hooks/use-provider-keys-compat", () => ({
  useProviderKeysCompat: () => ({ data: providerKeys, isLoading: false }),
}));

mock.module("@/domains/integrations/application/hooks/use-ai-provider-preference", () => ({
  useAiProviderPreference: () => ({
    selectedKeyId: preferredKeyId,
    setSelectedKeyId: persistPreference,
  }),
}));

const { useModelSelector } = await import("./use-model-selector");

const Harness = ({ defaultCodingAgent }: { defaultCodingAgent: CodingAgent }) => {
  const selector = useModelSelector({ defaultCodingAgent });

  return (
    <div>
      <span data-testid="agent">{selector.selectedCodingAgent}</span>
      <span data-testid="key">{selector.selectedKeyId}</span>
      <span data-testid="model">{selector.selectedModel}</span>
      <span data-testid="models">{selector.availableModels.join(",")}</span>
      <span data-testid="selected-key-provider">{selector.selectedKey?.provider ?? ""}</span>
      <button type="button" onClick={() => selector.handleCodingAgentChange("pi")}>
        choose-pi
      </button>
      <button type="button" onClick={() => selector.handleModelChange("claude-opus-4-8")}>
        choose-claude-model
      </button>
      <button type="button" onClick={() => selector.handleModelChange("glm-5.2")}>
        choose-disabled-pi-model
      </button>
    </div>
  );
};

const key = (id: string, provider: string): ProviderKeyFixture => ({
  id,
  name: id,
  provider,
  isActive: true,
  lastUsedAt: null,
});

describe("useModelSelector", () => {
  beforeEach(() => {
    providerKeys = [];
    preferredKeyId = null;
    persistPreference.mockClear();
  });

  it("derives only GLM-5.3 for Pi across multiple Z.AI key identities", async () => {
    providerKeys = [
      key("anthropic-key", "anthropic"),
      key("zai-primary", "zai"),
      key("zai-secondary", "zai"),
    ];
    preferredKeyId = "anthropic-key";

    render(<Harness defaultCodingAgent="pi" />);

    await waitFor(() => {
      expect(screen.getByTestId("key")).toHaveTextContent("zai-primary");
    });
    expect(screen.getByTestId("selected-key-provider")).toHaveTextContent("zai");
    expect(screen.getByTestId("models").textContent).toBe("glm-5.3");
    expect(screen.getByTestId("model")).toHaveTextContent("glm-5.3");

    fireEvent.click(screen.getByRole("button", { name: "choose-disabled-pi-model" }));
    expect(screen.getByTestId("model")).toHaveTextContent("glm-5.3");
  });

  it("switches from an incompatible key and stale model to a Z.AI key and GLM-5.3", async () => {
    providerKeys = [
      key("anthropic-key", "anthropic"),
      key("zai-primary", "zai"),
      key("zai-secondary", "zai"),
    ];
    preferredKeyId = "anthropic-key";

    render(<Harness defaultCodingAgent="claude-code" />);

    fireEvent.click(screen.getByRole("button", { name: "choose-claude-model" }));
    expect(screen.getByTestId("model")).toHaveTextContent("claude-opus-4-8");

    fireEvent.click(screen.getByRole("button", { name: "choose-pi" }));

    await waitFor(() => {
      expect(screen.getByTestId("key")).toHaveTextContent("zai-primary");
      expect(screen.getByTestId("model")).toHaveTextContent("glm-5.3");
    });
    expect(screen.getByTestId("models").textContent).toBe("glm-5.3");
    expect(preferredKeyId).toBe("zai-primary");
  });

  it("exposes no key, models, or retained model when Pi has no compatible key", () => {
    providerKeys = [key("anthropic-key", "anthropic")];
    preferredKeyId = "anthropic-key";

    render(<Harness defaultCodingAgent="pi" />);

    expect(screen.getByTestId("key")).toBeEmptyDOMElement();
    expect(screen.getByTestId("selected-key-provider")).toBeEmptyDOMElement();
    expect(screen.getByTestId("models")).toBeEmptyDOMElement();
    expect(screen.getByTestId("model")).toBeEmptyDOMElement();
  });

  it("preserves exact existing-agent model ordering", () => {
    providerKeys = [key("openai-key", "openai")];
    preferredKeyId = "openai-key";

    render(<Harness defaultCodingAgent="codex" />);

    expect(screen.getByTestId("models").textContent?.split(",").slice(0, 3)).toEqual([
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
    ]);
    expect(screen.getByTestId("model")).toHaveTextContent("gpt-5.6-sol");
  });
});
