// ---------------------------------------------------------------------------
// Ask Feature -- Query Planner
// ---------------------------------------------------------------------------
// Analyzes a user question and produces a structured QueryPlan that drives
// retrieval strategy selection, temporal filtering, and result limits.
// ---------------------------------------------------------------------------

import { logger } from "@almirant/config";
import type { AskRequest } from "./types";
import type { AskCitationSourceType } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SearchStrategy = "fts_only" | "vector_only" | "hybrid";

export interface TemporalFilter {
  from: Date;
  to: Date;
}

export interface QueryPlan {
  /** Original question text */
  originalQuery: string;
  /** Chosen retrieval strategy */
  strategy: SearchStrategy;
  /** Sanitized FTS query string for PostgreSQL plainto_tsquery */
  ftsQuery: string;
  /** Resolved temporal filters (from explicit timeRange or extracted hints) */
  temporalFilters: TemporalFilter | null;
  /** Hinted source types inferred from the question */
  sourceTypeHints: AskCitationSourceType[];
  /** Feature scope (if provided) */
  featureId: string | null;
  /** Project scope */
  projectId: string;
  /** Maximum evidence items to retrieve */
  maxResults: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_RESULTS = 20;

/**
 * Keywords that hint at specific source types.
 * Each entry maps a set of trigger words to the corresponding sourceType.
 */
const SOURCE_TYPE_KEYWORDS: ReadonlyArray<{
  keywords: string[];
  sourceType: AskCitationSourceType;
}> = [
  {
    keywords: ["commit", "commits", "pushed", "merged", "pull request", "pr", "git"],
    sourceType: "commit",
  },
  {
    keywords: ["document", "documents", "doc", "docs", "documentation", "page", "wiki"],
    sourceType: "document",
  },
  {
    keywords: ["task", "tasks", "ticket", "tickets", "story", "stories", "bug", "bugs", "work item", "work items", "epic", "feature"],
    sourceType: "work_item",
  },
  {
    keywords: ["event", "events", "activity", "activities", "changed", "updated", "created", "deleted", "moved"],
    sourceType: "event",
  },
  {
    keywords: ["error", "errors", "memory", "observation", "observations", "pattern", "patterns", "discovery", "decision", "decisions", "architecture", "bugfix", "learned", "learning", "diagnosis", "known issue"],
    sourceType: "observation",
  },
];

/**
 * Relative temporal expressions and their resolution logic.
 * Each entry maps a regex pattern to a function that produces a date range
 * relative to a reference date (typically now).
 */
const TEMPORAL_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  resolve: (now: Date) => TemporalFilter;
}> = [
  {
    pattern: /\blast\s+week\b/i,
    resolve: (now) => ({
      from: subtractDays(now, 7),
      to: now,
    }),
  },
  {
    pattern: /\blast\s+month\b/i,
    resolve: (now) => ({
      from: subtractDays(now, 30),
      to: now,
    }),
  },
  {
    pattern: /\blast\s+(\d+)\s+days?\b/i,
    resolve: (now) => {
      const match = /\blast\s+(\d+)\s+days?\b/i.exec(now.toString());
      // Fallback: handled in extractTemporalHints with capture group
      return { from: subtractDays(now, 7), to: now };
    },
  },
  {
    pattern: /\bthis\s+week\b/i,
    resolve: (now) => ({
      from: startOfWeek(now),
      to: now,
    }),
  },
  {
    pattern: /\bthis\s+month\b/i,
    resolve: (now) => ({
      from: startOfMonth(now),
      to: now,
    }),
  },
  {
    pattern: /\byesterday\b/i,
    resolve: (now) => ({
      from: subtractDays(now, 1),
      to: now,
    }),
  },
  {
    pattern: /\btoday\b/i,
    resolve: (now) => ({
      from: startOfDay(now),
      to: now,
    }),
  },
  {
    pattern: /\bin\s+q1\b/i,
    resolve: (now) => ({
      from: new Date(now.getFullYear(), 0, 1),
      to: new Date(now.getFullYear(), 3, 0, 23, 59, 59),
    }),
  },
  {
    pattern: /\bin\s+q2\b/i,
    resolve: (now) => ({
      from: new Date(now.getFullYear(), 3, 1),
      to: new Date(now.getFullYear(), 6, 0, 23, 59, 59),
    }),
  },
  {
    pattern: /\bin\s+q3\b/i,
    resolve: (now) => ({
      from: new Date(now.getFullYear(), 6, 1),
      to: new Date(now.getFullYear(), 9, 0, 23, 59, 59),
    }),
  },
  {
    pattern: /\bin\s+q4\b/i,
    resolve: (now) => ({
      from: new Date(now.getFullYear(), 9, 1),
      to: new Date(now.getFullYear(), 12, 0, 23, 59, 59),
    }),
  },
];

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

