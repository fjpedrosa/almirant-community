import { describe, expect, it } from "bun:test";
import { buildSessionResultViewModel } from "./build-session-result-view-model";

describe("buildSessionResultViewModel", () => {
  it("clasifica catálogos y prepara su resumen fuera de presentación", () => {
    const model = buildSessionResultViewModel({
      storeHostname: "example.test",
      products: [{ name: "A" }, { name: "B" }],
    });

    expect(model.kind).toBe("catalogue");
    if (model.kind === "catalogue") {
      expect(model.summary).toBe("2 productos · example.test");
      expect(model.products).toHaveLength(2);
    }
  });

  it("prepara payloads estructurados como una variante discriminada", () => {
    const payload = { summary: "Importación completada", created: 12 };
    const model = buildSessionResultViewModel(payload);

    expect(model).toEqual({
      kind: "structured",
      summary: "Importación completada",
      value: payload,
    });
  });
});
