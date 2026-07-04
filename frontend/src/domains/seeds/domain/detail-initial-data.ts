import type {
  SeedFeedbackLink,
  SeedWithRelations,
  SeedWorkItemLink,
} from "@/domains/planning/domain/types";

export interface SeedTraceabilityInitialData {
  feedbackLinks: SeedFeedbackLink[];
  workItemLinks: SeedWorkItemLink[];
}

/**
 * Whether a list seed already carries the traceability relations the detail
 * panel needs. Phase 5 will slim the list payloads, so this guard keeps the
 * `initialData` optimisation correct: only reuse the list seed when complete.
 */
const hasTraceabilityFields = (
  seed: SeedWithRelations | null,
): seed is SeedWithRelations =>
  !!seed &&
  Array.isArray(seed.feedbackLinks) &&
  Array.isArray(seed.workItemLinks);

/**
 * `initialData` for the seed detail query (`GET /seeds/:id`) sourced from the
 * already-loaded list seed, so opening the panel does not re-fetch it.
 */
export const seedDetailInitialData = (
  seed: SeedWithRelations | null,
): SeedWithRelations | undefined =>
  hasTraceabilityFields(seed) ? seed : undefined;

/**
 * `initialData` for the seed traceability query (`GET /seeds/:id/traceability`)
 * built from the list seed's links. Shape matches the API response
 * (`{ feedbackLinks, workItemLinks }`), so the separate GET is skipped on open.
 */
export const seedTraceabilityInitialData = (
  seed: SeedWithRelations | null,
): SeedTraceabilityInitialData | undefined =>
  hasTraceabilityFields(seed)
    ? {
        feedbackLinks: seed.feedbackLinks,
        workItemLinks: seed.workItemLinks,
      }
    : undefined;
