import { describe, expect, it } from "bun:test";
import { expenseKeys, expenseMutationKeys } from "./query-keys";

describe("expenseMutationKeys (S2: root-key invalidation scope)", () => {
  it("invalida lists() + aggregations + detail(id) y NUNCA la raiz all", () => {
    const keys = expenseMutationKeys("exp-1");

    expect(keys).toContainEqual(expenseKeys.lists());
    expect(keys).toContainEqual(expenseKeys.aggregationsAll());
    expect(keys).toContainEqual(expenseKeys.detail("exp-1"));

    expect(keys).not.toContainEqual(expenseKeys.all);
    const hasRoot = keys.some(
      (k) => Array.isArray(k) && k.length === 1 && k[0] === "expenses",
    );
    expect(hasRoot).toBe(false);
  });

  it("NO toca categories() ni recurring() (mutaciones dedicadas)", () => {
    const keys = expenseMutationKeys("exp-1");
    expect(keys).not.toContainEqual(expenseKeys.categories());
    expect(keys).not.toContainEqual(expenseKeys.recurring());
  });

  it("sin id (create) invalida lists() + aggregations (sin detail)", () => {
    expect(expenseMutationKeys()).toEqual([
      expenseKeys.lists(),
      expenseKeys.aggregationsAll(),
    ]);
  });

  it("aggregationsAll() es prefijo de aggregations(filters) (cubre todas las variantes)", () => {
    const root = expenseKeys.aggregationsAll();
    const withFilters = expenseKeys.aggregations("month=2026-07");
    expect(withFilters.slice(0, root.length)).toEqual([...root]);
  });
});
