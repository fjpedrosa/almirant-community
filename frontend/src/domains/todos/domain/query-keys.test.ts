import { describe, expect, it } from "bun:test";
import { todoKeys, todoMutationKeys } from "./query-keys";

describe("todoMutationKeys (S2: root-key invalidation scope)", () => {
  it("invalida lists() + detail(id) y NUNCA la raiz all", () => {
    const keys = todoMutationKeys("todo-1");

    expect(keys).toContainEqual(todoKeys.lists());
    expect(keys).toContainEqual(todoKeys.detail("todo-1"));

    expect(keys).not.toContainEqual(todoKeys.all);
    const hasRoot = keys.some(
      (k) => Array.isArray(k) && k.length === 1 && k[0] === "todos",
    );
    expect(hasRoot).toBe(false);
  });

  it("sin id (create) invalida solo lists()", () => {
    expect(todoMutationKeys()).toEqual([todoKeys.lists()]);
  });

  it("lists() sigue cubriendo la query de history del panel (keyed bajo list())", () => {
    const historyKey = todoKeys.list("history:todo-1:page=1");
    const listsPrefix = todoKeys.lists();
    expect(historyKey.slice(0, listsPrefix.length)).toEqual([...listsPrefix]);
  });
});
