import { describe, expect, it } from "bun:test";

import { getInvitationAppBaseUrl, normalizeSiteUrl } from "./site-url";

describe("normalizeSiteUrl", () => {
  it("canonicalizes Almirant production URLs to the www host", () => {
    expect(normalizeSiteUrl("https://almirant.ai")).toBe(
      "https://www.almirant.ai",
    );
    expect(normalizeSiteUrl("https://www.almirant.ai/")).toBe(
      "https://www.almirant.ai",
    );
  });

  it("keeps non-Almirant hosts unchanged", () => {
    expect(normalizeSiteUrl("https://preview.almirant.dev")).toBe(
      "https://preview.almirant.dev",
    );
  });
});

describe("getInvitationAppBaseUrl", () => {
  it("prioritizes the public site URL over a localhost Better Auth URL", () => {
    expect(
      getInvitationAppBaseUrl({
        NEXT_PUBLIC_SITE_URL: "https://www.almirant.ai",
        BETTER_AUTH_URL: "http://localhost:3000",
      }),
    ).toBe("https://www.almirant.ai");
  });

  it("falls back to Better Auth URL in local development", () => {
    expect(
      getInvitationAppBaseUrl({
        BETTER_AUTH_URL: "http://localhost:3000",
      }),
    ).toBe("http://localhost:3000");
  });
});
