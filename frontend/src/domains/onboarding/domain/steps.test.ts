import { describe, expect, it } from "bun:test";

import {
  CLOUD_ONBOARDING_STEPS,
  SELF_HOSTED_ONBOARDING_STEPS,
  getNextOnboardingStep,
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

describe("getNextOnboardingStep", () => {
  it("moves from the Public URL step to the GitHub App step on self-hosted", () => {
    expect(getNextOnboardingStep(SELF_HOSTED_ONBOARDING_STEPS, "tailscale")).toBe("github");
  });

  it("returns null after the last visible step", () => {
    expect(getNextOnboardingStep(SELF_HOSTED_ONBOARDING_STEPS, "github")).toBeNull();
    expect(getNextOnboardingStep(CLOUD_ONBOARDING_STEPS, "github")).toBeNull();
  });

  it("returns null for a step that is not visible", () => {
    expect(getNextOnboardingStep(CLOUD_ONBOARDING_STEPS, "tailscale")).toBeNull();
  });
});
