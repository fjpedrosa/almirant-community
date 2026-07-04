import { describe, expect, it } from "bun:test";
import { shouldFetchExpenseList } from "./dashboard-tabs";

describe("shouldFetchExpenseList (expenses list is eager only on the list tab)", () => {
  it("is true only on the list tab", () => {
    expect(shouldFetchExpenseList("list")).toBe(true);
  });

  it("is false on overview / recurring", () => {
    expect(shouldFetchExpenseList("overview")).toBe(false);
    expect(shouldFetchExpenseList("recurring")).toBe(false);
    expect(shouldFetchExpenseList("")).toBe(false);
  });
});
