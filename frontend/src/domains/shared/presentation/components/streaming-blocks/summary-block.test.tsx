import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { SummaryBlock } from "./summary-block";

describe("SummaryBlock", () => {
  it("renderiza el texto del resumen como markdown", () => {
    const { container } = render(
      <SummaryBlock text={"- Cambié X\n- Añadí Y"} section="Summary" />,
    );
    expect(container.textContent).toContain("Cambié X");
    expect(container.textContent).toContain("Añadí Y");
    // Expect markdown lists to be rendered as <li> nodes, not raw "-".
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("muestra la etiqueta correcta para sección Summary", () => {
    render(<SummaryBlock text="ok" section="Summary" />);
    expect(screen.getByText(/Summary/i)).toBeInTheDocument();
  });

  it("muestra la etiqueta correcta para sección Resumen", () => {
    render(<SummaryBlock text="listo" section="Resumen" />);
    expect(screen.getByText(/Resumen/i)).toBeInTheDocument();
  });

  it("mantiene el bloque dentro de contenedores flexibles para no cortar markdown ancho", () => {
    const { container } = render(
      <SummaryBlock
        text={
          "| Archivo | Cambio |\n|---|---|\n| `frontend/src/domains/wizard/presentation/components/chat-stream.tsx` | `lastMessageStatus` |"
        }
        section="Resumen"
      />,
    );

    expect(container.firstElementChild).toHaveClass("min-w-0");
    expect(container.firstElementChild).toHaveClass("max-w-full");
    expect(container.firstElementChild).toHaveClass("overflow-hidden");
  });
});
