import { describe, expect, it } from "bun:test";
import { getTrustedOrigins } from "./auth.ts";

// `getTrustedOrigins` is pure once its config-env slice and process-env slice
// are injected. We pass explicit maps so the assertions never depend on the
// ambient environment. (Importing auth.ts eagerly builds the module-level auth
// instance with the REAL config, but that is orthogonal to these assertions.)

const devProcessEnv = { NODE_ENV: "development" };

describe("getTrustedOrigins", () => {
  it("seeds the dev frontend origins in non-production", () => {
    const result = getTrustedOrigins(
      null,
      { CORS_ORIGIN: "" },
      devProcessEnv,
    );

    // localhost + orbstack, each expanded with its www variant
    expect(result).toEqual([
      "http://localhost:3000",
      "http://www.localhost:3000",
      "https://frontend.almirant.orb.local",
      "https://www.frontend.almirant.orb.local",
    ]);
  });

  it("omits the dev origins in production", () => {
    const result = getTrustedOrigins(
      null,
      { CORS_ORIGIN: "https://app.example.com" },
      { NODE_ENV: "production" },
    );

    expect(result).toEqual([
      "https://app.example.com",
      "https://www.app.example.com",
    ]);
  });

  it("expands every origin with its www / apex variant and preserves precedence", () => {
    const result = getTrustedOrigins(
      "https://tail.example.com",
      {
        CORS_ORIGIN: "https://app.example.com",
        BETTER_AUTH_TRUSTED_ORIGINS: "https://extra.example.com",
      },
      devProcessEnv,
    );

    expect(result).toEqual([
      // dev origins first
      "http://localhost:3000",
      "http://www.localhost:3000",
      "https://frontend.almirant.orb.local",
      "https://www.frontend.almirant.orb.local",
      // CORS_ORIGIN
      "https://app.example.com",
      "https://www.app.example.com",
      // runtime publicUrl
      "https://tail.example.com",
      "https://www.tail.example.com",
      // explicit BETTER_AUTH_TRUSTED_ORIGINS overrides
      "https://extra.example.com",
      "https://www.extra.example.com",
    ]);
  });

  it("expands an apex host from a www-prefixed origin", () => {
    const result = getTrustedOrigins(
      null,
      { CORS_ORIGIN: "https://www.almirant.ai" },
      { NODE_ENV: "production" },
    );

    expect(result).toEqual([
      "https://www.almirant.ai",
      "https://almirant.ai",
    ]);
  });

  it("de-dupes overlapping origins while keeping the first occurrence", () => {
    const result = getTrustedOrigins(
      "http://localhost:3000", // already a dev origin
      {
        CORS_ORIGIN: "http://localhost:3000,https://app.example.com",
        BETTER_AUTH_TRUSTED_ORIGINS: "https://app.example.com",
      },
      devProcessEnv,
    );

    expect(result).toEqual([
      "http://localhost:3000",
      "http://www.localhost:3000",
      "https://frontend.almirant.orb.local",
      "https://www.frontend.almirant.orb.local",
      "https://app.example.com",
      "https://www.app.example.com",
    ]);
    // no value appears twice
    expect(new Set(result).size).toBe(result.length);
  });

  it("parses multiple comma-separated CORS origins and trims whitespace", () => {
    const result = getTrustedOrigins(
      null,
      { CORS_ORIGIN: "https://a.example.com , https://b.example.com" },
      { NODE_ENV: "production" },
    );

    expect(result).toEqual([
      "https://a.example.com",
      "https://www.a.example.com",
      "https://b.example.com",
      "https://www.b.example.com",
    ]);
  });

  it("drops unparseable CORS entries", () => {
    const result = getTrustedOrigins(
      null,
      { CORS_ORIGIN: "not-a-url,https://ok.example.com" },
      { NODE_ENV: "production" },
    );

    expect(result).toEqual([
      "https://ok.example.com",
      "https://www.ok.example.com",
    ]);
  });
});
