import { describe, expect, it } from "bun:test";
import { getSignupAttribution } from "./signup-attribution";

describe("getSignupAttribution", () => {
  it("preserves allowlisted marketing context", () => {
    expect(
      getSignupAttribution({
        source: "marketing",
        placement: "pricing",
        plan: "pro",
      }),
    ).toEqual({ source: "marketing", placement: "pricing", plan: "pro" });
  });

  it("drops arbitrary query values and uses stable defaults", () => {
    expect(
      getSignupAttribution({
        source: "visitor@example.test",
        placement: "<script>",
        plan: "enterprise",
      }),
    ).toEqual({ source: "direct", placement: "direct" });
  });
});
