import { describe, expect, it } from "bun:test";
import { parseManualOAuthCode } from "./manual-code";

describe("parseManualOAuthCode", () => {
  it("keeps plain authorization codes intact", () => {
    expect(parseManualOAuthCode("auth-code-123")).toEqual({
      code: "auth-code-123",
      state: null,
    });
  });

  it("parses code#state format", () => {
    expect(parseManualOAuthCode("auth-code-123#oauth-state-456")).toEqual({
      code: "auth-code-123",
      state: "oauth-state-456",
    });
  });

  it("extracts code and state from callback URLs", () => {
    expect(
      parseManualOAuthCode(
        "https://platform.claude.com/oauth/code/callback?code=auth-code-123&state=oauth-state-456",
      ),
    ).toEqual({
      code: "auth-code-123",
      state: "oauth-state-456",
    });
  });

  it("extracts code and state from raw query strings", () => {
    expect(
      parseManualOAuthCode("?code=auth-code-123&state=oauth-state-456"),
    ).toEqual({
      code: "auth-code-123",
      state: "oauth-state-456",
    });
  });

  it("extracts code and state from callback URL hashes", () => {
    expect(
      parseManualOAuthCode(
        "https://platform.claude.com/oauth/code/callback#code=auth-code-123&state=oauth-state-456",
      ),
    ).toEqual({
      code: "auth-code-123",
      state: "oauth-state-456",
    });
  });
});
