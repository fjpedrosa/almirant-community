import { describe, expect, it } from "bun:test";
import {
  classifyRecurrence,
  type RecurrenceType,
  type RecurrenceClassification,
  type ErrorFingerprintInput,
  type ObservationWithFingerprint,
} from "./error-recurrence";

// -------------------------------------------------------
// Shared test helpers
// -------------------------------------------------------

const makeFingerprint = (
  overrides: Partial<ErrorFingerprintInput> = {},
): ErrorFingerprintInput => ({
  hash: "abc123hash",
  runtime: "claude-code",
  boundary: "backend",
  canonicalKind: "type-error",
  invariantKey: "runner-oom-kill",
  ...overrides,
});

const makeObservation = (
  fingerprint: ErrorFingerprintInput,
  createdAt = "2026-04-10T12:00:00.000Z",
): ObservationWithFingerprint => ({
  metadata: { fingerprint },
  createdAt,
});

// -------------------------------------------------------
// Tests
// -------------------------------------------------------

describe("classifyRecurrence", () => {
  // ----- exact_recurrence -----

  describe("exact_recurrence", () => {
    it("returns exact_recurrence when the same hash is found", () => {
      const fingerprint = makeFingerprint({ hash: "same-hash-1" });
      const existing = [
        makeObservation(
          makeFingerprint({ hash: "same-hash-1" }),
          "2026-04-09T10:00:00.000Z",
        ),
      ];

      const result = classifyRecurrence({
        fingerprint,
        existingObservations: existing,
      });

      expect(result.type).toBe("exact_recurrence");
      expect(result.matchCount).toBe(1);
      expect(result.lastSeenAt).toBe("2026-04-09T10:00:00.000Z");
      expect(result.matchedFingerprints).toEqual(["same-hash-1"]);
    });

    it("counts multiple exact matches and returns the most recent date", () => {
      const fingerprint = makeFingerprint({ hash: "repeated-hash" });
      const existing = [
        makeObservation(
          makeFingerprint({ hash: "repeated-hash" }),
          "2026-04-01T10:00:00.000Z",
        ),
        makeObservation(
          makeFingerprint({ hash: "repeated-hash" }),
          "2026-04-08T10:00:00.000Z",
        ),
        makeObservation(
          makeFingerprint({ hash: "repeated-hash" }),
          "2026-04-05T10:00:00.000Z",
        ),
      ];

      const result = classifyRecurrence({
        fingerprint,
        existingObservations: existing,
      });

      expect(result.type).toBe("exact_recurrence");
      expect(result.matchCount).toBe(3);
      expect(result.lastSeenAt).toBe("2026-04-08T10:00:00.000Z");
      // All have the same hash, so deduplicated it is 1 unique hash
      expect(result.matchedFingerprints).toEqual(["repeated-hash"]);
    });

    it("prioritizes exact_recurrence over cross_runtime and variant matches", () => {
      const fingerprint = makeFingerprint({
        hash: "exact-hash",
        runtime: "claude-code",
        canonicalKind: "type-error",
        invariantKey: "key-1",
        boundary: "backend",
      });

      const existing = [
        // Exact match
        makeObservation(
          makeFingerprint({
            hash: "exact-hash",
            runtime: "claude-code",
          }),
          "2026-04-09T10:00:00.000Z",
        ),
        // Cross-runtime match (same kind+key+boundary, different runtime)
        makeObservation(
          makeFingerprint({
            hash: "different-hash-1",
            runtime: "codex",
            canonicalKind: "type-error",
            invariantKey: "key-1",
            boundary: "backend",
          }),
          "2026-04-08T10:00:00.000Z",
        ),
        // Variant match (same kind, different key)
        makeObservation(
          makeFingerprint({
            hash: "different-hash-2",
            canonicalKind: "type-error",
            invariantKey: "key-2",
          }),
          "2026-04-07T10:00:00.000Z",
        ),
      ];

      const result = classifyRecurrence({
        fingerprint,
        existingObservations: existing,
      });

      expect(result.type).toBe("exact_recurrence");
      expect(result.matchCount).toBe(1);
    });
  });

  // ----- cross_runtime_recurrence -----

  describe("cross_runtime_recurrence", () => {
    it("returns cross_runtime_recurrence when same kind+key+boundary but different runtime", () => {
      const fingerprint = makeFingerprint({
        hash: "hash-claude",
        runtime: "claude-code",
        canonicalKind: "timeout",
        invariantKey: "api-timeout-error",
        boundary: "runner",
      });

      const existing = [
        makeObservation(
          makeFingerprint({
            hash: "hash-codex",
            runtime: "codex",
            canonicalKind: "timeout",
            invariantKey: "api-timeout-error",
            boundary: "runner",
          }),
          "2026-04-08T14:00:00.000Z",
        ),
      ];

      const result = classifyRecurrence({
        fingerprint,
        existingObservations: existing,
      });

      expect(result.type).toBe("cross_runtime_recurrence");
      expect(result.matchCount).toBe(1);
      expect(result.lastSeenAt).toBe("2026-04-08T14:00:00.000Z");
      expect(result.matchedFingerprints).toEqual(["hash-codex"]);
    });

    it("does not match cross_runtime when boundary differs", () => {
      const fingerprint = makeFingerprint({
        hash: "hash-1",
        runtime: "claude-code",
        canonicalKind: "timeout",
        invariantKey: "api-timeout-error",
        boundary: "runner",
      });

      const existing = [
        makeObservation(
          makeFingerprint({
            hash: "hash-2",
            runtime: "codex",
            canonicalKind: "timeout",
            invariantKey: "api-timeout-error",
            boundary: "frontend", // different boundary
          }),
          "2026-04-08T14:00:00.000Z",
        ),
      ];

      const result = classifyRecurrence({
        fingerprint,
        existingObservations: existing,
      });

      // Should not be cross_runtime because boundary differs
      // Could be variant (same canonicalKind) if invariantKey also differs,
      // but here invariantKey is the same so it won't match variant either.
      // Actually it won't match variant because variant requires different invariantKey.
      expect(result.type).toBe("new");
    });

    it("counts multiple cross-runtime matches from different runtimes", () => {
      const fingerprint = makeFingerprint({
        hash: "hash-opencode",
        runtime: "opencode",
        canonicalKind: "runtime-crash",
        invariantKey: "segfault-handler",
        boundary: "backend",
      });

      const existing = [
        makeObservation(
          makeFingerprint({
            hash: "hash-claude",
            runtime: "claude-code",
            canonicalKind: "runtime-crash",
            invariantKey: "segfault-handler",
            boundary: "backend",
          }),
          "2026-04-07T10:00:00.000Z",
        ),
        makeObservation(
          makeFingerprint({
            hash: "hash-codex",
            runtime: "codex",
            canonicalKind: "runtime-crash",
            invariantKey: "segfault-handler",
            boundary: "backend",
          }),
          "2026-04-09T10:00:00.000Z",
        ),
      ];

      const result = classifyRecurrence({
        fingerprint,
        existingObservations: existing,
      });

      expect(result.type).toBe("cross_runtime_recurrence");
      expect(result.matchCount).toBe(2);
      expect(result.lastSeenAt).toBe("2026-04-09T10:00:00.000Z");
      expect(result.matchedFingerprints).toContain("hash-claude");
      expect(result.matchedFingerprints).toContain("hash-codex");
    });
  });

  // ----- variant -----

  describe("variant", () => {
    it("returns variant when same canonicalKind but different invariantKey", () => {
      const fingerprint = makeFingerprint({
        hash: "hash-new",
        runtime: "claude-code",
        canonicalKind: "type-error",
        invariantKey: "property-undefined-access",
        boundary: "frontend",
      });

      const existing = [
        makeObservation(
          makeFingerprint({
            hash: "hash-old",
            runtime: "claude-code",
            canonicalKind: "type-error",
            invariantKey: "null-reference-error", // same kind, different key
            boundary: "backend",
          }),
          "2026-04-06T08:00:00.000Z",
        ),
      ];

      const result = classifyRecurrence({
        fingerprint,
        existingObservations: existing,
      });

      expect(result.type).toBe("variant");
      expect(result.matchCount).toBe(1);
      expect(result.lastSeenAt).toBe("2026-04-06T08:00:00.000Z");
      expect(result.matchedFingerprints).toEqual(["hash-old"]);
    });

    it("does not classify as variant when canonicalKind differs", () => {
      const fingerprint = makeFingerprint({
        hash: "hash-a",
        canonicalKind: "type-error",
        invariantKey: "key-a",
      });

      const existing = [
        makeObservation(
          makeFingerprint({
            hash: "hash-b",
            canonicalKind: "runtime-crash", // different kind
            invariantKey: "key-b",
          }),
          "2026-04-06T08:00:00.000Z",
        ),
      ];

      const result = classifyRecurrence({
        fingerprint,
        existingObservations: existing,
      });

      expect(result.type).toBe("new");
    });
  });

  // ----- new -----

  describe("new", () => {
    it("returns new when no observations exist", () => {
      const fingerprint = makeFingerprint();

      const result = classifyRecurrence({
        fingerprint,
        existingObservations: [],
      });

      expect(result.type).toBe("new");
      expect(result.matchCount).toBe(0);
      expect(result.lastSeenAt).toBeNull();
      expect(result.matchedFingerprints).toEqual([]);
    });

    it("returns new when observations exist but none match", () => {
      const fingerprint = makeFingerprint({
        hash: "unique-hash",
        canonicalKind: "memory-leak",
        invariantKey: "heap-overflow",
      });

      const existing = [
        makeObservation(
          makeFingerprint({
            hash: "different-hash",
            canonicalKind: "type-error", // different kind
            invariantKey: "null-ref",
          }),
          "2026-04-10T12:00:00.000Z",
        ),
      ];

      const result = classifyRecurrence({
        fingerprint,
        existingObservations: existing,
      });

      expect(result.type).toBe("new");
      expect(result.matchCount).toBe(0);
    });

    it("returns new when observations have no fingerprint metadata", () => {
      const fingerprint = makeFingerprint();

      const existing: ObservationWithFingerprint[] = [
        { metadata: null, createdAt: "2026-04-10T12:00:00.000Z" },
        { metadata: {}, createdAt: "2026-04-09T12:00:00.000Z" },
        {
          metadata: { area: "frontend" }, // no fingerprint key
          createdAt: "2026-04-08T12:00:00.000Z",
        },
      ];

      const result = classifyRecurrence({
        fingerprint,
        existingObservations: existing,
      });

      expect(result.type).toBe("new");
      expect(result.matchCount).toBe(0);
    });
  });

  // ----- Edge cases -----

  describe("edge cases", () => {
    it("handles Date objects in createdAt (not just strings)", () => {
      const fingerprint = makeFingerprint({ hash: "date-hash" });
      const existing: ObservationWithFingerprint[] = [
        {
          metadata: {
            fingerprint: makeFingerprint({ hash: "date-hash" }),
          },
          createdAt: new Date("2026-04-10T12:00:00.000Z"),
        },
      ];

      const result = classifyRecurrence({
        fingerprint,
        existingObservations: existing,
      });

      expect(result.type).toBe("exact_recurrence");
      expect(result.matchCount).toBe(1);
      expect(result.lastSeenAt).toBe("2026-04-10T12:00:00.000Z");
    });

    it("handles observations with incomplete fingerprint metadata gracefully", () => {
      const fingerprint = makeFingerprint({ hash: "complete-hash" });
      const existing: ObservationWithFingerprint[] = [
        {
          metadata: {
            fingerprint: {
              hash: "partial-hash",
              // missing runtime, boundary, canonicalKind, invariantKey
            },
          },
          createdAt: "2026-04-10T12:00:00.000Z",
        },
      ];

      const result = classifyRecurrence({
        fingerprint,
        existingObservations: existing,
      });

      // Incomplete fingerprint should be skipped
      expect(result.type).toBe("new");
      expect(result.matchCount).toBe(0);
    });

    it("deduplicates matched fingerprint hashes", () => {
      const fingerprint = makeFingerprint({
        hash: "target-hash",
        canonicalKind: "type-error",
        invariantKey: "key-A",
      });

      const existing = [
        makeObservation(
          makeFingerprint({
            hash: "variant-hash",
            canonicalKind: "type-error",
            invariantKey: "key-B",
          }),
          "2026-04-09T10:00:00.000Z",
        ),
        makeObservation(
          makeFingerprint({
            hash: "variant-hash", // same hash appearing again (e.g., from dedup)
            canonicalKind: "type-error",
            invariantKey: "key-C",
          }),
          "2026-04-10T10:00:00.000Z",
        ),
      ];

      const result = classifyRecurrence({
        fingerprint,
        existingObservations: existing,
      });

      expect(result.type).toBe("variant");
      expect(result.matchCount).toBe(2);
      // Should deduplicate the hash
      expect(result.matchedFingerprints).toEqual(["variant-hash"]);
    });
  });
});
