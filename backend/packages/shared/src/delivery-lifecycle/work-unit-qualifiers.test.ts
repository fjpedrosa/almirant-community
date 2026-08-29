import { describe, expect, test } from "bun:test";
import { parseWorkUnitQualifiers } from "./work-unit-qualifiers";

describe("dormant Work Unit qualifiers", () => {
  test("accepts every size with either origin and both backlog intents", () => {
    const sizes = ["XS", "S", "M", "L", "XL"] as const;
    expect(sizes.map((workUnitSize) => parseWorkUnitQualifiers({
      workUnitSize,
      workUnitSizeOrigin: "plan",
      backlogIntent: "new",
    }).workUnitSize)).toEqual(sizes);
    expect(parseWorkUnitQualifiers({
      workUnitSize: "L",
      workUnitSizeOrigin: "legacy_points",
      backlogIntent: "fix",
    })).toEqual({
      workUnitSize: "L",
      workUnitSizeOrigin: "legacy_points",
      backlogIntent: "fix",
    });
  });

  test("accepts an unqualified legacy row", () => {
    expect(parseWorkUnitQualifiers({
      workUnitSize: null,
      workUnitSizeOrigin: null,
      backlogIntent: null,
    })).toEqual({
      workUnitSize: null,
      workUnitSizeOrigin: null,
      backlogIntent: null,
    });
  });

  test("rejects partial pairs, invalid values, and unknown keys", () => {
    for (const value of [
      { workUnitSize: "M", workUnitSizeOrigin: null, backlogIntent: "new" },
      { workUnitSize: null, workUnitSizeOrigin: "plan", backlogIntent: "new" },
      { workUnitSize: "XXL", workUnitSizeOrigin: "plan", backlogIntent: "new" },
      { workUnitSize: "M", workUnitSizeOrigin: "guess", backlogIntent: "new" },
      { workUnitSize: "M", workUnitSizeOrigin: "plan", backlogIntent: "todo" },
      { workUnitSize: "M", workUnitSizeOrigin: "plan", backlogIntent: "new", points: 3 },
    ]) {
      expect(() => parseWorkUnitQualifiers(value)).toThrow();
    }
  });
});
