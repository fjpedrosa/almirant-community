import { describe, expect, it } from "bun:test";
import {
  getInvitationAppBaseUrl,
  normalizeSiteUrl,
} from "./invitation-app-base-url";

// Pure functions: every input is injected as an explicit env map, so these
// tests have NO module side effects (no config / DB import triggered).

describe("normalizeSiteUrl", () => {
  it("returns null for empty / blank / nullish input", () => {
    expect(normalizeSiteUrl(undefined)).toBeNull();
    expect(normalizeSiteUrl(null)).toBeNull();
    expect(normalizeSiteUrl("")).toBeNull();
    expect(normalizeSiteUrl("   ")).toBeNull();
  });

  it("prepends https:// when the scheme is missing and strips a trailing slash", () => {
    expect(normalizeSiteUrl("example.com")).toBe("https://example.com");
    expect(normalizeSiteUrl("https://example.com/")).toBe("https://example.com");
  });

  it("preserves an explicit http:// scheme", () => {
    expect(normalizeSiteUrl("http://localhost:3000")).toBe(
      "http://localhost:3000",
    );
  });

  it("canonicalizes the apex almirant host to the www host", () => {
    expect(normalizeSiteUrl("https://almirant.ai")).toBe(
      "https://www.almirant.ai",
    );
    expect(normalizeSiteUrl("almirant.ai")).toBe("https://www.almirant.ai");
    // already-canonical host stays untouched
    expect(normalizeSiteUrl("https://www.almirant.ai")).toBe(
      "https://www.almirant.ai",
    );
  });

  it("returns null for a value that cannot be parsed as a URL", () => {
    expect(normalizeSiteUrl("http://")).toBeNull();
  });
});

describe("getInvitationAppBaseUrl precedence", () => {
  it("prefers NEXT_PUBLIC_SITE_URL over everything else", () => {
    const result = getInvitationAppBaseUrl({
      NEXT_PUBLIC_SITE_URL: "https://app.example.com",
      BETTER_AUTH_URL: "https://auth.example.com",
      VERCEL_URL: "vercel.example.com",
    });

    expect(result).toBe("https://app.example.com");
  });

  it("falls back to the frontend origin (first CORS_ORIGIN) — NOT the API issuer BETTER_AUTH_URL — when NEXT_PUBLIC_SITE_URL is absent", () => {
    // Regression: in split-origin (cloud) deployments BETTER_AUTH_URL is the API
    // issuer origin (e.g. https://api.almirant.ai), which has NO accept-invitation
    // page. The accept page lives on the FRONTEND, so the link base must be the
    // configured frontend origin (first CORS_ORIGIN entry).
    const result = getInvitationAppBaseUrl({
      NEXT_PUBLIC_SITE_URL: undefined,
      BETTER_AUTH_URL: "https://api.almirant.ai",
      CORS_ORIGIN: "https://cloud.almirant.ai,https://www.almirant.ai",
      VERCEL_URL: "vercel.example.com",
    });

    expect(result).toBe("https://cloud.almirant.ai");
  });

  it("never returns the API issuer even when CORS_ORIGIN is absent (skips BETTER_AUTH_URL entirely)", () => {
    const result = getInvitationAppBaseUrl({
      NEXT_PUBLIC_SITE_URL: undefined,
      BETTER_AUTH_URL: "https://api.almirant.ai",
      VERCEL_URL: "my-app.vercel.app",
    });

    // No frontend origin configured → next candidate is VERCEL_URL, never the API.
    expect(result).toBe("https://my-app.vercel.app");
  });

  it("falls back to VERCEL_URL (https-prefixed) when the first two are absent", () => {
    const result = getInvitationAppBaseUrl({
      BETTER_AUTH_URL: undefined,
      VERCEL_URL: "my-app.vercel.app",
    });

    expect(result).toBe("https://my-app.vercel.app");
  });

  it("falls back to localhost:3000 when no env var is set", () => {
    const result = getInvitationAppBaseUrl({});

    expect(result).toBe("http://localhost:3000");
  });

  it("treats a blank VERCEL_URL as absent and falls through to localhost", () => {
    const result = getInvitationAppBaseUrl({ VERCEL_URL: "   " });

    expect(result).toBe("http://localhost:3000");
  });
});
