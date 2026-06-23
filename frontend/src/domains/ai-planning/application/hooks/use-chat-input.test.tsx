import { describe, expect, it, mock } from "bun:test";
import { act, render, screen } from "@testing-library/react";
import { useChatInput } from "./use-chat-input";

const Harness = ({
  resetKey,
  onSend,
}: {
  resetKey: string | null;
  onSend: (message: string) => void;
}) => {
  const input = useChatInput(onSend, false, false, resetKey);

  return (
    <div>
      <span data-testid="value">{input.value}</span>
      <span data-testid="can-send">{input.canSend ? "yes" : "no"}</span>
      <button type="button" onClick={() => input.onChange("Texto borrador")}>
        escribir
      </button>
      <button type="button" onClick={() => input.onSend()}>
        enviar
      </button>
    </div>
  );
};

describe("useChatInput", () => {
  it("limpia el borrador cuando cambia la sesion activa", () => {
    const onSend = mock(() => {});
    const { rerender } = render(
      <Harness resetKey="session-a" onSend={onSend} />,
    );

    act(() => {
      screen.getByText("escribir").click();
    });

    expect(screen.getByTestId("value")).toHaveTextContent("Texto borrador");
    expect(screen.getByTestId("can-send")).toHaveTextContent("yes");

    rerender(<Harness resetKey="session-b" onSend={onSend} />);

    expect(screen.getByTestId("value")).toHaveTextContent("");
    expect(screen.getByTestId("can-send")).toHaveTextContent("no");
  });

  it("mantiene el envio y vuelve a limpiar el valor despues de enviar", () => {
    const onSend = mock(() => {});
    render(<Harness resetKey="session-a" onSend={onSend} />);

    act(() => {
      screen.getByText("escribir").click();
    });

    act(() => {
      screen.getByText("enviar").click();
    });

    expect(onSend).toHaveBeenCalledWith("Texto borrador");
    expect(screen.getByTestId("value")).toHaveTextContent("");
  });
});
