import { describe, expect, it } from "bun:test";
import { ideaKeys, ideaMutationKeys } from "./query-keys";

describe("ideaMutationKeys (S2: root-key invalidation scope)", () => {
  it("invalida lists() + detail(id) y NUNCA la raiz all", () => {
    const keys = ideaMutationKeys("idea-1");

    // La lista paginada debe refrescarse.
    expect(keys).toContainEqual(ideaKeys.lists());
    // El detalle del item mutado debe refrescarse.
    expect(keys).toContainEqual(ideaKeys.detail("idea-1"));

    // NUNCA la raiz: invalidar ["ideas"] refetchea todos los detail/history/
    // traceability/comments de todos los items del namespace.
    expect(keys).not.toContainEqual(ideaKeys.all);
    const hasRoot = keys.some(
      (k) => Array.isArray(k) && k.length === 1 && k[0] === "ideas",
    );
    expect(hasRoot).toBe(false);
  });

  it("sin id (create) invalida solo lists()", () => {
    expect(ideaMutationKeys()).toEqual([ideaKeys.lists()]);
  });

  it("lists() sigue cubriendo la query de history del panel (keyed bajo list())", () => {
    // useIdeaItemHistory usa ideaKeys.list(`history:...`) => prefijo lists().
    const historyKey = ideaKeys.list("history:idea-1:page=1");
    const listsPrefix = ideaKeys.lists();
    expect(historyKey.slice(0, listsPrefix.length)).toEqual([...listsPrefix]);
  });
});
