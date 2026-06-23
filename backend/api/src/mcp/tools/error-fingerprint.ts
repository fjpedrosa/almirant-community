import { createHash } from "crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ErrorFingerprint {
  runtime: string;
  boundary: string;
  canonicalKind: string;
  invariantKey: string;
  normalizedError: string;
  hash: string;
}

export interface ComputeFingerprintParams {
  runtime: string;
  boundary: string;
  canonicalKind: string;
  invariantKey: string;
  normalizedError: string;
}

/**
 * Alias kept for backward compatibility with callers that imported
 * `ComputeFingerprintInput` from the earlier stub.
 */
export type ComputeFingerprintInput = ComputeFingerprintParams;

// ---------------------------------------------------------------------------
// Normalization — strips dynamic segments so equivalent errors hash the same
// ---------------------------------------------------------------------------

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const TIMESTAMP_ISO_RE =
  /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g;
const TIMESTAMP_UNIX_RE = /\b\d{10,13}\b/g;
const FILE_PATH_RE = /(?:\/[\w.-]+){2,}(?::\d+(?::\d+)?)?/g;
const LINE_NUMBER_RE = /\bline\s+\d+/gi;
const HEX_ADDRESS_RE = /\b0x[0-9a-fA-F]{4,}\b/g;
const ANSI_ESCAPE_RE = /\x1b\[[0-9;]*m/g;
const MULTI_SPACE_RE = /\s{2,}/g;

/**
 * Strips dynamic parts from an error message to produce a stable canonical form.
 * Replaces UUIDs, ISO timestamps, unix timestamps, file paths with line numbers,
 * hex addresses, and ANSI escape codes with placeholder tokens.
 */
export const normalizeErrorMessage = (msg: string): string => {
  let result = msg;

  // Strip ANSI escape codes first
  result = result.replace(ANSI_ESCAPE_RE, "");

  // Replace UUIDs
  result = result.replace(UUID_RE, "<UUID>");

  // Replace ISO timestamps
  result = result.replace(TIMESTAMP_ISO_RE, "<TIMESTAMP>");

  // Replace file paths (with optional line numbers)
  result = result.replace(FILE_PATH_RE, "<PATH>");

  // Replace "line NNN" references
  result = result.replace(LINE_NUMBER_RE, "line <N>");

  // Replace hex addresses
  result = result.replace(HEX_ADDRESS_RE, "<HEX>");

  // Replace unix timestamps (10-13 digit numbers) — must come after path replacement
  result = result.replace(TIMESTAMP_UNIX_RE, "<TS>");

  // Collapse whitespace
  result = result.replace(MULTI_SPACE_RE, " ").trim();

  return result;
};

// ---------------------------------------------------------------------------
// Fingerprint computation
// ---------------------------------------------------------------------------

/**
 * Computes a stable SHA-256 fingerprint from the five canonical fields.
 * The hash is computed over the concatenation of the fields separated by `\0`
 * to avoid accidental collisions from field value concatenation.
 */
export const computeFingerprint = (
  params: ComputeFingerprintParams
): ErrorFingerprint => {
  const parts = [
    params.runtime,
    params.boundary,
    params.canonicalKind,
    params.invariantKey,
    params.normalizedError,
  ];

  const hash = createHash("sha256").update(parts.join("\0")).digest("hex");

  return {
    runtime: params.runtime,
    boundary: params.boundary,
    canonicalKind: params.canonicalKind,
    invariantKey: params.invariantKey,
    normalizedError: params.normalizedError,
    hash,
  };
};

// ---------------------------------------------------------------------------
// Inference helpers
// ---------------------------------------------------------------------------

const BOUNDARY_PATTERNS: Array<{ test: (token: string) => boolean; boundary: string }> = [
  { test: (t) => t.includes("runner") || t.includes("packages/remote-agent"), boundary: "runner" },
  { test: (t) => t.includes("web-bridge"), boundary: "web-bridge" },
  { test: (t) => t.includes("frontend") || t.includes("src/app/") || t.includes("src/domains/"), boundary: "frontend" },
  { test: (t) => t.includes("backend/api") || t.includes("routes/") || t.includes("middleware/"), boundary: "backend-api" },
  { test: (t) => t.includes("packages/database") || t.includes("repositories/") || t.includes("schema/"), boundary: "database" },
  { test: (t) => t.includes("stream-consumer") || t.includes("packages/stream"), boundary: "stream-consumer" },
];

/**
 * Infers a system boundary from affected file paths and/or the area string.
 * Falls back to "unknown" when no pattern matches.
 */
export const inferBoundary = (
  affectedFiles: string[],
  area: string
): string => {
  // First try the area string itself (it may already be a valid boundary)
  const areaLower = area.toLowerCase();
  const areaBoundaries = [
    "runner",
    "web-bridge",
    "frontend",
    "backend",
    "database",
    "stream-consumer",
    "scaler",
    "websocket",
    "shim",
    "discord-bridge",
  ] as const;

  for (const b of areaBoundaries) {
    if (areaLower === b) {
      // Normalize "backend" to "backend-api" for consistency
      return b === "backend" ? "backend-api" : b;
    }
  }

  // Then try to match file paths
  for (const file of affectedFiles) {
    const lower = file.toLowerCase();
    for (const pattern of BOUNDARY_PATTERNS) {
      if (pattern.test(lower)) {
        return pattern.boundary;
      }
    }
  }

  return "unknown";
};

const RUNTIME_MAP: Record<string, string> = {
  "claude-code": "claude-code",
  codex: "codex",
  opencode: "opencode",
  "open-code": "opencode",
};

/**
 * Maps a coding agent identifier to a runtime string.
 * Returns "unknown" when the agent is not recognized.
 */
export const inferRuntime = (codingAgent?: string): string => {
  if (!codingAgent) return "unknown";

  const normalized = codingAgent.toLowerCase().trim();

  // Direct match
  if (RUNTIME_MAP[normalized]) {
    return RUNTIME_MAP[normalized]!;
  }

  // Partial match (e.g. "claude-code-v2" -> "claude-code")
  for (const [key, value] of Object.entries(RUNTIME_MAP)) {
    if (normalized.includes(key)) {
      return value;
    }
  }

  return "unknown";
};
