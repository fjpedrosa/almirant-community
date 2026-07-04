import { describe, expect, it } from "bun:test";
import { expenseKeys, expenseMutationKeys, recurringSummaryKey } from "./query-keys";

describe("recurringSummaryKey (dashboard recurring-summary lives under recurring())", () => {
  it("is nested under expenseKeys.recurring() so recurring mutations invalidate it", () => {
    const summary = recurringSummaryKey();
    const recurring = expenseKeys.recurring();
    // recurring() must be a prefix of the summary key -> invalidateQueries on
    // recurring() reaches the dashboard summary (previously an orphan key).
    expect(summary.slice(0, recurring.length)).toEqual([...recurring]);
    expect(summary.length).toBeGreaterThan(recurring.length);
  });

  it("is NOT the old orphan key ['recurring-expenses','summary']", () => {
    expect(recurringSummaryKey()).not.toEqual(["recurring-expenses", "summary"]);
  });
});

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
