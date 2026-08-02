import { describe, expect, it } from "bun:test";
import { loadBridgeEnv } from "../src/config";

const baseEnv = {
  REDIS_URL: "redis://localhost:6379",
};

describe("web-bridge production persistence configuration", () => {
  it("requires the backend URL and service-account key together in production", () => {
    expect(() =>
      loadBridgeEnv({
        ...baseEnv,
        NODE_ENV: "production",
      }),
    ).toThrow("BACKEND_API_URL");
    expect(() =>
      loadBridgeEnv({
        ...baseEnv,
        NODE_ENV: "production",
        BACKEND_API_URL: "https://cloud.almirant.ai",
      }),
    ).toThrow("BRIDGE_API_KEY");
  });

  it("accepts a complete production persistence configuration", () => {
    expect(
      loadBridgeEnv({
        ...baseEnv,
        NODE_ENV: "production",
        BACKEND_API_URL: "https://cloud.almirant.ai",
        BRIDGE_API_KEY: "alm_sa_test",
      }),
    ).toMatchObject({
      BACKEND_API_URL: "https://cloud.almirant.ai",
      BRIDGE_API_KEY: "alm_sa_test",
    });
  });
});
