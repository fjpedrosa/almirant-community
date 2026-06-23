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
  it("mantiene colapsado y permite expandir el reasoning de sesiones terminadas", () => {
    render(<CompletedTranscriptHarness />);

    const reasoningButton = screen.getByRole("button", { name: /Reasoning/i });

    expect(reasoningButton.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(reasoningButton);

    expect(reasoningButton.getAttribute("aria-expanded")).toBe("true");
  });
});
