import { describe, expect, it } from "bun:test";
import { summarizeResultPayload } from "./summarize-result-payload";

describe("summarizeResultPayload", () => {
  it("prefiere un resumen humano sin asumir que el payload es texto", () => {
    expect(
      summarizeResultPayload({
        summary: "Catálogo procesado correctamente",
        products: [{ name: "Producto A" }],
      }),
    ).toBe("Catálogo procesado correctamente");
  });

  it("resume arrays y objetos de forma compacta y determinista", () => {
    expect(summarizeResultPayload(["A", "B", "C"])).toBe("3 elementos");
    expect(
      summarizeResultPayload({
        status: { ok: true },
        products: [],
        total: 42,
      }),
    ).toBe("3 campos · status, products, total");
  });

  it("acorta solo el resumen, sin modificar el payload original", () => {
    const payload = { message: "resultado ".repeat(40).trim() };
    const preview = summarizeResultPayload(payload);

    expect(preview.length).toBeLessThanOrEqual(144);
    expect(preview).toEndWith("…");
    expect(payload.message.length).toBeGreaterThan(preview.length);
  });
});
