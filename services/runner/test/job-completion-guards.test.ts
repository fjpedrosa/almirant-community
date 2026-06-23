import { describe, it, expect } from "bun:test";
import {
  shouldMarkJobAsCompleted,
  shouldMarkPrReady,
  detectKnownFailurePatterns,
} from "../src/orchestration/job-completion-guards";

// ---------------------------------------------------------------------------
// shouldMarkJobAsCompleted
// ---------------------------------------------------------------------------

describe("shouldMarkJobAsCompleted", () => {
  it("returns false when session failed", () => {
    expect(
      shouldMarkJobAsCompleted({
        sessionSuccess: false,
        isPrFirstFlow: false,
        pushSucceeded: true,
      })
    ).toBe(false);
  });

  it("returns false when PR-first flow and push did not succeed", () => {
    expect(
      shouldMarkJobAsCompleted({
        sessionSuccess: true,
        isPrFirstFlow: true,
        pushSucceeded: false,
      })
    ).toBe(false);
  });

  it("returns true when session succeeded and push succeeded in PR-first flow", () => {
    expect(
      shouldMarkJobAsCompleted({
        sessionSuccess: true,
        isPrFirstFlow: true,
        pushSucceeded: true,
      })
    ).toBe(true);
  });

  it("returns true when session succeeded in non-PR flow (push irrelevant)", () => {
    expect(
      shouldMarkJobAsCompleted({
        sessionSuccess: true,
        isPrFirstFlow: false,
        pushSucceeded: false,
      })
    ).toBe(true);
  });

  it("returns true for the happy path (all true)", () => {
    expect(
      shouldMarkJobAsCompleted({
        sessionSuccess: true,
        isPrFirstFlow: true,
        pushSucceeded: true,
      })
    ).toBe(true);
  });

  it("returns false when a write-capable flow requires push but push failed", () => {
    expect(
      shouldMarkJobAsCompleted({
        sessionSuccess: true,
        isPrFirstFlow: false,
        pushSucceeded: false,
        requiresPush: true,
      })
    ).toBe(false);
  });

  it("returns false when a pushed flow requires a PR but no PR exists", () => {
    expect(
      shouldMarkJobAsCompleted({
        sessionSuccess: true,
        isPrFirstFlow: false,
        pushSucceeded: true,
        requiresPush: true,
        requiresPullRequest: true,
        hasPullRequest: false,
      })
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// shouldMarkPrReady
// ---------------------------------------------------------------------------

describe("shouldMarkPrReady", () => {
  it("returns true when all four conditions are truthy", () => {
    expect(
      shouldMarkPrReady({
        sessionSuccess: true,
        pushSucceeded: true,
        prNumber: 42,
        repoUrl: "https://github.com/org/repo",
      })
    ).toBe(true);
  });

  it("returns false when session failed", () => {
    expect(
      shouldMarkPrReady({
        sessionSuccess: false,
        pushSucceeded: true,
        prNumber: 42,
        repoUrl: "https://github.com/org/repo",
      })
    ).toBe(false);
  });

  it("returns false when push did not succeed", () => {
    expect(
      shouldMarkPrReady({
        sessionSuccess: true,
        pushSucceeded: false,
        prNumber: 42,
        repoUrl: "https://github.com/org/repo",
      })
    ).toBe(false);
  });

  it("returns false when prNumber is undefined", () => {
    expect(
      shouldMarkPrReady({
        sessionSuccess: true,
        pushSucceeded: true,
        prNumber: undefined,
        repoUrl: "https://github.com/org/repo",
      })
    ).toBe(false);
  });

  it("returns false when repoUrl is undefined", () => {
    expect(
      shouldMarkPrReady({
        sessionSuccess: true,
        pushSucceeded: true,
        prNumber: 42,
        repoUrl: undefined,
      })
    ).toBe(false);
  });

  it("returns false when prNumber is null", () => {
    expect(
      shouldMarkPrReady({
        sessionSuccess: true,
        pushSucceeded: true,
        prNumber: null,
        repoUrl: "https://github.com/org/repo",
      })
    ).toBe(false);
  });

  it("returns false when repoUrl is empty string", () => {
    expect(
      shouldMarkPrReady({
        sessionSuccess: true,
        pushSucceeded: true,
        prNumber: 42,
        repoUrl: "",
      })
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// detectKnownFailurePatterns
// ---------------------------------------------------------------------------

describe("detectKnownFailurePatterns", () => {
  it("detects 'prompt is too long' (case insensitive)", () => {
    const result = detectKnownFailurePatterns(
      "Error: Prompt is too long for this model."
    );
    expect(result).not.toBeNull();
    expect(result!.pattern).toBe("prompt_too_long");
    expect(result!.reason).toBe(
      "Session ended due to context window exhaustion"
    );
    expect(result!.retryable).toBeFalsy();
  });

  it("detects 'prompt is too long' in lowercase", () => {
    const result = detectKnownFailurePatterns(
      "the prompt is too long, please reduce context"
    );
    expect(result).not.toBeNull();
    expect(result!.pattern).toBe("prompt_too_long");
  });

  // --- Subscription limit (Claude Max "you've hit your limit") ---

  it("detects subscription limit with absolute UTC reset time", () => {
    const result = detectKnownFailurePatterns(
      "You've hit your limit · resets 7pm (UTC)"
    );
    expect(result).not.toBeNull();
    expect(result!.pattern).toBe("subscription_limit");
    expect(result!.reason).toBe("Session hit subscription rate limit");
    expect(result!.retryable).toBe(true);
    expect(result!.retryDelayMs).toBeGreaterThan(0);
  });

  it("detects subscription limit with relative reset time", () => {
    const result = detectKnownFailurePatterns(
      "You've hit your limit · resets in 21m"
    );
    expect(result).not.toBeNull();
    expect(result!.pattern).toBe("subscription_limit");
    expect(result!.retryable).toBe(true);
    expect(result!.retryDelayMs).toBe(21 * 60 * 1000);
  });

  it("detects subscription limit without reset time (uses default delay)", () => {
    const result = detectKnownFailurePatterns(
      "You've hit your limit"
    );
    expect(result).not.toBeNull();
    expect(result!.pattern).toBe("subscription_limit");
    expect(result!.retryable).toBe(true);
    expect(result!.retryDelayMs).toBe(5 * 60 * 1000); // default 5 min
  });

  // --- API rate limit (429) ---

  it("detects rate limit (429 + too many requests)", () => {
    const result = detectKnownFailurePatterns(
      "API returned 429: Too Many Requests. Please retry later."
    );
    expect(result).not.toBeNull();
    expect(result!.pattern).toBe("rate_limit");
    expect(result!.reason).toBe("Session hit API rate limit");
    expect(result!.retryable).toBe(true);
    expect(result!.retryDelayMs).toBe(5 * 60 * 1000);
  });

  // --- API overloaded (529) ---

  it("detects API overloaded (529 + overloaded)", () => {
    const result = detectKnownFailurePatterns(
      "Error 529: API is overloaded, try again later."
    );
    expect(result).not.toBeNull();
    expect(result!.pattern).toBe("api_overloaded");
    expect(result!.reason).toBe("Session hit API overloaded error");
    expect(result!.retryable).toBe(true);
  });

  // --- No false positives ---

  it("returns null for normal text", () => {
    const result = detectKnownFailurePatterns(
      "All tasks completed successfully. Created 3 files and modified 2."
    );
    expect(result).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(detectKnownFailurePatterns("")).toBeNull();
  });

  it("does not false-positive on '429' alone without 'too many requests'", () => {
    const result = detectKnownFailurePatterns(
      "Status code 429 was returned by the server."
    );
    expect(result).toBeNull();
  });

  it("does not false-positive on '529' alone without 'overloaded'", () => {
    const result = detectKnownFailurePatterns(
      "Received status 529 from upstream."
    );
    expect(result).toBeNull();
  });
});
