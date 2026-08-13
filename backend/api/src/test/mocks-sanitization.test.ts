import { describe, expect, it } from "bun:test";
import { FakeDrizzleQueryError, expectSanitized } from "./mocks";

const fallback = "Internal server error";
const forbiddenFragments = ["Failed query", "select", "secret"];

describe("shared sanitization test helpers", () => {
  it("preserves a Drizzle-shaped error message while identifying its error type", () => {
    const error = new FakeDrizzleQueryError("Failed query: select secret from users");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("DrizzleQueryError");
    expect(error.message).toBe("Failed query: select secret from users");
  });

  it("asserts a safe HTTP body without hiding the curated fallback", () => {
    expectSanitized({ success: false, error: fallback }, fallback, forbiddenFragments);
  });

  it("rejects a successful response body", () => {
    expect(() => expectSanitized({ success: true, error: fallback }, fallback, forbiddenFragments)).toThrow();
  });

  it("rejects the wrong fallback message", () => {
    expect(() => expectSanitized({ success: false, error: "leaked fallback" }, fallback, forbiddenFragments)).toThrow();
  });

  it.each(forbiddenFragments)("rejects the forbidden fragment %s", (fragment: string) => {
    const leaked = `${fallback}: ${fragment}`;
    expect(() => expectSanitized({ success: false, error: leaked }, leaked, [fragment])).toThrow();
  });
});
