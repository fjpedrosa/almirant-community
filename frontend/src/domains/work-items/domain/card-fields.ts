import type { WorkItemMetadata, WorkItemWithContext } from "./types";

/**
 * Pure selectors that let the board card read the fields it needs from BOTH the
 * slim board DTO (`?view=board`) and the full DTO, so no card affordance breaks
 * when the heavy fields are omitted:
 *  - slim mode exposes `descriptionPreview` + `hasGeneratedPrompt` /
 *    `hasDefinitionOfDone` flags (content omitted).
 *  - full mode carries `description` + full `metadata`.
 * Inputs are narrowed (Interface Segregation) to only the fields each reads.
 */

type CardDescriptionInput = Pick<
  WorkItemWithContext,
  "description" | "descriptionPreview"
>;
type CardPromptInput = Pick<WorkItemWithContext, "metadata" | "hasGeneratedPrompt">;
type CardDodInput = Pick<WorkItemWithContext, "metadata" | "hasDefinitionOfDone">;

/** ≤200-char description preview for the card, from either DTO shape. */
export const getCardDescriptionPreview = (
  item: CardDescriptionInput,
): string | null => item.descriptionPreview ?? item.description ?? null;

/** Whether a saved AI prompt exists (drives the "copy saved prompt" button). */
export const hasSavedPrompt = (item: CardPromptInput): boolean => {
  if (typeof item.hasGeneratedPrompt === "boolean") return item.hasGeneratedPrompt;
  const prompt = (item.metadata as WorkItemMetadata | undefined)?.generatedPrompt;
  return typeof prompt === "string" && prompt.length > 0;
};

/** Whether a Definition of Done exists (drives the DoD popup affordance). */
export const hasDefinitionOfDone = (item: CardDodInput): boolean => {
  if (typeof item.hasDefinitionOfDone === "boolean") return item.hasDefinitionOfDone;
  const dod = (item.metadata as WorkItemMetadata | undefined)?.definitionOfDone;
  return typeof dod === "string" && dod.length > 0;
};
