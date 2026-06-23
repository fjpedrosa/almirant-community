import { z } from "zod";
import { createWorkItem, isLeafType } from "@almirant/database";
import type { WorkItemType } from "@almirant/database";
import { logger } from "@almirant/config";

// Zod schema for AI-generated work items
export const aiWorkItemSchema = z.object({
  tempId: z.string().min(1),
  type: z.enum(["epic", "feature", "story", "task"]),
  title: z.string().min(1),
  description: z.string().optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  parentTempId: z.string().optional(),
});

export const aiWorkItemsArraySchema = z.array(aiWorkItemSchema).min(1);

export type AiWorkItem = z.infer<typeof aiWorkItemSchema>;

export interface GenerateWorkItemsInput {
  organizationId: string;
  items: AiWorkItem[];
  projectId: string;
  boardId: string;
  boardColumnId: string;
}

export interface GenerateWorkItemsResult {
  createdIds: string[];
  tempToRealIdMap: Record<string, string>;
  errors: Array<{ tempId: string; error: string }>;
}

/**
 * Topological sort: orders items so parents are created before children.
 * Throws if a circular dependency is detected.
 */
const topologicalSort = (items: AiWorkItem[]): AiWorkItem[] => {
  const itemMap = new Map<string, AiWorkItem>();
  for (const item of items) {
    itemMap.set(item.tempId, item);
  }

  const sorted: AiWorkItem[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const visit = (tempId: string) => {
    if (visited.has(tempId)) return;
    if (visiting.has(tempId)) {
      throw new Error(`Circular dependency detected involving tempId: ${tempId}`);
    }

    visiting.add(tempId);

    const item = itemMap.get(tempId);
    if (item?.parentTempId && itemMap.has(item.parentTempId)) {
      visit(item.parentTempId);
    }

    visiting.delete(tempId);
    visited.add(tempId);
    if (item) sorted.push(item);
  };

  for (const item of items) {
    visit(item.tempId);
  }

  return sorted;
};

/**
 * Generate work items from AI output.
 * Validates, topologically sorts, creates items respecting hierarchy,
 * and resolves parentTempId → real parentId.
 */
export const generateWorkItems = async (
  input: GenerateWorkItemsInput
): Promise<GenerateWorkItemsResult> => {
  const { organizationId, items, projectId, boardId, boardColumnId } = input;

  // Validate with Zod
  const parsed = aiWorkItemsArraySchema.parse(items);

  // Topological sort so parents come first
  const sorted = topologicalSort(parsed);

  const tempToRealIdMap: Record<string, string> = {};
  const createdIds: string[] = [];
  const errors: Array<{ tempId: string; error: string }> = [];

  for (const item of sorted) {
    try {
      // Resolve parentId from temp mapping
      let parentId: string | undefined;
      if (item.parentTempId) {
        parentId = tempToRealIdMap[item.parentTempId];
        if (!parentId) {
          throw new Error(
            `Parent tempId "${item.parentTempId}" not yet created. It may have failed or is missing from the items array.`
          );
        }
      }

      const created = await createWorkItem(
        organizationId,
        {
          projectId,
          boardId,
          boardColumnId: isLeafType(item.type as WorkItemType) ? boardColumnId : null,
          type: item.type,
          title: item.title,
          description: item.description ?? undefined,
          priority: item.priority,
          parentId: parentId ?? undefined,
          metadata: { generatedByAi: true },
        }
      );

      tempToRealIdMap[item.tempId] = created.id;
      createdIds.push(created.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      logger.error({ tempId: item.tempId, error: message }, "Failed to create AI-generated work item");
      errors.push({ tempId: item.tempId, error: message });
    }
  }

  return { createdIds, tempToRealIdMap, errors };
};
