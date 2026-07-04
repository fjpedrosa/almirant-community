import { describe, expect, it } from "bun:test";
import { seedKeys, seedMutationKeys } from "./query-keys";

describe("seedMutationKeys (S2: root-key invalidation scope)", () => {
  it("invalida lists() + selected() + detail(id) y NUNCA la raiz all", () => {
    const keys = seedMutationKeys("seed-1");

    expect(keys).toContainEqual(seedKeys.lists());
    expect(keys).toContainEqual(seedKeys.detail("seed-1"));
    // selected() vive fuera de lists()/detail(id): toggles de seleccion y
    // ediciones de un seed seleccionado deben refrescar el panel "selected".
    expect(keys).toContainEqual(seedKeys.selected());

    expect(keys).not.toContainEqual(seedKeys.all);
    const hasRoot = keys.some(
      (k) => Array.isArray(k) && k.length === 1 && k[0] === "seeds",
    );
    expect(hasRoot).toBe(false);
  });

  it("sin id (create / bulk) invalida lists() + selected() (sin detail)", () => {
    expect(seedMutationKeys()).toEqual([seedKeys.lists(), seedKeys.selected()]);
  });

  it("detail(id) es prefijo de comments/history/traceability/tags (cubre sub-queries del panel)", () => {
    const detail = seedKeys.detail("seed-1");
    const nested = [
      seedKeys.comments("seed-1"),
      seedKeys.history("seed-1"),
      seedKeys.traceability("seed-1"),
      seedKeys.tags("seed-1"),
    ];
    // invalidateQueries({ queryKey: detail(id) }) hace prefix-match sobre cada
    // una de estas sub-queries anidadas.
    for (const key of nested) {
      expect(key.slice(0, detail.length)).toEqual([...detail]);
    }
  });
});
