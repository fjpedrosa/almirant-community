import { describe, expect, it } from "bun:test";
import {
  shouldTrackActivationCompleted,
  shouldTrackCloudSignupFunnel,
} from "./signup-analytics";

const attribution = { source: "marketing" as const, placement: "hero" as const };

describe("Cloud signup analytics eligibility", () => {
  it("tracks public Cloud signup", () => {
    expect(shouldTrackCloudSignupFunnel(true, "sign_up", true)).toBe(true);
  });

  it("does not track self-host or initial-admin signup", () => {
    expect(shouldTrackCloudSignupFunnel(false, "sign_up", true)).toBe(false);
    expect(shouldTrackCloudSignupFunnel(true, "initial_admin_setup", true)).toBe(false);
  });

  it("does not track invitation-only signup", () => {
    expect(shouldTrackCloudSignupFunnel(true, "sign_up", false)).toBe(false);
  });

  it("tracks activation only for Cloud public signup attribution", () => {
    expect(shouldTrackActivationCompleted(true, attribution)).toBe(true);
    expect(shouldTrackActivationCompleted(false, attribution)).toBe(false);
    expect(shouldTrackActivationCompleted(true, null)).toBe(false);
  });
});
