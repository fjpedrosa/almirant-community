/**
 * Agent job enrichment with runtime, boundary, fingerprint, and ownership.
 *
 * Computes derived observability fields from existing job data without
 * requiring new database columns. All computation is deterministic and
 * based on the job's `codingAgent`, `skillName`, `errorMessage`, `errorType`,
 * and `result` fields.
 */

import {
  inferRuntime,
  inferBoundary,
  normalizeErrorMessage,
  computeFingerprint,
} from "../../../mcp/tools/error-fingerprint";
import {
  getSuggestedOwnership,
  type BoundaryOwnership,
} from "./boundary-ownership";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JobEnrichmentInput {
  codingAgent?: string | null;
  skillName?: string | null;
  errorMessage?: string | null;
  errorType?: string | null;
  // Accept any JSONB-shaped value. Callers pass structured types like
  // AgentJobConfig (no index signature), so we widen to `unknown` and narrow
  // inside helpers that actually read fields.
  config?: unknown;
  result?: unknown;
}

export interface JobEnrichmentResult {
  runtime: string;
  boundary: string;
  fingerprint: string | null;
  suggestedOwnership: BoundaryOwnership;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Safely extract an array of strings from a possibly-untyped `filesChanged`
 * field inside the job result JSONB.
 */
const extractFilesChanged = (result: unknown): string[] => {
  if (!result || typeof result !== "object") return [];
  const raw = (result as Record<string, unknown>).filesChanged;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string");
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Enriches a single agent job with computed observability fields:
 * - `runtime` : inferred from `codingAgent` (e.g. "claude-code", "codex")
 * - `boundary`: inferred from result file paths + skillName area
 * - `fingerprint`: SHA-256 hash when an error is present, null otherwise
 * - `suggestedOwnership`: team + escalation contact based on boundary
 *
 * All fields are derived deterministically from existing job data.
 * This function never throws; it falls back to safe defaults.
 */
export const enrichJobWithFingerprint = (job: JobEnrichmentInput): JobEnrichmentResult => {
  const runtime = inferRuntime(job.codingAgent ?? undefined);

  const filesChanged = extractFilesChanged(job.result);
  const area = job.skillName ?? "";
  const boundary = inferBoundary(filesChanged, area);

  let fingerprint: string | null = null;

  if (job.errorMessage) {
    try {
      const normalizedError = normalizeErrorMessage(job.errorMessage);
      const canonicalKind = job.errorType ?? "unclassified";
      const invariantKey = [job.skillName ?? "unknown", canonicalKind].join(":");

      const fp = computeFingerprint({
        runtime,
        boundary,
        canonicalKind,
        invariantKey,
        normalizedError,
      });

      fingerprint = fp.hash;
    } catch {
      // Best-effort: return null fingerprint on any computation error
      fingerprint = null;
    }
  }

  const suggestedOwnership = getSuggestedOwnership(boundary);

  return {
    runtime,
    boundary,
    fingerprint,
    suggestedOwnership,
  };
};

/**
 * Enriches an array of jobs in bulk. Thin wrapper over `enrichJobWithFingerprint`
 * that maps each job and merges enrichment fields into the response object.
 *
 * The generic type parameter preserves the original job shape so callers
 * do not lose type information.
 */
export const enrichJobsWithFingerprint = <T extends JobEnrichmentInput>(
  jobs: T[],
): (T & JobEnrichmentResult)[] => {
  return jobs.map((job) => ({
    ...job,
    ...enrichJobWithFingerprint(job),
  }));
};
