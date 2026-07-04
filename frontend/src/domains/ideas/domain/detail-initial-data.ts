import type {
  IdeaItemTraceabilityResult,
  IdeaItemWithRelations,
} from "./types";

/**
 * Whether a list item already carries the traceability relations the detail
 * panel needs. Phase 5 will slim the list payloads, so this guard keeps the
 * `initialData` optimisation correct: only reuse the list object when it is
 * genuinely complete, otherwise fall back to the network fetch.
 */
const hasTraceabilityFields = (
  item: IdeaItemWithRelations | null,
): item is IdeaItemWithRelations =>
  !!item &&
  Array.isArray(item.feedbackLinks) &&
  Array.isArray(item.workItemLinks);

/**
 * `initialData` for the idea detail query (`GET /ideas/:id`) sourced from the
 * already-loaded list object, so opening the panel does not re-fetch it.
 */
export const ideaDetailInitialData = (
  item: IdeaItemWithRelations | null,
): IdeaItemWithRelations | undefined =>
  hasTraceabilityFields(item) ? item : undefined;

/**
 * `initialData` for the idea traceability query (`GET /ideas/:id/traceability`)
 * built from the list object's links, avoiding the separate GET on open.
 */
export const ideaTraceabilityInitialData = (
  item: IdeaItemWithRelations | null,
): IdeaItemTraceabilityResult | undefined =>
  hasTraceabilityFields(item)
    ? {
        ideaItem: item,
        feedbackLinks: item.feedbackLinks,
        workItemLinks: item.workItemLinks,
      }
    : undefined;
