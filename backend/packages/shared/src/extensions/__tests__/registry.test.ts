import { describe, it, expect, beforeEach } from "bun:test";
import {
  setActivityLogger,
  getActivityLogger,
  __resetExtensionsForTests,
  type ActivityLogger,
} from "../index";

describe("extensions registry", () => {
  beforeEach(() => {
    __resetExtensionsForTests();
  });

  it("throws a clear error if a getter is called before bootstrap", () => {
    expect(() => getActivityLogger()).toThrow(/ActivityLogger not bootstrapped/);
  });

  it("returns the registered implementation after set", () => {
    const impl: ActivityLogger = { log: () => {} };
    setActivityLogger(impl);
    expect(getActivityLogger()).toBe(impl);
  });

  it("allows replacing an implementation (last set wins)", () => {
    const first: ActivityLogger = { log: () => {} };
    const second: ActivityLogger = { log: () => {} };
    setActivityLogger(first);
    setActivityLogger(second);
    expect(getActivityLogger()).toBe(second);
  });

  it("reset clears registrations", () => {
    setActivityLogger({ log: () => {} });
    __resetExtensionsForTests();
    expect(() => getActivityLogger()).toThrow();
  });
});
