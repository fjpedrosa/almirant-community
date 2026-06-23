import { describe, expect, it } from "bun:test";
import {
  normalizeErrorMessage,
  computeFingerprint,
  inferBoundary,
  inferRuntime,
} from "./error-fingerprint";

// ---------------------------------------------------------------------------
// normalizeErrorMessage
// ---------------------------------------------------------------------------

describe("normalizeErrorMessage", () => {
  it("replaces UUIDs with <UUID>", () => {
    const msg =
      "Failed to find record 3f2504e0-4f89-11d3-9a0c-0305e82c3301 in table";
    expect(normalizeErrorMessage(msg)).toBe(
      "Failed to find record <UUID> in table"
    );
  });

  it("replaces multiple UUIDs", () => {
    const msg =
      "Conflict between 3f2504e0-4f89-11d3-9a0c-0305e82c3301 and 6ba7b810-9dad-11d1-80b4-00c04fd430c8";
    const result = normalizeErrorMessage(msg);
    expect(result).toBe("Conflict between <UUID> and <UUID>");
  });

  it("replaces ISO timestamps with <TIMESTAMP>", () => {
    const msg = "Error at 2026-04-15T14:30:00.000Z: connection refused";
    expect(normalizeErrorMessage(msg)).toBe(
      "Error at <TIMESTAMP>: connection refused"
    );
  });

  it("replaces ISO timestamps with timezone offset", () => {
    const msg = "Started at 2026-04-15T14:30:00+03:00 but failed";
    expect(normalizeErrorMessage(msg)).toBe(
      "Started at <TIMESTAMP> but failed"
    );
  });

  it("replaces file paths with <PATH>", () => {
    const msg =
      "TypeError in /home/user/project/src/index.ts: Cannot read property";
    expect(normalizeErrorMessage(msg)).toBe(
      "TypeError in <PATH>: Cannot read property"
    );
  });

  it("replaces file paths with line numbers", () => {
    const msg = "Error at /src/app/page.tsx:42:10 unexpected token";
    expect(normalizeErrorMessage(msg)).toBe(
      "Error at <PATH> unexpected token"
    );
  });

  it("replaces 'line NNN' references with line <N>", () => {
    const msg = "SyntaxError on line 157: unexpected identifier";
    expect(normalizeErrorMessage(msg)).toBe(
      "SyntaxError on line <N>: unexpected identifier"
    );
  });

  it("replaces hex addresses with <HEX>", () => {
    const msg = "Segfault at address 0x7fff5fbff8a0 in main thread";
    expect(normalizeErrorMessage(msg)).toBe(
      "Segfault at address <HEX> in main thread"
    );
  });

  it("strips ANSI escape codes", () => {
    const msg = "\x1b[31mError:\x1b[0m something went wrong";
    expect(normalizeErrorMessage(msg)).toBe("Error: something went wrong");
  });

  it("collapses multiple spaces", () => {
    const msg = "Error:   too   many   spaces";
    expect(normalizeErrorMessage(msg)).toBe("Error: too many spaces");
  });

  it("handles a realistic complex error message", () => {
    const msg =
      "Error in /workspace/repo/backend/api/src/routes/leads.ts:123:45 at 2026-04-15T10:00:00Z — " +
      "Record 3f2504e0-4f89-11d3-9a0c-0305e82c3301 not found (address 0xDEADBEEF)";
    const result = normalizeErrorMessage(msg);
    expect(result).toBe(
      "Error in <PATH> at <TIMESTAMP> — Record <UUID> not found (address <HEX>)"
    );
  });

  it("produces identical output for equivalent messages differing only in dynamic parts", () => {
    const msg1 =
      "Cannot find record a1b2c3d4-e5f6-7890-abcd-ef1234567890 at 2026-01-01T00:00:00Z";
    const msg2 =
      "Cannot find record 11111111-2222-3333-4444-555555555555 at 2026-12-31T23:59:59Z";
    expect(normalizeErrorMessage(msg1)).toBe(normalizeErrorMessage(msg2));
  });
});

// ---------------------------------------------------------------------------
// computeFingerprint
// ---------------------------------------------------------------------------

