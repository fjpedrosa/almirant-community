/**
 * Cluster Investigation Context Builder
 *
 * Composes the enriched `ClusterInvestigationContext` payload injected into a
 * bug-fix agent job when triage launches an investigation for a feedback
 * cluster. The builder is intentionally best-effort: it never throws, never
 * performs DB writes, and runs OUTSIDE the launch-investigation transaction.
 *
 * Responsibilities:
 *   1. Compose `priorAttempts`, `statusHistory`, `sampleTickets`, and
 *      `aggregates` from the already-loaded `FeedbackClusterDetail`.
 *   2. Call `runErrorSearchWithTimeout` (no DB-write dependency) with a
 *      query derived from the cluster title/summary and stash the outcome
 *      in `errorSearchResults` + `errorSearchStatus`.
 *   3. Apply a CASCADING truncation strategy to keep the serialized JSON
 *      payload below `TARGET_CONTEXT_SIZE_BYTES` (64 KiB). Each pass reduces
 *      a different section so the final context degrades gracefully for
 *      "toxic" clusters with huge PR bodies / console logs.
 *   4. Record which sections were truncated in `truncation.sections` and
 *      emit an observability log with the final payload size.
 *
 * Determinism: sample-ticket selection is deterministic (3 newest + 2
 * stable-spaced from the remainder). No `Math.random` is called so two
 * back-to-back builds for the same cluster produce byte-identical output.
 */
import { logger } from "@almirant/config";
import {
  ERROR_SEARCH_LIMIT,
  ERROR_SEARCH_TIMEOUT_MS,
  MAX_CONSOLE_LOG_CHARS,
  MAX_FILES_AFFECTED,
  MAX_PR_BODY_CHARS,
  MAX_PRIOR_ATTEMPTS,
  MAX_SAMPLE_TICKETS,
  MAX_SOLUTION_PROPOSED_CHARS,
  TARGET_CONTEXT_SIZE_BYTES,
  type ClusterInvestigationAggregates,
  type ClusterInvestigationContext,
  type ClusterInvestigationTruncation,
  type ClusterInvestigationTruncationSection,
  type DebugContext,
  type ErrorSearchResultInfo,
  type ErrorSearchStatus,
  type FeedbackWidgetSimpleMetadata,
  type InvestigationClusterStatusEvent,
  type PriorAttemptInfo,
  type PriorAttemptPrInfo,
  type SampleTicketDebugContext,
  type SampleTicketInfo,
} from "@almirant/shared";
import type {
  BugFixAttemptWithPr,
  FeedbackClusterDetail,
  FeedbackClusterDetailItem,
} from "@almirant/database";
import {
  runErrorSearchWithTimeout as defaultRunErrorSearchWithTimeout,
  type RunErrorSearchInput,
  type RunErrorSearchResult,
} from "./error-search-query";

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/**
 * Optional dependency injection for the error-search sub-query. Tests override
 * this to exercise timeout / error / skipped branches without having to stand
 * up the database. Production callers omit it and the real implementation is
 * used.
 */
export type RunErrorSearchFn = (
  input: RunErrorSearchInput,
) => Promise<RunErrorSearchResult>;

export interface ClusterInvestigationContextInput {
  clusterId: string;
  workspaceId: string;
  projectId: string;
  /**
   * Attempt being launched — excluded from `priorAttempts` so the context
   * only surfaces PRIOR attempts. Pass `null` when there is no currently
   * active attempt (first investigation for the cluster).
   */
  currentAttempt: BugFixAttemptWithPr | null;
  /**
   * Cluster metadata used to derive the error-search query and for future
   * context enrichment. We accept a structural subset so callers can pass
   * either the full DB row or a narrowed object.
   */
  cluster: {
    id: string;
    title: string;
    summary: string | null;
  };
  detail: FeedbackClusterDetail;
  /**
   * Optional DI for the error-search helper. Defaults to the real
   * `runErrorSearchWithTimeout` when omitted.
   */
  runErrorSearch?: RunErrorSearchFn;
}

