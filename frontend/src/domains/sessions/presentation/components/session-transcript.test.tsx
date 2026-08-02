import { beforeAll, describe, expect, it } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { useCallback, useState } from "react";
import { SessionTranscript } from "./session-transcript";
import type { StreamingBlock } from "@/domains/shared/domain/streaming-block-types";

const completedThinkingBlocks: StreamingBlock[] = [
  {
    type: "thinking",
    content: "Razonamiento interno de una sesión ya terminada",
  },
];

const CompletedTranscriptHarness = () => {
  const [openIndexes, setOpenIndexes] = useState<Set<number>>(new Set());

  const isThinkingOpen = useCallback(
    (index: number) => openIndexes.has(index),
    [openIndexes],
  );

  const onThinkingToggle = useCallback((index: number) => {
    setOpenIndexes((previous) => {
      const next = new Set(previous);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  return (
    <SessionTranscript
      transcript=""
      isStreaming={false}
      isLoading={false}
      messages={[
        {
          id: "user-1",
          role: "user",
          content: "Revisa la sesión",
          messageType: "user",
        },
      ]}
      streamingBlocks={completedThinkingBlocks}
      isThinkingOpen={isThinkingOpen}
      onThinkingToggle={onThinkingToggle}
    />
  );
};

beforeAll(() => {
  if (typeof globalThis.requestAnimationFrame === "undefined") {
    globalThis.requestAnimationFrame = (callback: FrameRequestCallback) =>
      setTimeout(() => callback(performance.now()), 0) as unknown as number;
  }
  if (typeof globalThis.cancelAnimationFrame === "undefined") {
    globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);
  }
});

describe("SessionTranscript", () => {
  it("integra resultado y conversación dentro del mismo scroll vertical y padding", () => {
    const { container } = render(
      <SessionTranscript
        transcript="Contenido del transcript"
        resultPayload={{ summary: "Resultado compacto", status: "ok" }}
        isStreaming={false}
        isLoading={false}
      />,
    );

    const scrollArea = container.querySelector('[data-slot="scroll-area"]');
    const resultPanel = screen.getByTestId("session-result-panel");
    expect(scrollArea).toContainElement(resultPanel);
    expect(scrollArea).toHaveClass(
      "min-h-0",
      "w-full",
      "max-w-full",
      "overflow-hidden",
    );

    const transcriptContent = screen.getByTestId("session-transcript-content");
    expect(transcriptContent).toHaveClass("px-4", "sm:px-6", "min-w-0");
    expect(transcriptContent).toContainElement(resultPanel);
    expect(screen.getByText("Contenido del transcript")).toBeInTheDocument();
  });

  it("mantiene el resultado en el scroll mientras el transcript aún carga", () => {
    const { container } = render(
      <SessionTranscript
        transcript=""
        resultPayload={{ summary: "Resultado ya disponible" }}
        isStreaming={false}
        isLoading
      />,
    );

    const scrollArea = container.querySelector('[data-slot="scroll-area"]');
    expect(scrollArea).toContainElement(
      screen.getByTestId("session-result-panel"),
    );
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(
      0,
    );
  });

  it("mantiene colapsado y permite expandir el reasoning de sesiones terminadas", () => {
    render(<CompletedTranscriptHarness />);

    // A completed reasoning row is headlined with what the agent worked out,
    // not with the generic "Reasoning" label.
    const reasoningButton = screen.getByRole("button", {
      name: /Razonamiento interno de una sesión ya terminada/i,
    });

    expect(reasoningButton.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(reasoningButton);

    expect(reasoningButton.getAttribute("aria-expanded")).toBe("true");
  });
});