const subtractDays = (date: Date, days: number): Date => {
  const result = new Date(date);
  result.setDate(result.getDate() - days);
  return result;
};

const startOfWeek = (date: Date): Date => {
  const result = new Date(date);
  const day = result.getDay();
  const diff = day === 0 ? 6 : day - 1; // Monday as start of week
  result.setDate(result.getDate() - diff);
  result.setHours(0, 0, 0, 0);
  return result;
};

const startOfMonth = (date: Date): Date => {
  const result = new Date(date);
  result.setDate(1);
  result.setHours(0, 0, 0, 0);
  return result;
};

const startOfDay = (date: Date): Date => {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
};

// ---------------------------------------------------------------------------
// Internal extraction functions
// ---------------------------------------------------------------------------

/**
 * Extract temporal hints from the question text using regex patterns.
 * Returns the first matching temporal filter, or null if none found.
 */
const extractTemporalHints = (question: string, now: Date): TemporalFilter | null => {
  // Special handling for "last N days" with capture group
  const lastNDaysMatch = /\blast\s+(\d+)\s+days?\b/i.exec(question);
  if (lastNDaysMatch) {
    const days = parseInt(lastNDaysMatch[1]!, 10);
    if (days > 0 && days <= 365) {
      return { from: subtractDays(now, days), to: now };
    }
  }

  for (const { pattern, resolve } of TEMPORAL_PATTERNS) {
    if (pattern.test(question)) {
      return resolve(now);
    }
  }

  return null;
};

/**
 * Detect source type hints from the question based on keyword matching.
 * Returns a deduplicated array of hinted source types.
 */
const extractSourceTypeHints = (question: string): AskCitationSourceType[] => {
  const lowerQuestion = question.toLowerCase();
  const hints = new Set<AskCitationSourceType>();

  for (const { keywords, sourceType } of SOURCE_TYPE_KEYWORDS) {
    for (const keyword of keywords) {
      if (lowerQuestion.includes(keyword)) {
        hints.add(sourceType);
        break;
      }
    }
  }

  return Array.from(hints);
};

/**
 * Build a clean FTS query string from the user question.
 * Strips common stop words and special characters, keeping meaningful terms
 * for PostgreSQL plainto_tsquery.
 */
const buildFtsQuery = (question: string): string => {
  // Remove punctuation except hyphens within words, then collapse whitespace
  const cleaned = question
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned;
};

/**
 * Determine the search strategy based on the query characteristics.
 * Currently defaults to fts_only since vector search is not yet wired.
 * Returns "hybrid" when both FTS and vector are available.
 */
const determineStrategy = (_question: string): SearchStrategy => {
  // Vector search (embedding-based) is planned but not yet implemented.
  // Once ask_chunks embeddings are queryable, this should return "hybrid"
  // for most queries and "vector_only" for very short or vague questions.
  return "fts_only";
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyze an AskRequest and produce a structured QueryPlan for retrieval.
 *
 * The plan resolves:
 * - Search strategy (FTS, vector, or hybrid)
 * - Temporal filters from explicit timeRange or extracted natural-language hints
 * - Source type hints from keywords in the question
 * - Sanitized FTS query string
 */
export const planQuery = (request: AskRequest): QueryPlan => {
  const now = new Date();

  // Resolve temporal filters: explicit timeRange takes precedence
  let temporalFilters: TemporalFilter | null = null;
  if (request.timeRange?.from && request.timeRange?.to) {
    temporalFilters = {
      from: new Date(request.timeRange.from),
      to: new Date(request.timeRange.to),
    };
  } else {
    temporalFilters = extractTemporalHints(request.question, now);
  }

  const sourceTypeHints = extractSourceTypeHints(request.question);
  const strategy = determineStrategy(request.question);
  const ftsQuery = buildFtsQuery(request.question);

  const plan: QueryPlan = {
    originalQuery: request.question,
    strategy,
    ftsQuery,
    temporalFilters,
    sourceTypeHints,
    featureId: request.featureId ?? null,
    projectId: request.projectId,
    maxResults: DEFAULT_MAX_RESULTS,
  };

  logger.debug({ plan }, "ask: query plan created");

  return plan;
};