// ---------------------------------------------------------------------------
// Internal: lightweight partial `DebugContext` surface used for sample tickets
// ---------------------------------------------------------------------------

type PartialDebugContext = SampleTicketDebugContext;

// ---------------------------------------------------------------------------
// Pure helpers (non-exported)
// ---------------------------------------------------------------------------

/**
 * Truncate `s` to at most `max` characters. Appends `...` when truncation
 * happens; a `null`/empty input is returned unchanged so downstream consumers
 * can distinguish "no value" from "truncated to empty".
 */
const truncateString = (s: string | null | undefined, max: number): string | null => {
  if (s == null) return null;
  if (max <= 0) return "";
  if (s.length <= max) return s;
  // Guarantee the ellipsis fits within `max` so we never grow the string.
  if (max <= 3) return s.slice(0, max);
  return `${s.slice(0, max - 3)}...`;
};

/**
 * Determine whether a metadata blob is a widget `DebugContext` (as opposed to
 * a `FeedbackWidgetSimpleMetadata` or `null`). Mirrors the narrowing logic in
 * `feedback-cluster-repository.narrowFeedbackMetadata` so we only aggregate
 * over tickets that actually carry browser/OS/console info.
 */
const isDebugContext = (
  meta: DebugContext | FeedbackWidgetSimpleMetadata | null | undefined,
): meta is DebugContext => {
  if (!meta) return false;
  if ((meta as DebugContext).source !== "widget") return false;
  return typeof (meta as DebugContext).userAgent === "string";
};

/**
 * Narrow a full `DebugContext` into the slim `SampleTicketDebugContext` shape
 * the agent actually consumes. Caps `consoleErrors` at 10 lines regardless of
 * the source array length.
 */
const narrowDebugContextForSample = (
  meta: DebugContext | FeedbackWidgetSimpleMetadata | null | undefined,
): PartialDebugContext | null => {
  if (!isDebugContext(meta)) return null;
  const consoleErrors = Array.isArray(meta.consoleErrors)
    ? meta.consoleErrors.slice(0, 10)
    : [];
  return {
    screenshotUrl: meta.screenshotUrl ?? null,
    browser: typeof meta.browser === "string" ? meta.browser : null,
    os: typeof meta.os === "string" ? meta.os : null,
    viewportWidth:
      typeof meta.viewportWidth === "number" ? meta.viewportWidth : null,
    viewportHeight:
      typeof meta.viewportHeight === "number" ? meta.viewportHeight : null,
    consoleErrors,
  };
};

