import { workItemsApi } from "@/lib/api/client";
import type {
  WorkItemMetadata,
  WorkItemWithRelations,
} from "../../domain/types";

/**
 * On-demand loaders for board copy actions.
 *
 * The board list is slim under `?view=board`: it omits the full `description`
 * and the metadata blobs `generatedPrompt` / `definitionOfDone`. The copy
 * actions therefore MUST refetch the full work item by id (which carries the
 * complete text) and build the prompt from it — never from the slim list row.
 *
 * The getter is injected for testability; it defaults to the real API client.
 */

type WorkItemGetter = (id: string) => Promise<unknown>;

export interface PromptCopyData {
  id: string;
  title: string;
  description: string;
  definitionOfDone: string;
}

/** Loads the full item and extracts the fields the AI prompt builder needs. */
export const resolvePromptCopyData = async (
  id: string,
  get: WorkItemGetter = workItemsApi.get,
): Promise<PromptCopyData> => {
  const full = (await get(id)) as WorkItemWithRelations;
  const metadata = full.metadata as WorkItemMetadata | undefined;
  return {
    id,
    title: full.title,
    description: full.description ?? "",
    definitionOfDone: (metadata?.definitionOfDone as string | undefined) ?? "",
  };
};

/** Loads the full item and returns its saved generated prompt (or null). */
export const resolveSavedPrompt = async (
  id: string,
  get: WorkItemGetter = workItemsApi.get,
): Promise<string | null> => {
  const full = (await get(id)) as WorkItemWithRelations;
  const metadata = full.metadata as WorkItemMetadata | undefined;
  const prompt = metadata?.generatedPrompt;
  return typeof prompt === "string" && prompt.length > 0 ? prompt : null;
};