describe("computeFingerprint", () => {
  it("returns all input fields plus a hash", () => {
    const fp = computeFingerprint({
      runtime: "claude-code",
      boundary: "backend-api",
      canonicalKind: "type-error",
      invariantKey: "runner-oom-kill",
      normalizedError: "Cannot read property of undefined",
    });

    expect(fp.runtime).toBe("claude-code");
    expect(fp.boundary).toBe("backend-api");
    expect(fp.canonicalKind).toBe("type-error");
    expect(fp.invariantKey).toBe("runner-oom-kill");
    expect(fp.normalizedError).toBe("Cannot read property of undefined");
    expect(fp.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces stable hashes for identical inputs", () => {
    const params = {
      runtime: "codex",
      boundary: "frontend",
      canonicalKind: "runtime-crash",
      invariantKey: "hydration-mismatch",
      normalizedError: "Hydration failed because the initial UI does not match",
    };

    const fp1 = computeFingerprint(params);
    const fp2 = computeFingerprint(params);

    expect(fp1.hash).toBe(fp2.hash);
  });

  it("produces different hashes when any field differs", () => {
    const base = {
      runtime: "claude-code",
      boundary: "backend-api",
      canonicalKind: "type-error",
      invariantKey: "missing-field",
      normalizedError: "Property X is missing",
    };

    const variations = [
      { ...base, runtime: "codex" },
      { ...base, boundary: "frontend" },
      { ...base, canonicalKind: "runtime-crash" },
      { ...base, invariantKey: "different-key" },
      { ...base, normalizedError: "Property Y is missing" },
    ];

    const baseHash = computeFingerprint(base).hash;
    for (const variant of variations) {
      expect(computeFingerprint(variant).hash).not.toBe(baseHash);
    }
  });

  it("avoids collisions from field concatenation (null-byte separator)", () => {
    // Without a separator, "ab" + "cd" === "a" + "bcd"
    const fp1 = computeFingerprint({
      runtime: "ab",
      boundary: "cd",
      canonicalKind: "e",
      invariantKey: "f",
      normalizedError: "g",
    });
    const fp2 = computeFingerprint({
      runtime: "a",
      boundary: "bcd",
      canonicalKind: "e",
      invariantKey: "f",
      normalizedError: "g",
    });

    expect(fp1.hash).not.toBe(fp2.hash);
  });
});

// ---------------------------------------------------------------------------
// inferBoundary
// ---------------------------------------------------------------------------

describe("inferBoundary", () => {
  it("returns 'runner' for area 'runner'", () => {
    expect(inferBoundary([], "runner")).toBe("runner");
  });

  it("returns 'backend-api' for area 'backend'", () => {
    expect(inferBoundary([], "backend")).toBe("backend-api");
  });

  it("returns 'frontend' for area 'frontend'", () => {
    expect(inferBoundary([], "frontend")).toBe("frontend");
  });

  it("returns 'web-bridge' for area 'web-bridge'", () => {
    expect(inferBoundary([], "web-bridge")).toBe("web-bridge");
  });

  it("infers 'runner' from file paths containing 'runner'", () => {
    const files = ["backend/packages/remote-agent/src/runner.ts"];
    expect(inferBoundary(files, "unknown")).toBe("runner");
  });

  it("infers 'frontend' from file paths containing 'src/domains/'", () => {
    const files = ["frontend/src/domains/leads/application/hooks/useLeads.ts"];
    expect(inferBoundary(files, "unknown")).toBe("frontend");
  });

  it("infers 'database' from file paths containing 'repositories/'", () => {
    const files = [
      "backend/packages/database/src/repositories/agents/bug-fix-attempt-repository.ts",
    ];
    expect(inferBoundary(files, "unknown")).toBe("database");
  });

  it("infers 'backend-api' from file paths containing 'routes/'", () => {
    const files = ["backend/api/src/routes/leads.ts"];
    expect(inferBoundary(files, "unknown")).toBe("backend-api");
  });

  it("infers 'stream-consumer' from file paths containing 'stream-consumer'", () => {
    const files = ["backend/packages/stream-consumer/src/index.ts"];
    expect(inferBoundary(files, "unknown")).toBe("stream-consumer");
  });

  it("returns 'unknown' when no pattern matches", () => {
    expect(inferBoundary(["README.md"], "unknown")).toBe("unknown");
  });

  it("prefers area over file paths when area is a known boundary", () => {
    // Area says "frontend" but files are in backend — area wins
    expect(
      inferBoundary(
        ["backend/api/src/routes/leads.ts"],
        "frontend"
      )
    ).toBe("frontend");
  });
});

// ---------------------------------------------------------------------------
// inferRuntime
// ---------------------------------------------------------------------------

describe("inferRuntime", () => {
  it("returns 'claude-code' for 'claude-code'", () => {
    expect(inferRuntime("claude-code")).toBe("claude-code");
  });

  it("returns 'codex' for 'codex'", () => {
    expect(inferRuntime("codex")).toBe("codex");
  });

  it("returns 'opencode' for 'opencode'", () => {
    expect(inferRuntime("opencode")).toBe("opencode");
  });

  it("returns 'opencode' for 'open-code'", () => {
    expect(inferRuntime("open-code")).toBe("opencode");
  });

  it("handles case-insensitive input", () => {
    expect(inferRuntime("Claude-Code")).toBe("claude-code");
    expect(inferRuntime("CODEX")).toBe("codex");
  });

  it("handles partial matches", () => {
    expect(inferRuntime("claude-code-v2")).toBe("claude-code");
  });

  it("returns 'unknown' for undefined", () => {
    expect(inferRuntime(undefined)).toBe("unknown");
  });

  it("returns 'unknown' for unrecognized agents", () => {
    expect(inferRuntime("some-other-agent")).toBe("unknown");
  });

  it("trims whitespace", () => {
    expect(inferRuntime("  codex  ")).toBe("codex");
  });
});
