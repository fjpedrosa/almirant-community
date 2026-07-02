import { logger } from "@almirant/config";
import { db, workItems, eq, updateWorkItem } from "@almirant/database";

type ManagedByAgent = "claude-code" | "codex" | "zipu" | "grok";

const getManagedByAgents = (metadata: Record<string, unknown> | undefined): ManagedByAgent[] => {
  if (!metadata) return [];
  const values: string[] = [];

  const rawManagedBy = metadata.managedBy;
  const rawManagedByAgents = metadata.managedByAgents;

  if (typeof rawManagedBy === "string") values.push(rawManagedBy);
  else if (Array.isArray(rawManagedBy)) values.push(...rawManagedBy.filter((v): v is string => typeof v === "string"));

  if (typeof rawManagedByAgents === "string") values.push(rawManagedByAgents);
  else if (Array.isArray(rawManagedByAgents)) values.push(...rawManagedByAgents.filter((v): v is string => typeof v === "string"));

  const unique = new Set<ManagedByAgent>();
  for (const value of values) {
    if (value === "claude-code" || value === "codex" || value === "zipu" || value === "grok") unique.add(value);
  }
  return Array.from(unique);
};

/**
 * Propagate AI provider metadata from a child work item up to its parent.
 * Merges into the parent's managedByAgents array so multiple children with
 * different providers all appear (e.g. ["claude-code", "zipu", "grok"]).
 * Fire-and-forget — errors are logged but never block the caller.
 */
export const propagateProviderToParent = async (
  workspaceId: string,
  childWorkItemId: string,
  childMetadata: Record<string, unknown>,
): Promise<void> => {
  try {
    const [row] = await db
      .select({ parentId: workItems.parentId })
      .from(workItems)
      .where(eq(workItems.id, childWorkItemId))
      .limit(1);

    if (!row?.parentId) return;

    const [parentRow] = await db
      .select({ metadata: workItems.metadata })
      .from(workItems)
      .where(eq(workItems.id, row.parentId))
      .limit(1);

    if (!parentRow) return;

    const parentMeta = (parentRow.metadata as Record<string, unknown> | null) ?? {};

    // Merge child's providers into parent's managedByAgents
    const childAgents = getManagedByAgents(childMetadata);
    const parentAgents = getManagedByAgents(parentMeta);
    const mergedAgents = new Set([...parentAgents, ...childAgents]);

    // Determine aiProvider for the parent (latest child wins, but existing stays if present)
    const childAiProvider = childMetadata.aiProvider;
    const parentAiProvider = parentMeta.aiProvider;

    const merged: Record<string, unknown> = {
      ...parentMeta,
      managedByAgents: Array.from(mergedAgents),
    };

    if (typeof childAiProvider === "string" && !parentAiProvider) {
      merged.aiProvider = childAiProvider;
    }

    if (typeof childMetadata.managedBy === "string" && !parentMeta.managedBy) {
      merged.managedBy = childMetadata.managedBy;
    }

    await updateWorkItem(workspaceId, row.parentId, { metadata: merged });
  } catch (error) {
    logger.warn(
      { childWorkItemId, error },
      "Failed to propagate AI provider to parent work item",
    );
  }
};
