import { describe, expect, it } from "bun:test";
import {
  createOAuthStateToken,
  verifyOAuthStateToken,
} from "./state-token";

describe("oauth state token", () => {
  it("round-trips a signed token", () => {
    const token = createOAuthStateToken({
      provider: "anthropic",
      userId: "user-123",
      codeVerifier: "pkce-secret",
      expiresAt: new Date(Date.now() + 60_000),
      secret: "test-secret",
    });

    expect(verifyOAuthStateToken(token, "test-secret")).toMatchObject({
      provider: "anthropic",
      userId: "user-123",
      codeVerifier: "pkce-secret",
      v: 1,
    });
  });

  it("rejects expired tokens", () => {
    const token = createOAuthStateToken({
      provider: "anthropic",
      userId: "user-123",
      codeVerifier: null,
      expiresAt: new Date(Date.now() - 60_000),
      secret: "test-secret",
    });

    expect(verifyOAuthStateToken(token, "test-secret")).toBeNull();
  });

  it("rejects tampered tokens", () => {
    const token = createOAuthStateToken({
      provider: "anthropic",
      userId: "user-123",
      codeVerifier: "pkce-secret",
      expiresAt: new Date(Date.now() + 60_000),
      secret: "test-secret",
    });

    const tampered = `${token.slice(0, -1)}x`;
    expect(verifyOAuthStateToken(tampered, "test-secret")).toBeNull();
  });
});
