import { describe, expect, it } from "bun:test";

import {
  CLOUD_ONBOARDING_STEPS,
  SELF_HOSTED_ONBOARDING_STEPS,
  getVisibleOnboardingSteps,
} from "./steps";

describe("getVisibleOnboardingSteps", () => {
  it("shows only the GitHub App step in cloud", () => {
    expect(getVisibleOnboardingSteps(true)).toEqual(["github"]);
    expect(getVisibleOnboardingSteps(true)).toBe(CLOUD_ONBOARDING_STEPS);
  });

  it("shows admin, tailscale and github for self-hosted", () => {
    expect(getVisibleOnboardingSteps(false)).toEqual([
      "admin",
      "tailscale",
      "github",
    ]);
    expect(getVisibleOnboardingSteps(false)).toBe(SELF_HOSTED_ONBOARDING_STEPS);
  });
});
