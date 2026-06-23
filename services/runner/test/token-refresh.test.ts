import { describe, expect, it } from "bun:test";
import {
  TOKEN_REFRESH_INTERVAL_MS,
  buildCredentialHelperScript,
  shouldRefreshToken,
} from "../src/shared/token-refresh";

describe("TOKEN_REFRESH_INTERVAL_MS", () => {
  it("is between 20 and 50 minutes", () => {
    const twentyMinutes = 20 * 60 * 1000;
    const fiftyMinutes = 50 * 60 * 1000;
    expect(TOKEN_REFRESH_INTERVAL_MS).toBeGreaterThanOrEqual(twentyMinutes);
    expect(TOKEN_REFRESH_INTERVAL_MS).toBeLessThanOrEqual(fiftyMinutes);
  });
});

describe("buildCredentialHelperScript", () => {
  it("returns valid shell script with username and password", () => {
    const script = buildCredentialHelperScript("ghs_abc123");
    expect(script).toContain("#!/bin/sh");
    expect(script).toContain('echo "username=x-access-token"');
    expect(script).toContain('echo "password=ghs_abc123"');
  });

  it("escapes double quotes in tokens", () => {
    const script = buildCredentialHelperScript('token"with"quotes');
    expect(script).toContain('echo "password=token\\"with\\"quotes"');
    // Should not contain unescaped quotes that would break the shell script
    expect(script).not.toContain('password=token"with');
  });
});

describe("shouldRefreshToken", () => {
  it("returns true when lastRefresh is 0", () => {
    expect(shouldRefreshToken(0)).toBe(true);
  });

  it("returns true when enough time has passed", () => {
    const oldTimestamp = Date.now() - TOKEN_REFRESH_INTERVAL_MS - 1000;
    expect(shouldRefreshToken(oldTimestamp)).toBe(true);
  });

  it("returns false when recently refreshed", () => {
    const recentTimestamp = Date.now() - 1000;
    expect(shouldRefreshToken(recentTimestamp)).toBe(false);
  });
});
