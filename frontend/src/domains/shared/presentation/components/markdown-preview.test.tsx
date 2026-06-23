import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { MarkdownPreview } from "./markdown-preview";

describe("MarkdownPreview", () => {
  it("renderiza el resumen fuera de un bloque de código cuando una fence llega sin cerrar", () => {
    const content = [
      "```",
      "Execution plan:",
      "  Wave 1 (parallel): 4 tasks",
      "",
      "## Summary",
      "All tasks completed.",
    ].join("\n");

    render(<MarkdownPreview content={content} size="sm" />);

    expect(
      screen.getByRole("heading", { name: "Summary", level: 2 }),
    ).toBeInTheDocument();
    expect(screen.getByText("All tasks completed.")).toBeInTheDocument();
  });

  it("añade guardas de ancho y wrapping para contenedores estrechos", () => {
    const longWord =
      "supercalifragilisticoespialidosomuylargosinposibilidadesderecorte";

    const { container } = render(
      <MarkdownPreview content={`# ${longWord}\n\n${longWord}\n\n\`${longWord}\``} size="sm" />,
    );

    expect(screen.getAllByText(longWord).length).toBeGreaterThan(0);

    const root = container.firstElementChild;

    expect(root).toBeInTheDocument();
    expect(root).toHaveClass("w-full");
    expect(root).toHaveClass("min-w-0");
    expect(root).toHaveClass("break-words");
    expect(root?.className).toContain("prose-headings:break-words");
    expect(root?.className).toContain("prose-p:break-words");
    expect(root?.className).toContain("prose-code:break-all");
  });
});
