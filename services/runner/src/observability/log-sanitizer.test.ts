import { describe, expect, it } from "bun:test";
import { sanitizeLogContent } from "./log-sanitizer";

describe("sanitizeLogContent", () => {
  // -----------------------------------------------------------------------
  // API key patterns
  // -----------------------------------------------------------------------

  it("redacts Anthropic API keys", () => {
    const input = "Using key sk-ant-api03-abcdefghij1234567890abcdef for auth";
    const result = sanitizeLogContent(input);
    expect(result).toContain("[REDACTED:ANTHROPIC_KEY]");
    expect(result).not.toContain("sk-ant-api03");
  });

  it("redacts OpenAI API keys", () => {
    // Pattern: sk- followed by 20+ alphanumeric chars
    const input = "OPENAI_KEY=" + "sk-" + "abcdefghij1234567890XYZ";
    const result = sanitizeLogContent(input);
    expect(result).toContain("[REDACTED:OPENAI_KEY]");
    expect(result).not.toContain("sk-abcdefghij");
  });

  it("redacts GitHub PATs (ghp_)", () => {
    const input = "Token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn";
    const result = sanitizeLogContent(input);
    expect(result).toContain("[REDACTED:GITHUB_PAT]");
    expect(result).not.toContain("ghp_");
  });

  it("redacts GitHub App tokens (ghs_)", () => {
    const input = "ghs_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn installed";
    const result = sanitizeLogContent(input);
    expect(result).toContain("[REDACTED:GITHUB_APP_TOKEN]");
    expect(result).not.toContain("ghs_");
  });

  it("redacts GitHub fine-grained PATs", () => {
    const input = "github_pat_abcdefghijklmnopqrstuvwxyz found in env";
    const result = sanitizeLogContent(input);
    expect(result).toContain("[REDACTED:GITHUB_FINE_PAT]");
    expect(result).not.toContain("github_pat_");
  });

  it("redacts Slack tokens", () => {
    const input = "xoxb-123456789012-abcdefgh used for bot";
    const result = sanitizeLogContent(input);
    expect(result).toContain("[REDACTED:SLACK_TOKEN]");
    expect(result).not.toContain("xoxb-");
  });

  it("redacts Almirant API keys", () => {
    const input = "crm_k1_abcdefghij1234567890 is the key";
    const result = sanitizeLogContent(input);
    expect(result).toContain("[REDACTED:ALMIRANT_KEY]");
    expect(result).not.toContain("crm_k1_");
  });

  it("redacts git auth URLs with embedded tokens", () => {
    const input = "git clone https://x-access-token:ghp_abc123def456ghi789@github.com/org/repo.git";
    const result = sanitizeLogContent(input);
    expect(result).toContain("[REDACTED:");
    expect(result).not.toContain("x-access-token:ghp_");
  });

  it("redacts JWTs (each segment >= 50 chars)", () => {
    // Pattern requires eyJ + 50 chars in each of the 3 dot-separated segments
    const seg1 = "eyJ" + "a".repeat(60);
    const seg2 = "eyJ" + "b".repeat(60);
    const seg3 = "c".repeat(60);
    const jwt = `${seg1}.${seg2}.${seg3}`;
    const input = `Token: ${jwt}`;
    const result = sanitizeLogContent(input);
    expect(result).toContain("[REDACTED:JWT]");
    expect(result).not.toContain(seg1);
  });

  // -----------------------------------------------------------------------
  // Sensitive env var lines
  // -----------------------------------------------------------------------

  it("redacts ANTHROPIC_API_KEY env lines", () => {
    const input = "ANTHROPIC_API_KEY=sk-ant-secret-value";
    const result = sanitizeLogContent(input);
    expect(result).toBe("ANTHROPIC_API_KEY=[REDACTED]");
  });

  it("redacts OPENAI_API_KEY env lines", () => {
    const input = "OPENAI_API_KEY=sk-openai-secret";
    const result = sanitizeLogContent(input);
    expect(result).toBe("OPENAI_API_KEY=[REDACTED]");
  });

  it("redacts GH_TOKEN env lines", () => {
    const input = "GH_TOKEN=ghs_token_value_here";
    const result = sanitizeLogContent(input);
    expect(result).toBe("GH_TOKEN=[REDACTED]");
  });

  it("redacts DISCORD_BOT_TOKEN env lines", () => {
    const input = "DISCORD_BOT_TOKEN=some-secret-token";
    const result = sanitizeLogContent(input);
    expect(result).toBe("DISCORD_BOT_TOKEN=[REDACTED]");
  });

  it("redacts DATABASE_URL env lines", () => {
    const input = "DATABASE_URL=postgresql://user:pass@host:5432/db";
    const result = sanitizeLogContent(input);
    expect(result).toBe("DATABASE_URL=[REDACTED]");
  });

  it("redacts CLAUDE_CODE_OAUTH_TOKEN env lines", () => {
    const input = "CLAUDE_CODE_OAUTH_TOKEN=oat01-some-token";
    const result = sanitizeLogContent(input);
    expect(result).toBe("CLAUDE_CODE_OAUTH_TOKEN=[REDACTED]");
  });

  it("redacts __GIT_CLONE_TOKEN env lines", () => {
    const input = "__GIT_CLONE_TOKEN=ghs_token_value_here";
    const result = sanitizeLogContent(input);
    expect(result).toBe("__GIT_CLONE_TOKEN=[REDACTED]");
  });

  // -----------------------------------------------------------------------
  // Non-sensitive content passes through
  // -----------------------------------------------------------------------

  it("does not redact normal text", () => {
    const input = "Compiling TypeScript... 42 files processed. Build successful.";
    expect(sanitizeLogContent(input)).toBe(input);
  });

  it("does not redact non-sensitive env lines", () => {
    const input = "NODE_ENV=production";
    expect(sanitizeLogContent(input)).toBe(input);
  });

  it("does not redact short sk- prefixed strings", () => {
    const input = "variable sk-short is fine";
    expect(sanitizeLogContent(input)).toBe(input);
  });

  // -----------------------------------------------------------------------
  // Multi-line and mixed content
  // -----------------------------------------------------------------------

  it("handles multi-line content with mixed sensitive/non-sensitive", () => {
    const input = [
      "Starting container...",
      "ANTHROPIC_API_KEY=sk-ant-redacted-test-token",
      "NODE_ENV=production",
      "Using token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn",
      "Build complete",
    ].join("\n");

    const result = sanitizeLogContent(input);
    expect(result).toContain("Starting container...");
    expect(result).toContain("ANTHROPIC_API_KEY=[REDACTED]");
    expect(result).toContain("NODE_ENV=production");
    expect(result).toContain("[REDACTED:GITHUB_PAT]");
    expect(result).toContain("Build complete");
  });

  it("redacts multiple keys in the same line", () => {
    const input = "keys: sk-ant-abcdefghijklmnopqrstuvwxyz and ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn";
    const result = sanitizeLogContent(input);
    expect(result).toContain("[REDACTED:ANTHROPIC_KEY]");
    expect(result).toContain("[REDACTED:GITHUB_PAT]");
  });

  it("handles empty string", () => {
    expect(sanitizeLogContent("")).toBe("");
  });

  // -----------------------------------------------------------------------
  // Idempotency
  // -----------------------------------------------------------------------

  it("is idempotent (double-sanitizing produces same result)", () => {
    const input = "Token: sk-ant-abcdefghijklmnopqrstuvwxyz in use";
    const first = sanitizeLogContent(input);
    const second = sanitizeLogContent(first);
    expect(second).toBe(first);
  });
});
