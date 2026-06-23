/**
 * Recurrence classification for error observations.
 *
 * Classifies whether an error fingerprint has been seen before and, if so,
 * what type of recurrence it represents: exact match, cross-runtime match,
 * or a variant of the same canonical error kind.
 *
 * Designed to work alongside the error-fingerprint module (A-1751).
 * If the fingerprint types are not yet available from `./error-fingerprint`,
 * the local `ErrorFingerprintInput` interface provides the required shape.
 */

// -------------------------------------------------------
// Types
// -------------------------------------------------------

export type RecurrenceType =
  | "exact_recurrence"
  | "cross_runtime_recurrence"
  | "variant"
  | "new";

export interface RecurrenceClassification {
  type: RecurrenceType;
  matchCount: number;
  lastSeenAt: string | null;
  matchedFingerprints: string[];
}

/**
 * Minimal fingerprint shape required by the classifier.
 * When A-1751 lands its `ErrorFingerprint` type, callers should use that
 * and the shapes are compatible.
 */
export interface ErrorFingerprintInput {
  hash: string;
  runtime: string;
  boundary: string;
  canonicalKind: string;
  invariantKey: string;
}

/**
 * Shape expected for each existing observation that may carry a fingerprint
 * in its metadata.
 */
export interface ObservationWithFingerprint {
  metadata: Record<string, unknown> | null;
  createdAt: string | Date;
}

// -------------------------------------------------------
// Internal helpers
// -------------------------------------------------------

interface ExtractedFingerprint {
  hash: string;
  runtime: string;
  boundary: string;
  canonicalKind: string;
  invariantKey: string;
}

const extractFingerprint = (
  metadata: Record<string, unknown> | null,
): ExtractedFingerprint | null => {
  if (!metadata) return null;
  const fp = metadata.fingerprint as Record<string, unknown> | undefined;
  if (!fp) return null;
  if (
    typeof fp.hash !== "string" ||
    typeof fp.runtime !== "string" ||
    typeof fp.boundary !== "string" ||
    typeof fp.canonicalKind !== "string" ||
    typeof fp.invariantKey !== "string"
  ) {
    return null;
  }
  return {
    hash: fp.hash,
    runtime: fp.runtime,
    boundary: fp.boundary,
    canonicalKind: fp.canonicalKind,
    invariantKey: fp.invariantKey,
  };
};

const toISOString = (value: string | Date): string => {
  if (typeof value === "string") return value;
  return value.toISOString();
};

// -------------------------------------------------------
// Public API
// -------------------------------------------------------

/**
 * Classify the recurrence of an error fingerprint against a set of existing
 * observations that may or may not carry fingerprint metadata.
 *
 * Classification priority (first match wins):
 *   1. **exact_recurrence** - Same `hash` found in at least one observation.
 *   2. **cross_runtime_recurrence** - Same `canonicalKind` + `invariantKey` +
 *      `boundary` but different `runtime`.
 *   3. **variant** - Same `canonicalKind` but different `invariantKey`.
 *   4. **new** - No matches at all.
 */
export const classifyRecurrence = (params: {
  fingerprint: ErrorFingerprintInput;
  existingObservations: ObservationWithFingerprint[];
}): RecurrenceClassification => {
  const { fingerprint, existingObservations } = params;

  const exactMatches: { hash: string; createdAt: string }[] = [];
  const crossRuntimeMatches: { hash: string; createdAt: string }[] = [];
  const variantMatches: { hash: string; createdAt: string }[] = [];

  for (const obs of existingObservations) {
    const existing = extractFingerprint(obs.metadata);
    if (!existing) continue;

    if (existing.hash === fingerprint.hash) {
      exactMatches.push({
        hash: existing.hash,
        createdAt: toISOString(obs.createdAt),
      });
    } else if (
      existing.canonicalKind === fingerprint.canonicalKind &&
      existing.invariantKey === fingerprint.invariantKey &&
      existing.boundary === fingerprint.boundary &&
      existing.runtime !== fingerprint.runtime
    ) {
      crossRuntimeMatches.push({
        hash: existing.hash,
        createdAt: toISOString(obs.createdAt),
      });
    } else if (
      existing.canonicalKind === fingerprint.canonicalKind &&
      existing.invariantKey !== fingerprint.invariantKey
    ) {
      variantMatches.push({
        hash: existing.hash,
        createdAt: toISOString(obs.createdAt),
      });
    }
  }

  if (exactMatches.length > 0) {
    return {
      type: "exact_recurrence",
      matchCount: exactMatches.length,
      lastSeenAt: mostRecent(exactMatches),
      matchedFingerprints: uniqueHashes(exactMatches),
    };
  }

  if (crossRuntimeMatches.length > 0) {
    return {
      type: "cross_runtime_recurrence",
      matchCount: crossRuntimeMatches.length,
      lastSeenAt: mostRecent(crossRuntimeMatches),
      matchedFingerprints: uniqueHashes(crossRuntimeMatches),
    };
  }

  if (variantMatches.length > 0) {
    return {
      type: "variant",
      matchCount: variantMatches.length,
      lastSeenAt: mostRecent(variantMatches),
      matchedFingerprints: uniqueHashes(variantMatches),
    };
  }

  return {
    type: "new",
    matchCount: 0,
    lastSeenAt: null,
    matchedFingerprints: [],
  };
};

// -------------------------------------------------------
// Utility helpers
// -------------------------------------------------------

const mostRecent = (
  items: { createdAt: string }[],
): string | null => {
  if (items.length === 0) return null;
  return items.reduce((latest, item) =>
    item.createdAt > latest.createdAt ? item : latest,
  ).createdAt;
};

const uniqueHashes = (items: { hash: string }[]): string[] => {
  return [...new Set(items.map((i) => i.hash))];
};
