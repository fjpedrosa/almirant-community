import { describe, expect, it } from "bun:test";
import { githubStepStatusEnabled, tailscaleStatusEnabled } from "./gating";

describe("tailscaleStatusEnabled (cloud never polls tailscale status)", () => {
  it("is disabled on a cloud deployment", () => {
    expect(tailscaleStatusEnabled(true)).toBe(false);
  });

  it("is enabled on a self-hosted deployment", () => {
    expect(tailscaleStatusEnabled(false)).toBe(true);
  });
});

describe("githubStepStatusEnabled (github status only when its step is visible)", () => {
  it("is enabled only on the github step", () => {
    expect(githubStepStatusEnabled("github")).toBe(true);
  });

  it("is disabled on every other step", () => {
    expect(githubStepStatusEnabled("admin")).toBe(false);
    expect(githubStepStatusEnabled("tailscale")).toBe(false);
    expect(githubStepStatusEnabled("")).toBe(false);
  });
});
