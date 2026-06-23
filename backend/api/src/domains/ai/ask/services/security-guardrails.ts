// ---------------------------------------------------------------------------
// Ask Feature -- Security Guardrails
// ---------------------------------------------------------------------------
// Tenancy validation, rate limiting, prompt injection detection, and output
// sanitization for the Ask pipeline.
// ---------------------------------------------------------------------------

import { logger } from "@almirant/config";
import { getOrganizationIdByProjectId } from "@almirant/database";
import { AskError } from "./ask-orchestrator";

// ---------------------------------------------------------------------------
// Prompt injection detection
// ---------------------------------------------------------------------------

/**
 * Regex patterns that detect common prompt injection attempts.
 * Each pattern is case-insensitive. The list is intentionally broad to
 * catch variations while accepting that some legitimate questions may
 * require the sanitizer to strip benign matches.
 */
export const PROMPT_INJECTION_PATTERNS: RegExp[] = [
  // System prompt override attempts
  /\bsystem\s*:\s*/gi,
  /\[SYSTEM\]/gi,
  /<<\s*SYS\s*>>/gi,
  /\bsystem\s+prompt\b/gi,

  // Role-play / persona hijacking
  /\byou\s+are\s+now\b/gi,
  /\bact\s+as\b/gi,
  /\bpretend\s+(you\s+are|to\s+be)\b/gi,
  /\brole\s*play\b/gi,
  /\bswitch\s+to\s+.*mode\b/gi,

  // Ignore / override instructions
  /\bignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)\b/gi,
  /\bdisregard\s+(all\s+)?(previous|above|prior)\b/gi,
  /\bforget\s+(all\s+)?(previous|above|prior)\b/gi,
  /\boverride\s+(all\s+)?(instructions?|rules?|constraints?)\b/gi,

  // Jailbreak markers
  /\bDAN\b/g,
  /\bdo\s+anything\s+now\b/gi,
  /\bjailbreak\b/gi,

  // Prompt leaking attempts
  /\brepeat\s+(the\s+)?(system\s+)?(prompt|instructions?)\b/gi,
  /\bshow\s+(me\s+)?(the\s+)?(system\s+)?(prompt|instructions?)\b/gi,
  /\bwhat\s+(are|is)\s+(your|the)\s+(system\s+)?(instructions?|prompt|rules?)\b/gi,
  /\bprint\s+(your\s+)?(initial|system)\s+(prompt|instructions?)\b/gi,
];

/**
 * Patterns that may appear in LLM output indicating leaked system prompt
 * fragments or internal metadata that should not be exposed.
 */
const OUTPUT_LEAK_PATTERNS: RegExp[] = [
  /\bYou are a project intelligence assistant\b/gi,
  /\bBase your answer ONLY on the provided evidence\b/gi,
  /\bFollow these rules strictly\b/gi,
  /\bSYNTHESIS_SYSTEM_PROMPT\b/gi,
  /\bAskError\b/gi,
];

/**
 * Basic PII patterns to strip from output (emails and phone-like strings).
 * Intentionally conservative to avoid false positives on legitimate data.
 */
const PII_PATTERNS: RegExp[] = [
  // Standalone emails that look like internal/system emails
  /\b[A-Za-z0-9._%+-]+@(internal|system|localhost|almirant)\.[a-z]{2,}\b/gi,
];

// ---------------------------------------------------------------------------
// Sanitization functions
// ---------------------------------------------------------------------------

/**
 * Strip potential prompt injection patterns from the user question.
 * Returns the cleaned question. Logs a warning when injections are detected.
 */
export const sanitizeQuestion = (question: string): string => {
  let sanitized = question;
  let detected = false;

  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    if (pattern.test(sanitized)) {
      detected = true;
      // Reset lastIndex again before replace
      pattern.lastIndex = 0;
      sanitized = sanitized.replace(pattern, "");
    }
  }

  // Collapse excessive whitespace left after stripping
  sanitized = sanitized.replace(/\s{2,}/g, " ").trim();

  if (detected) {
    logger.warn(
      {
        originalLength: question.length,
        sanitizedLength: sanitized.length,
      },
      "ask-security: prompt injection patterns detected and stripped from question",
    );
  }

  return sanitized;
};

/**
 * Strip leaked system prompt fragments and PII patterns from LLM output.
 * Returns the cleaned answer.
 */
export const sanitizeOutput = (answer: string): string => {
  let sanitized = answer;

  for (const pattern of OUTPUT_LEAK_PATTERNS) {
    pattern.lastIndex = 0;
    sanitized = sanitized.replace(pattern, "[redacted]");
  }

  for (const pattern of PII_PATTERNS) {
    pattern.lastIndex = 0;
    sanitized = sanitized.replace(pattern, "[email redacted]");
  }

  return sanitized;
};

// ---------------------------------------------------------------------------
// Project-organization tenancy validation
// ---------------------------------------------------------------------------

/**
 * Verify that the given project belongs to the specified organization.
 * Throws `AskError("INVALID_PROJECT", ...)` if the project does not exist
 * or belongs to a different organization.
 */
export const validateProjectAccess = async (
  organizationId: string,
  projectId: string,
): Promise<void> => {
  const projectOrgId = await getOrganizationIdByProjectId(projectId);

  if (!projectOrgId) {
    logger.warn(
      { projectId, organizationId },
      "ask-security: project not found during tenancy validation",
    );
    throw new AskError("INVALID_PROJECT", "Project not found");
  }

  if (projectOrgId !== organizationId) {
    logger.warn(
      { projectId, organizationId, projectOrgId },
      "ask-security: project does not belong to the caller organization",
    );
    throw new AskError(
      "INVALID_PROJECT",
      "Project does not belong to the current organization",
    );
  }
};

// ---------------------------------------------------------------------------
// In-memory rate limiter
// ---------------------------------------------------------------------------

/** Maximum requests per organization per window */
const RATE_LIMIT_MAX_REQUESTS = 20;

/** Sliding window duration in milliseconds (1 minute) */
const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Internal store: maps organizationId to an array of request timestamps.
 * Old entries are pruned on each check.
 */
const rateLimitStore = new Map<string, number[]>();

/**
 * Check whether the organization is within the rate limit for Ask requests.
 *
 * Returns `{ allowed: true }` when the request can proceed, or
 * `{ allowed: false, retryAfterMs }` when the limit has been exceeded.
 */
export const checkRateLimit = (
  organizationId: string,
): { allowed: boolean; retryAfterMs?: number } => {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  // Get existing timestamps and prune expired ones
  const timestamps = (rateLimitStore.get(organizationId) ?? []).filter(
    (ts) => ts > windowStart,
  );

  if (timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    // Earliest timestamp still in the window determines retry delay
    const oldestInWindow = timestamps[0]!;
    const retryAfterMs = oldestInWindow + RATE_LIMIT_WINDOW_MS - now;

    logger.warn(
      { organizationId, requestsInWindow: timestamps.length },
      "ask-security: rate limit exceeded",
    );

    // Store the pruned array
    rateLimitStore.set(organizationId, timestamps);

    return { allowed: false, retryAfterMs: Math.max(retryAfterMs, 1000) };
  }

  // Record the current request
  timestamps.push(now);
  rateLimitStore.set(organizationId, timestamps);

  return { allowed: true };
};
