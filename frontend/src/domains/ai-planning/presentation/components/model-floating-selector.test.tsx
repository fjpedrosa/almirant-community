import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import type { CodingAgent } from "@/domains/agents/domain/coding-agent-compatibility";

mock.module("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

mock.module("next/link", () => ({
  default: ({ children, href, ...props }: { children?: ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

const Passthrough = ({ children }: { children?: ReactNode }) => <>{children}</>;

mock.module("@/components/ui/popover", () => ({
  Popover: Passthrough,
  PopoverContent: Passthrough,
  PopoverTrigger: Passthrough,
}));

const { ModelFloatingSelector } = await import("./model-floating-selector");

interface KeyFixture {
  id: string;
  name: string;
  provider: string;
}

const ControlledSelector = ({
  keys,
  initialKeyId,
  initialAgent,
  selectedModel = "glm-5.3",
  onKeyChange = () => {},
  onModelChange = () => {},
}: {
  keys: KeyFixture[];
  initialKeyId: string;
  initialAgent: CodingAgent;
  selectedModel?: string;
  onKeyChange?: (keyId: string) => void;
  onModelChange?: (model: string) => void;
}) => {
  const [selectedKeyId, setSelectedKeyId] = useState(initialKeyId);
  const [selectedCodingAgent, setSelectedCodingAgent] = useState(initialAgent);

  return (
    <ModelFloatingSelector
      providerKeys={keys}
      selectedKeyId={selectedKeyId}
      selectedModel={selectedModel}
      availableModels={[]}
      hasKeys={keys.length > 0}
      isLoading={false}
      onKeyChange={(keyId) => {
        setSelectedKeyId(keyId);
        onKeyChange(keyId);
      }}
      onModelChange={onModelChange}
      isSessionActive={false}
      selectedCodingAgent={selectedCodingAgent}
      onCodingAgentChange={setSelectedCodingAgent}
    />
  );
};

describe("ModelFloatingSelector", () => {
  it("shows only GLM-5.3 for Pi after choosing among multiple Z.AI keys", () => {
    const onKeyChange = mock(() => {});
    const onModelChange = mock(() => {});
    render(
      <ControlledSelector
        keys={[
          { id: "zai-primary", name: "Z.AI Primary", provider: "zai" },
          { id: "zai-secondary", name: "Z.AI Secondary", provider: "zai" },
        ]}
        initialKeyId="zai-primary"
        initialAgent="claude-code"
        onKeyChange={onKeyChange}
        onModelChange={onModelChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Pi" }));
    fireEvent.click(screen.getByRole("button", { name: /Z\.AI Secondary$/ }));

    expect(onKeyChange).toHaveBeenCalledWith("zai-secondary");
    expect(screen.getByRole("button", { name: /^GLM-5\.3/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^GLM-5\.2/ })).not.toBeInTheDocument();
    expect(onModelChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /^GLM-5\.3/ }));
    expect(onModelChange).toHaveBeenCalledWith("glm-5.3");
  });

  it("keeps the existing Claude Code Z.AI model choices", () => {
    render(
      <ControlledSelector
        keys={[
          { id: "anthropic-key", name: "Anthropic", provider: "anthropic" },
          { id: "zai-key", name: "Z.AI", provider: "zai" },
        ]}
        initialKeyId="anthropic-key"
        initialAgent="claude-code"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Claude Code.*Current/ }));
    fireEvent.click(screen.getByRole("button", { name: /Z\.AI$/ }));

    expect(screen.getByRole("button", { name: /^GLM-5\.3/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^GLM-5\.2/ })).toBeInTheDocument();
  });

  it("preserves a raw historical or future model label in readonly mode", () => {
    render(
      <ModelFloatingSelector
        providerKeys={[]}
        selectedKeyId=""
        selectedModel="glm-future-historical"
        availableModels={[]}
        hasKeys={false}
        isLoading={false}
        onKeyChange={() => {}}
        onModelChange={() => {}}
        isSessionActive
        activeModelLabel="Z.AI / glm-future-historical"
        selectedCodingAgent="pi"
      />,
    );

    expect(screen.getByText("Z.AI / glm-future-historical")).toBeInTheDocument();
    expect(screen.queryByText("model")).not.toBeInTheDocument();
  });
});
