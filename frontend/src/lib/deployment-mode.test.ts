import { describe, expect, it } from "bun:test";

import { isCloudDeployment, isCloudDeploymentFromEnv } from "./deployment-mode";

describe("isCloudDeploymentFromEnv", () => {
  it("is true only for the exact string 'true'", () => {
    expect(isCloudDeploymentFromEnv({ NEXT_PUBLIC_IS_CLOUD: "true" })).toBe(true);
  });

  it("is false when the flag is unset (self-hosted default)", () => {
    expect(isCloudDeploymentFromEnv({})).toBe(false);
    expect(isCloudDeploymentFromEnv({ NEXT_PUBLIC_IS_CLOUD: undefined })).toBe(
      false,
    );
  });

  it("is false for any non-'true' value (fail-safe)", () => {
    expect(isCloudDeploymentFromEnv({ NEXT_PUBLIC_IS_CLOUD: "false" })).toBe(
      false,
    );
    expect(isCloudDeploymentFromEnv({ NEXT_PUBLIC_IS_CLOUD: "1" })).toBe(false);
    expect(isCloudDeploymentFromEnv({ NEXT_PUBLIC_IS_CLOUD: "TRUE" })).toBe(
      false,
    );
    expect(isCloudDeploymentFromEnv({ NEXT_PUBLIC_IS_CLOUD: " true " })).toBe(
      false,
    );
  });
});

describe("isCloudDeployment", () => {
  it("reads process.env and returns a boolean", () => {
    // No env mutation: we only assert the shape/type, so the surrounding
    // process.env (self-hosted by default in CI) stays untouched.
    expect(typeof isCloudDeployment()).toBe("boolean");
  });
});
