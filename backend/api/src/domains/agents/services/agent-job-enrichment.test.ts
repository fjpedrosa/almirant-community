import { describe, expect, test } from "bun:test";
import {
  enrichJobWithFingerprint,
  enrichJobsWithFingerprint,
  type JobEnrichmentInput,
} from "./agent-job-enrichment";
import { getSuggestedOwnership, BOUNDARY_OWNERSHIP } from "./boundary-ownership";

// ---------------------------------------------------------------------------
// enrichJobWithFingerprint
// ---------------------------------------------------------------------------

describe("enrichJobWithFingerprint", () => {
  // -- Runtime inference --

  test("infers runtime 'claude-code' from codingAgent", () => {
    const result = enrichJobWithFingerprint({ codingAgent: "claude-code" });
    expect(result.runtime).toBe("claude-code");
  });

  test("infers runtime 'codex' from codingAgent", () => {
    const result = enrichJobWithFingerprint({ codingAgent: "codex" });
    expect(result.runtime).toBe("codex");
  });

  test("infers runtime 'opencode' from codingAgent", () => {
    const result = enrichJobWithFingerprint({ codingAgent: "opencode" });
    expect(result.runtime).toBe("opencode");
  });

  test("returns 'unknown' runtime for null codingAgent", () => {
    const result = enrichJobWithFingerprint({ codingAgent: null });
    expect(result.runtime).toBe("unknown");
  });

  test("returns 'unknown' runtime for undefined codingAgent", () => {
    const result = enrichJobWithFingerprint({});
    expect(result.runtime).toBe("unknown");
  });

  test("returns 'unknown' runtime for unrecognized codingAgent", () => {
    const result = enrichJobWithFingerprint({ codingAgent: "some-new-agent" });
    expect(result.runtime).toBe("unknown");
  });

  // -- Boundary inference from skillName --

  test("infers 'frontend' boundary from skillName", () => {
    const result = enrichJobWithFingerprint({ skillName: "frontend" });
    expect(result.boundary).toBe("frontend");
  });

  test("infers 'backend-api' boundary from 'backend' skillName", () => {
    const result = enrichJobWithFingerprint({ skillName: "backend" });
    expect(result.boundary).toBe("backend-api");
  });

  test("infers 'runner' boundary from skillName", () => {
    const result = enrichJobWithFingerprint({ skillName: "runner" });
    expect(result.boundary).toBe("runner");
  });

  test("infers 'database' boundary from skillName", () => {
    const result = enrichJobWithFingerprint({ skillName: "database" });
    expect(result.boundary).toBe("database");
  });

  // -- Boundary inference from result.filesChanged --

  test("infers 'frontend' boundary from filesChanged containing frontend paths", () => {
    const result = enrichJobWithFingerprint({
      result: { filesChanged: ["frontend/src/app/page.tsx"] },
    });
    expect(result.boundary).toBe("frontend");
  });

  test("infers 'backend-api' boundary from filesChanged containing backend paths", () => {
    const result = enrichJobWithFingerprint({
      result: { filesChanged: ["backend/api/src/routes/foo.ts"] },
    });
    expect(result.boundary).toBe("backend-api");
  });

  test("infers 'database' boundary from filesChanged containing schema paths", () => {
    const result = enrichJobWithFingerprint({
      result: { filesChanged: ["packages/database/src/schema/users.ts"] },
    });
    expect(result.boundary).toBe("database");
  });

  test("returns 'unknown' boundary when no signals are present", () => {
    const result = enrichJobWithFingerprint({});
    expect(result.boundary).toBe("unknown");
  });

  // -- Fingerprint computation --

  test("computes a fingerprint hash when errorMessage is present", () => {
    const result = enrichJobWithFingerprint({
      codingAgent: "claude-code",
      skillName: "runner-implement",
      errorMessage: "Module not found: @almirant/shared",
      errorType: "module_not_found",
    });

    expect(result.fingerprint).not.toBeNull();
    expect(typeof result.fingerprint).toBe("string");
    expect(result.fingerprint!.length).toBe(64); // SHA-256 hex
  });

  test("returns null fingerprint when errorMessage is absent", () => {
    const result = enrichJobWithFingerprint({
      codingAgent: "claude-code",
      skillName: "runner-implement",
    });

    expect(result.fingerprint).toBeNull();
  });

  test("returns null fingerprint when errorMessage is null", () => {
    const result = enrichJobWithFingerprint({
      errorMessage: null,
    });

    expect(result.fingerprint).toBeNull();
  });

  test("produces the same fingerprint for the same error message", () => {
    const input: JobEnrichmentInput = {
      codingAgent: "claude-code",
      skillName: "implement",
      errorMessage: "Cannot read property 'id' of undefined",
      errorType: "TypeError",
    };

    const a = enrichJobWithFingerprint(input);
    const b = enrichJobWithFingerprint(input);

    expect(a.fingerprint).toBe(b.fingerprint);
  });

  test("normalizes dynamic parts before fingerprinting (UUIDs, timestamps)", () => {
    const base: JobEnrichmentInput = {
      codingAgent: "claude-code",
      errorMessage: "Failed for id=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa at 2024-01-01T00:00:00Z",
      errorType: "runtime_error",
    };
    const variant: JobEnrichmentInput = {
      codingAgent: "claude-code",
      errorMessage: "Failed for id=bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb at 2025-06-15T12:30:00Z",
      errorType: "runtime_error",
    };

    const a = enrichJobWithFingerprint(base);
    const b = enrichJobWithFingerprint(variant);

    // Same structure, different dynamic parts -> same fingerprint
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  // -- Suggested ownership --

  test("returns correct ownership for frontend boundary", () => {
    const result = enrichJobWithFingerprint({ skillName: "frontend" });
    expect(result.suggestedOwnership).toEqual({ team: "frontend", escalation: "frontend-oncall" });
  });

  test("returns correct ownership for backend-api boundary", () => {
    const result = enrichJobWithFingerprint({ skillName: "backend" });
    expect(result.suggestedOwnership).toEqual({ team: "backend", escalation: "api-oncall" });
  });

  test("returns fallback ownership for unknown boundary", () => {
    const result = enrichJobWithFingerprint({});
    expect(result.suggestedOwnership).toEqual({ team: "unassigned", escalation: "engineering-lead" });
  });

  // -- Graceful handling of null/missing fields --

  test("handles completely empty input gracefully", () => {
    const result = enrichJobWithFingerprint({});

    expect(result.runtime).toBe("unknown");
    expect(result.boundary).toBe("unknown");
    expect(result.fingerprint).toBeNull();
    expect(result.suggestedOwnership).toEqual({ team: "unassigned", escalation: "engineering-lead" });
  });

  test("handles all-null fields gracefully", () => {
    const result = enrichJobWithFingerprint({
      codingAgent: null,
      skillName: null,
      errorMessage: null,
      errorType: null,
      config: null,
      result: null,
    });

    expect(result.runtime).toBe("unknown");
    expect(result.boundary).toBe("unknown");
    expect(result.fingerprint).toBeNull();
    expect(result.suggestedOwnership).toEqual({ team: "unassigned", escalation: "engineering-lead" });
  });

  test("handles malformed result.filesChanged (non-array) gracefully", () => {
    const result = enrichJobWithFingerprint({
      result: { filesChanged: "not-an-array" },
    });

    expect(result.boundary).toBe("unknown");
  });

  test("handles result.filesChanged with non-string elements", () => {
    const result = enrichJobWithFingerprint({
      result: { filesChanged: [123, null, "frontend/src/page.tsx", undefined] },
    });

    // Should still detect the valid string element
    expect(result.boundary).toBe("frontend");
  });
});

// ---------------------------------------------------------------------------
// enrichJobsWithFingerprint (bulk)
// ---------------------------------------------------------------------------

describe("enrichJobsWithFingerprint", () => {
  test("enriches an array of jobs preserving original fields", () => {
    const jobs = [
      { id: "job-1", codingAgent: "claude-code", skillName: "runner", errorMessage: null },
      { id: "job-2", codingAgent: "codex", skillName: "frontend", errorMessage: "fail" },
    ];

    const enriched = enrichJobsWithFingerprint(jobs);

    expect(enriched).toHaveLength(2);

    // First job
    expect(enriched[0]!.id).toBe("job-1");
    expect(enriched[0]!.runtime).toBe("claude-code");
    expect(enriched[0]!.boundary).toBe("runner");
    expect(enriched[0]!.fingerprint).toBeNull();

    // Second job
    expect(enriched[1]!.id).toBe("job-2");
    expect(enriched[1]!.runtime).toBe("codex");
    expect(enriched[1]!.boundary).toBe("frontend");
    expect(enriched[1]!.fingerprint).not.toBeNull();
  });

  test("returns empty array for empty input", () => {
    expect(enrichJobsWithFingerprint([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getSuggestedOwnership
// ---------------------------------------------------------------------------

describe("getSuggestedOwnership", () => {
  test("returns ownership for every known boundary", () => {
    for (const [boundary, expected] of Object.entries(BOUNDARY_OWNERSHIP)) {
      expect(getSuggestedOwnership(boundary)).toEqual(expected);
    }
  });

  test("returns unknown ownership for unrecognized boundary", () => {
    expect(getSuggestedOwnership("some-random-boundary")).toEqual({
      team: "unassigned",
      escalation: "engineering-lead",
    });
  });
});
