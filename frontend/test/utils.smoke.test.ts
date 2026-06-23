import { describe, expect, it } from "bun:test";
import { cn } from "@/lib/utils";

describe("frontend smoke", () => {
  it("resolves tsconfig path aliases and runs basic assertions", () => {
    expect(cn("a", false && "b", "c")).toBe("a c");
  });
});

