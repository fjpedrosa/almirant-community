import { describe, expect, it } from "bun:test";
import { registerCloudExtensions } from "./bootstrap-extensions";

describe("cloud bootstrap-extensions seam", () => {
  it("is a synchronous no-op by default", () => {
    expect(() => registerCloudExtensions()).not.toThrow();
    expect(registerCloudExtensions()).toBeUndefined();
  });
});
