import { describe, expect, test } from "bun:test";
import { devAuthFixtureScope, signDevSessionCookieValue } from "./dev-auth.routes";

describe("dev auth Playwright session cookie", () => {
  test("returns the signed cookie value Better Auth requires rather than a raw database token", async () => {
    const value = await signDevSessionCookieValue("test-session-token", "test-secret");
    expect(value).toStartWith("test-session-token.");
    expect(value).not.toBe("test-session-token");
    expect(decodeURIComponent(value)).toMatch(/^test-session-token\.[A-Za-z0-9+/]+=*$/);
  });
});

describe("dev auth Playwright fixture isolation", () => {
  test("normalizes project scopes without allowing workspace identity drift", () => {
    expect(devAuthFixtureScope("mobile-chrome")).toBe("mobile-chrome");
    expect(devAuthFixtureScope("../shared")).toBe("shared");
    expect(devAuthFixtureScope(undefined)).toBe("default");
  });
});