/** Count occurrences of a string key and return the top N descending. */
const topN = <T extends string>(
  values: Iterable<T | null | undefined>,
  limit: number,
): Array<{ value: T; count: number }> => {
  const counts = new Map<T, number>();
  for (const v of values) {
    if (v == null) continue;
    const trimmed = (v as string).trim();
    if (!trimmed) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
};

const computeTopPageUrls = (
  metadatas: Array<DebugContext | FeedbackWidgetSimpleMetadata | null>,
): Array<{ url: string; count: number }> => {
  const urls: string[] = [];
  for (const meta of metadatas) {
    if (isDebugContext(meta) && typeof meta.pageUrl === "string" && meta.pageUrl) {
      urls.push(meta.pageUrl);
    }
  }
  return topN(urls, 5).map(({ value, count }) => ({ url: value, count }));
};

const computeTopUserAgents = (
  metadatas: Array<DebugContext | FeedbackWidgetSimpleMetadata | null>,
): Array<{ ua: string; count: number }> => {
  const uas: string[] = [];
  for (const meta of metadatas) {
    if (!isDebugContext(meta)) continue;
    const direct =
      typeof meta.userAgent === "string" && meta.userAgent.trim()
        ? meta.userAgent
        : null;
    const fallback =
      typeof meta.browser === "string" && meta.browser.trim() ? meta.browser : null;
    const chosen = direct ?? fallback;
    if (chosen) uas.push(chosen);
  }
  return topN(uas, 3).map(({ value, count }) => ({ ua: value, count }));
};

const computeTopConsoleErrors = (
  metadatas: Array<DebugContext | FeedbackWidgetSimpleMetadata | null>,
): Array<{ error: string; count: number }> => {
  const firstLines: string[] = [];
  for (const meta of metadatas) {
    if (!isDebugContext(meta)) continue;
    if (!Array.isArray(meta.consoleErrors)) continue;
    for (const line of meta.consoleErrors) {
      if (typeof line !== "string") continue;
      const firstLine = line.split(/\r?\n/)[0]?.trim();
      if (firstLine) firstLines.push(firstLine);
    }
  }
  return topN(firstLines, 5).map(({ value, count }) => ({
    error: value,
    count,
  }));
};

/**
 * Deterministically pick up to `MAX_SAMPLE_TICKETS` items as a mix of "most
 * recent" and "evenly-spaced across the remainder". The input is expected to
 * be ordered by `createdAt` DESC (as `getFeedbackClusterDetail` returns it).
 *
 * Deterministic by construction — no PRNG — so two back-to-back builds yield
 * identical payloads for the same cluster.
 */
const pickSampleTicketItems = (
  items: FeedbackClusterDetailItem[],
  max: number,
): FeedbackClusterDetailItem[] => {
  if (items.length === 0) return [];
  if (items.length <= max) return items.slice();
  const recentCount = Math.min(3, max);
  const recent = items.slice(0, recentCount);
  const remainder = items.slice(recentCount);
  const extraCount = max - recentCount;
  if (extraCount <= 0 || remainder.length === 0) return recent;
  // Stable even-spacing across the remainder. Example for 2 picks across
  // 10 items: indices 2 and 7 — never the same ones already in `recent`.
  const step = Math.max(1, Math.floor(remainder.length / extraCount));
  const extra: FeedbackClusterDetailItem[] = [];
  for (let i = 0; i < extraCount; i += 1) {
    const idx = Math.min(remainder.length - 1, i * step + Math.floor(step / 2));
    const picked = remainder[idx];
    if (picked && !extra.includes(picked)) extra.push(picked);
  }
  return [...recent, ...extra].slice(0, max);
};

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

/**
 * Build a `PriorAttemptInfo` from a DB attempt row. All long-form fields are
 * truncated per the caller-supplied effective limits so the cascading
 * truncation strategy can shrink the serialized payload without rebuilding
 * the attempt list from scratch.
 */
const buildPriorAttempt = (
  attempt: BugFixAttemptWithPr,
  effective: {
    solutionProposed: number;
    prBody: number;
    filesAffected: number;
    rootCause: number;
  },
): PriorAttemptInfo => {
  const files = Array.isArray(attempt.filesAffected)
    ? attempt.filesAffected.slice(0, effective.filesAffected)
    : [];

  // `BugFixAttemptWithPr.pr` is the locally-synced GitHub row minus body /
  // additions / deletions (see bug-fix-attempt-repository.ts). We still
  // surface `pr.url` + `pr.number` from the attempt columns so the agent can
  // at least link to the PR. Body / additions / deletions fall back to null.
  // If a future enrichment attaches body/additions/deletions directly on
  // `attempt.pr`, we will pick it up via defensive optional access without
  // any schema-level change.
  const prFromAttempt = attempt.pr;
  const rawPrBody = (prFromAttempt as { body?: string | null } | null)?.body ?? null;
  const additions =
    (prFromAttempt as { additions?: number | null } | null)?.additions ?? null;
  const deletions =
    (prFromAttempt as { deletions?: number | null } | null)?.deletions ?? null;

  const pr: PriorAttemptPrInfo | null = attempt.fixPrUrl
    ? {
        url: attempt.fixPrUrl,
        number: attempt.fixPrNumber ?? null,
        body: truncateString(rawPrBody, effective.prBody),
        mergedAt: prFromAttempt?.mergedAt
          ? prFromAttempt.mergedAt.toISOString()
          : null,
        additions,
        deletions,
      }
    : null;

  return {
    id: attempt.id,
    attemptNumber: attempt.attemptNumber,
    status: attempt.status,
    createdAt: attempt.createdAt.toISOString(),
    rootCause: truncateString(attempt.rootCause, effective.rootCause),
    solutionProposed: truncateString(
      attempt.solutionProposed,
      effective.solutionProposed,
    ),
    filesAffected: files,
    pr,
  };
};

const buildSampleTicket = (
  item: FeedbackClusterDetailItem,
  effective: { content: number },
): SampleTicketInfo => {
  const debug = narrowDebugContextForSample(item.metadata);
  const pageUrl = isDebugContext(item.metadata) ? item.metadata.pageUrl ?? null : null;
  const userAgent = isDebugContext(item.metadata)
    ? item.metadata.userAgent ?? null
    : null;

  return {
    id: item.id,
    title: item.title,
    content: truncateString(item.content, effective.content),
    createdAt: item.createdAt.toISOString(),
    debugContext: debug,
    pageUrl,
    userAgent,
  };
};

const buildStatusHistory = (
  detail: FeedbackClusterDetail,
): InvestigationClusterStatusEvent[] =>
  detail.statusHistory.map((row) => ({
    fromStatus: row.fromStatus ?? null,
    toStatus: row.toStatus,
    triggeredByKind: row.triggeredByKind,
    triggeredByUserId: row.triggeredByUserId ?? null,
    triggeredByAttemptId: row.triggeredByAttemptId ?? null,
    reason: row.reason ?? null,
    changedAt: row.changedAt.toISOString(),
  }));

const buildAggregates = (
  detail: FeedbackClusterDetail,
): ClusterInvestigationAggregates => {
  const metadatas = detail.items.map((it) => it.metadata);
  return {
    totalTickets: detail.items.length,
    totalAttempts: detail.bugFixAttempts.length,
    topPageUrls: computeTopPageUrls(metadatas),
    topUserAgents: computeTopUserAgents(metadatas),
    topConsoleErrors: computeTopConsoleErrors(metadatas),
  };
};

// ---------------------------------------------------------------------------
// Truncation cascade
// ---------------------------------------------------------------------------

interface EffectiveLimits {
  priorAttemptsCount: number;
  sampleTicketsCount: number;
  solutionProposed: number;
  prBody: number;
  filesAffected: number;
  rootCause: number;
  content: number;
}

const DEFAULT_LIMITS: EffectiveLimits = {
  priorAttemptsCount: MAX_PRIOR_ATTEMPTS,
  sampleTicketsCount: MAX_SAMPLE_TICKETS,
  solutionProposed: MAX_SOLUTION_PROPOSED_CHARS,
  prBody: MAX_PR_BODY_CHARS,
  filesAffected: MAX_FILES_AFFECTED,
  // Root cause has no dedicated constant; reuse solution cap for parity.
  rootCause: MAX_SOLUTION_PROPOSED_CHARS,
  content: MAX_CONSOLE_LOG_CHARS,
};

interface TruncationDebug {
  sections: Record<string, ClusterInvestigationTruncationSection>;
  // Tracks whether a pass shrank any section, used to flip `applied` in the
  // final truncation report.
  anyShrink: boolean;
}

/**
 * Apply one cascade pass by mutating `limits` in place. Returns the new
 * `limits`. Pass IDs match the spec ordering (1..5).
 */
const applyCascadePass = (pass: number, limits: EffectiveLimits): EffectiveLimits => {
  switch (pass) {
    case 1:
      return { ...limits, prBody: Math.max(0, Math.floor(limits.prBody / 2)) };
    case 2:
      return {
        ...limits,
        filesAffected: Math.max(0, Math.floor(limits.filesAffected / 2)),
      };
    case 3:
      return { ...limits, content: Math.max(0, Math.floor(limits.content / 2)) };
    case 4:
      return {
        ...limits,
        priorAttemptsCount: Math.max(0, Math.floor(limits.priorAttemptsCount / 2)),
      };
    case 5:
      return { ...limits, sampleTicketsCount: Math.min(3, limits.sampleTicketsCount) };
    default:
      return limits;
  }
};

const PASS_LABELS: Record<number, string> = {
  1: "priorAttempts.pr.body",
  2: "priorAttempts.filesAffected",
  3: "sampleTickets.content",
  4: "priorAttempts",
  5: "sampleTickets",
};

/**
 * Recompute the mutable sections (priorAttempts + sampleTickets) under a new
 * set of effective limits. Called once per cascade pass.
 */
const buildMutableSections = (
  orderedAttempts: BugFixAttemptWithPr[],
  sampleCandidates: FeedbackClusterDetailItem[],
  limits: EffectiveLimits,
): { priorAttempts: PriorAttemptInfo[]; sampleTickets: SampleTicketInfo[] } => {
  const priorAttempts = orderedAttempts
    .slice(0, limits.priorAttemptsCount)
    .map((a) =>
      buildPriorAttempt(a, {
        solutionProposed: limits.solutionProposed,
        prBody: limits.prBody,
        filesAffected: limits.filesAffected,
        rootCause: limits.rootCause,
      }),
    );

  const sampleTickets = pickSampleTicketItems(
    sampleCandidates,
    limits.sampleTicketsCount,
  ).map((item) => buildSampleTicket(item, { content: limits.content }));

  return { priorAttempts, sampleTickets };
};

const measureBytes = (obj: unknown): number => Buffer.byteLength(JSON.stringify(obj), "utf8");

// ---------------------------------------------------------------------------
// Error-search query derivation
// ---------------------------------------------------------------------------

/**
 * Build a concise free-text query from the cluster title + the first 200
 * chars of the summary. Returns `null` when the cluster has no usable text
 * so callers can short-circuit to `status: "skipped"`.
 */
const deriveErrorSearchQuery = (cluster: {
  title: string;
  summary: string | null;
}): string | null => {
  const title = (cluster.title ?? "").trim();
  const summary = (cluster.summary ?? "").trim().slice(0, 200);
  const combined = [title, summary].filter((s) => s.length > 0).join(" ").trim();
  return combined.length > 0 ? combined : null;
};

const runErrorSearchSafely = async (
  run: RunErrorSearchFn,
  input: RunErrorSearchInput,
): Promise<{ status: ErrorSearchStatus; results: ErrorSearchResultInfo[] }> => {
  try {
    const { status, results } = await run(input);
    return { status, results };
  } catch (err) {
    // `runErrorSearchWithTimeout` already traps internally, but a DI override
    // in tests might throw. We stay best-effort here regardless.
    logger.warn(
      { err, query: input.query },
      "cluster-investigation-context: error_search threw; coercing to status=error",
    );
    return { status: "error", results: [] };
  }
};

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

export const buildClusterInvestigationContext = async (
  input: ClusterInvestigationContextInput,
): Promise<ClusterInvestigationContext> => {
  const run = input.runErrorSearch ?? defaultRunErrorSearchWithTimeout;

  // -- 1. Prior attempts ordering (DESC by createdAt, excluding the active one)
  const orderedAttempts = input.detail.bugFixAttempts
    .filter((a) => (input.currentAttempt ? a.id !== input.currentAttempt.id : true))
    .slice()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  // -- 2. Sample ticket candidates (already DESC-by-createdAt from the repo)
  const sampleCandidates = input.detail.items;

  // -- 3. Immutable sections (status history + aggregates)
  const statusHistory = buildStatusHistory(input.detail);
  const aggregates = buildAggregates(input.detail);

  // -- 4. Error-search sub-query (best-effort, bounded timeout)
  const query = deriveErrorSearchQuery(input.cluster);
  let errorSearchStatus: ErrorSearchStatus = "skipped";
  let errorSearchResults: ErrorSearchResultInfo[] = [];
  if (query) {
    const outcome = await runErrorSearchSafely(run, {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      query,
      limit: ERROR_SEARCH_LIMIT,
      timeoutMs: ERROR_SEARCH_TIMEOUT_MS,
    });
    errorSearchStatus = outcome.status;
    errorSearchResults = outcome.results;
  }

  // -- 5. Initial mutable sections + size probe
  let limits: EffectiveLimits = { ...DEFAULT_LIMITS };
  let { priorAttempts, sampleTickets } = buildMutableSections(
    orderedAttempts,
    sampleCandidates,
    limits,
  );

  const truncationDebug: TruncationDebug = { sections: {}, anyShrink: false };

  const recordSection = (
    key: string,
    kept: number,
    total: number,
  ): void => {
    truncationDebug.sections[key] = { kept, total };
    if (kept < total) truncationDebug.anyShrink = true;
  };

  // -- 6. Cascade passes: rebuild and remeasure on each shrink
  const assembleContext = (): ClusterInvestigationContext => ({
    priorAttempts,
    statusHistory,
    sampleTickets,
    errorSearchResults,
    errorSearchStatus,
    aggregates,
    truncation: {
      applied: false,
      sections: {},
      contextSizeBytes: 0,
    },
  });

  let bytes = measureBytes(assembleContext());
  const triggeredPasses: string[] = [];
  for (let pass = 1; pass <= 5 && bytes > TARGET_CONTEXT_SIZE_BYTES; pass += 1) {
    const before = limits;
    limits = applyCascadePass(pass, limits);
    if (
      before.prBody === limits.prBody &&
      before.filesAffected === limits.filesAffected &&
      before.content === limits.content &&
      before.priorAttemptsCount === limits.priorAttemptsCount &&
      before.sampleTicketsCount === limits.sampleTicketsCount
    ) {
      // No-op pass (e.g. pass 5 when already at 3). Skip to next.
      continue;
    }
    ({ priorAttempts, sampleTickets } = buildMutableSections(
      orderedAttempts,
      sampleCandidates,
      limits,
    ));
    triggeredPasses.push(PASS_LABELS[pass] ?? `pass-${pass}`);
    bytes = measureBytes(assembleContext());
  }

  // -- 7. Record truncation bookkeeping (kept vs total for every variable section)
  const totalAttemptCandidates = orderedAttempts.length;
  recordSection("priorAttempts", priorAttempts.length, totalAttemptCandidates);

  const totalSampleCandidates = sampleCandidates.length;
  recordSection(
    "sampleTickets",
    sampleTickets.length,
    Math.min(totalSampleCandidates, MAX_SAMPLE_TICKETS),
  );

  // Track which specific cascade passes ran — useful for debugging huge clusters.
  for (const label of triggeredPasses) {
    if (!truncationDebug.sections[label]) {
      truncationDebug.sections[label] = { kept: 0, total: 0 };
    }
    truncationDebug.anyShrink = true;
  }

  const truncation: ClusterInvestigationTruncation = {
    applied: truncationDebug.anyShrink,
    sections: truncationDebug.sections,
    contextSizeBytes: bytes,
  };

  const context: ClusterInvestigationContext = {
    priorAttempts,
    statusHistory,
    sampleTickets,
    errorSearchResults,
    errorSearchStatus,
    aggregates,
    truncation,
  };

  logger.info(
    {
      event: "cluster-investigation-context-built",
      clusterId: input.clusterId,
      contextSizeBytes: bytes,
      truncationApplied: truncation.applied,
      truncationPasses: triggeredPasses,
      sectionsPreTruncation: {
        priorAttempts: totalAttemptCandidates,
        sampleTickets: totalSampleCandidates,
        statusHistory: statusHistory.length,
        errorSearchResults: errorSearchResults.length,
      },
      errorSearchStatus,
    },
    "cluster-investigation-context-built",
  );

  return context;
};

// ---------------------------------------------------------------------------
// Test-only exports
//
// Kept below the public API so this module reads top-down as "algorithm →
// helpers". The builder never references these exports at runtime; they are
// surfaced purely so the companion `.test.ts` can drive the pure helpers in
// isolation without needing to stand up a full `ClusterInvestigationContext`.
// ---------------------------------------------------------------------------

export const __testables = {
  truncateString,
  narrowDebugContextForSample,
  computeTopPageUrls,
  computeTopUserAgents,
  computeTopConsoleErrors,
  pickSampleTicketItems,
  deriveErrorSearchQuery,
};
