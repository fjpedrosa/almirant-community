import { z } from "zod";
import { addDependency, createWorkItem, db } from "@almirant/database";
import { logger } from "@almirant/config";

type WorkItemGenerationExecutor = Parameters<Parameters<typeof db.transaction>[0]>[0];

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

export const aiWorkItemDependencySchema = z.object({
  blockedTempId: z.string().min(1),
  blockedByTempId: z.string().min(1),
});

export type AiWorkItemDependency = z.infer<typeof aiWorkItemDependencySchema>;

export const aiWorkItemsPayloadSchema = z
  .object({
    items: aiWorkItemsArraySchema,
    dependencies: z.array(aiWorkItemDependencySchema).default([]),
  })
  .superRefine((payload, ctx) => {
    const seenTempIds = new Set<string>();
    payload.items.forEach((item, index) => {
      if (seenTempIds.has(item.tempId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Each plan item must have a unique tempId.",
          path: ["items", index, "tempId"],
        });
      }
      seenTempIds.add(item.tempId);
    });

    const tempIds = new Set(payload.items.map((item) => item.tempId));
    payload.dependencies.forEach((dependency, index) => {
      if (dependency.blockedTempId === dependency.blockedByTempId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A work item cannot depend on itself.",
          path: ["dependencies", index],
        });
      }
      if (!tempIds.has(dependency.blockedTempId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Dependency references unknown tempId "${dependency.blockedTempId}".`,
          path: ["dependencies", index, "blockedTempId"],
        });
      }
      if (!tempIds.has(dependency.blockedByTempId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Dependency references unknown tempId "${dependency.blockedByTempId}".`,
          path: ["dependencies", index, "blockedByTempId"],
        });
      }
    });
  });

export type AiWorkItemsPayload = z.infer<typeof aiWorkItemsPayloadSchema>;

export interface GenerateWorkItemsInput {
  workspaceId: string;
  items: AiWorkItem[];
  dependencies?: AiWorkItemDependency[];
  projectId: string;
  boardId: string;
  boardColumnId: string;
  atomic?: boolean;
  executor?: WorkItemGenerationExecutor;
}

export interface GenerateWorkItemsResult {
  createdIds: string[];
  tempToRealIdMap: Record<string, string>;
  errors: Array<{ tempId: string; error: string }>;
  dependenciesCreated: number;
  dependencyErrors: Array<{ blockedTempId: string; blockedByTempId: string; error: string }>;
}

const assertUniqueTempIds = (items: AiWorkItem[]): void => {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.tempId)) throw new Error("Each plan item must have a unique tempId.");
    seen.add(item.tempId);
  }
};

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
  const { workspaceId, items, dependencies = [], projectId, boardId, boardColumnId } = input;
  const payload = aiWorkItemsPayloadSchema.parse({ items, dependencies });
  assertUniqueTempIds(payload.items);

  // Topological sort so parents come first
  const sorted = topologicalSort(payload.items);

  const applyGeneration = async (executor?: WorkItemGenerationExecutor): Promise<GenerateWorkItemsResult> => {
    const tempToRealIdMap: Record<string, string> = {};
    const createdIds: string[] = [];
    const errors: Array<{ tempId: string; error: string }> = [];

    for (const item of sorted) {
      try {
        let parentId: string | undefined;
        if (item.parentTempId) {
          parentId = tempToRealIdMap[item.parentTempId];
          if (!parentId) {
            throw new Error(`Parent tempId "${item.parentTempId}" was not created.`);
          }
        }

        const created = await createWorkItem(
          workspaceId,
          {
            projectId,
            boardId,
            // Community's persisted work_items schema requires a board column
            // for every generated row, including hierarchy parents. Keep the
            // parentId edge for hierarchy while placing every row in the
            // caller-selected target/default column.
            boardColumnId,
            type: item.type,
            title: item.title,
            description: item.description ?? undefined,
            priority: item.priority,
            parentId: parentId ?? undefined,
            metadata: { generatedByAi: true },
          },
          undefined,
          { executor, skipParentStateChecks: Boolean(item.parentTempId && parentId) },
        );

        tempToRealIdMap[item.tempId] = created.id;
        createdIds.push(created.id);
      } catch (err) {
        if (input.atomic) throw err;
        logger.error({ tempId: item.tempId, err }, "Failed to create AI-generated work item");
        errors.push({ tempId: item.tempId, error: "Failed to create work item" });
      }
    }

    const dependencyErrors: Array<{ blockedTempId: string; blockedByTempId: string; error: string }> = [];
    let dependenciesCreated = 0;
    for (const dependency of payload.dependencies) {
      const blockedId = tempToRealIdMap[dependency.blockedTempId];
      const blockedByWorkItemId = tempToRealIdMap[dependency.blockedByTempId];
      if (!blockedId || !blockedByWorkItemId) {
        if (input.atomic) throw new Error("One or both work items in this dependency were not created");
        dependencyErrors.push({ ...dependency, error: "One or both work items in this dependency were not created" });
        continue;
      }
      try {
        await addDependency(blockedId, blockedByWorkItemId, executor);
        dependenciesCreated += 1;
      } catch (err) {
        if (input.atomic) throw err;
        logger.error({ dependency, err }, "Failed to create AI-generated work item dependency");
        dependencyErrors.push({ ...dependency, error: "Failed to create dependency" });
      }
    }

    return { createdIds, tempToRealIdMap, errors, dependenciesCreated, dependencyErrors };
  };

  if (input.atomic && input.executor) return applyGeneration(input.executor);
  if (input.atomic) return db.transaction((tx) => applyGeneration(tx));
  return applyGeneration();
};
