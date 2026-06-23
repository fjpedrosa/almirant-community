import type { AncestorInfo, ChildrenSummary, GroupByMode, TopmostNodeProjection, WorkItemWithContext } from "./types";

// ─── Types ───────────────────────────────────────────────────────────

export interface HierarchyGroupNode {
  ancestor: AncestorInfo | null;
  depth: number;
  children: HierarchyGroupNode[];
  items: WorkItemWithContext[];
  totalItemCount: number;
}

export type HierarchyRenderItem =
  | { kind: "group-header"; node: HierarchyGroupNode; groupKey: string; depth: number }
  | { kind: "work-item"; item: WorkItemWithContext };

// ─── Build hierarchy tree ────────────────────────────────────────────

const getAncestorForGroupBy = (item: WorkItemWithContext, groupBy: Exclude<GroupByMode, "none">): AncestorInfo | null => {
  const ancestors = item.ancestors;
  if (!ancestors || ancestors.length === 0) return null;

  if (groupBy === "parent") {
    return ancestors[0] ?? null;
  }

  return ancestors.find((a) => a.type === groupBy) ?? null;
};

/**
 * Build a 1-level grouping tree based on the selected grouping mode.
 *
 * - parent: direct parent (ancestors[0])
 * - epic/feature/story: first ancestor with that type
 * - items without a matching ancestor go to the ungrouped bucket
 */
export const buildGroupsBy = (
  items: WorkItemWithContext[],
  groupBy: Exclude<GroupByMode, "none">,
): HierarchyGroupNode[] => {
  const groups: HierarchyGroupNode[] = [];
  const nodeById = new Map<string, HierarchyGroupNode>();
  let ungroupedNode: HierarchyGroupNode | null = null;

  for (const item of items) {
    const ancestor = getAncestorForGroupBy(item, groupBy);

    if (!ancestor) {
      if (!ungroupedNode) {
        ungroupedNode = { ancestor: null, depth: 0, children: [], items: [], totalItemCount: 0 };
      }
      ungroupedNode.items.push(item);
      continue;
    }

    let node = nodeById.get(ancestor.id);
    if (!node) {
      node = { ancestor, depth: 0, children: [], items: [], totalItemCount: 0 };
      nodeById.set(ancestor.id, node);
      groups.push(node);
    }
    node.items.push(item);
  }

  if (ungroupedNode) {
    groups.push(ungroupedNode);
  }

  for (const node of groups) {
    node.totalItemCount = node.items.length;
  }

  return groups;
};

/**
 * Build a hierarchy tree from flat work items using their `ancestors` arrays.
 *
 * Each item's `ancestors` is ordered [parent, grandparent, …, root].
 * We reverse it to [root, …, parent] and walk down creating/finding nodes.
 */
export const buildHierarchyGroups = (items: WorkItemWithContext[]): HierarchyGroupNode[] => {
  const roots: HierarchyGroupNode[] = [];
  // Map ancestor-id → node for fast lookup
  const nodeById = new Map<string, HierarchyGroupNode>();
  // Ungrouped bucket (items without ancestors or parent)
  let ungroupedNode: HierarchyGroupNode | null = null;

  for (const item of items) {
    const ancestors = item.ancestors && item.ancestors.length > 0
      ? [...item.ancestors].reverse() // [root, …, parent]
      : null;

    if (!ancestors) {
      // No hierarchy info → ungrouped
      if (!ungroupedNode) {
        ungroupedNode = { ancestor: null, depth: 0, children: [], items: [], totalItemCount: 0 };
      }
      ungroupedNode.items.push(item);
      continue;
    }

    let parentChildren = roots;
    let currentNode: HierarchyGroupNode | undefined;

    for (let i = 0; i < ancestors.length; i++) {
      const anc = ancestors[i];
      currentNode = nodeById.get(anc.id);

      if (!currentNode) {
        currentNode = {
          ancestor: anc,
          depth: i,
          children: [],
          items: [],
          totalItemCount: 0,
        };
        nodeById.set(anc.id, currentNode);
        parentChildren.push(currentNode);
      }

      parentChildren = currentNode.children;
    }

    // Insert item in the deepest ancestor node
    currentNode!.items.push(item);
  }

  if (ungroupedNode) {
    roots.push(ungroupedNode);
  }

  // Compute totalItemCount bottom-up
  const computeTotal = (node: HierarchyGroupNode): number => {
    let total = node.items.length;
    for (const child of node.children) {
      total += computeTotal(child);
    }
    node.totalItemCount = total;
    return total;
  };
  for (const root of roots) computeTotal(root);

  return roots;
};

// ─── Flatten single-child chains ─────────────────────────────────────

/**
 * Collapse nodes that have exactly 1 child and 0 direct items.
 * This avoids showing pointless intermediate headers like
 * Epic → Feature → Story when each level only has 1 child.
 */
export const flattenSingleChildChains = (nodes: HierarchyGroupNode[]): HierarchyGroupNode[] =>
  nodes.map((node) => {
    let current = node;

    // Walk down while single-child with no direct items
    while (current.children.length === 1 && current.items.length === 0) {
      current = current.children[0];
    }

    // Recursively flatten remaining children
    return {
      ...current,
      children: flattenSingleChildChains(current.children),
    };
  });

// ─── Flatten tree → render list ──────────────────────────────────────

const getGroupKey = (node: HierarchyGroupNode): string =>
  node.ancestor?.id ?? "__ungrouped__";

/**
 * Depth-first traversal producing a flat list of render instructions
 * compatible with dnd-kit SortableContext.
 */
export const flattenTreeToRenderList = (
  nodes: HierarchyGroupNode[],
  collapsedGroups: Set<string>,
): HierarchyRenderItem[] => {
  const result: HierarchyRenderItem[] = [];

  const walk = (nodeList: HierarchyGroupNode[], depthOffset: number) => {
    for (const node of nodeList) {
      const groupKey = getGroupKey(node);
      const depth = depthOffset;

      result.push({ kind: "group-header", node, groupKey, depth });

      if (!collapsedGroups.has(groupKey)) {
        // Render child groups first, then direct items
        walk(node.children, depth + 1);
        for (const item of node.items) {
          result.push({ kind: "work-item", item });
        }
      }
    }
  };

  walk(nodes, 0);
  return result;
};

// ─── Collect all group keys ──────────────────────────────────────────

/**
 * Gather every possible group key from items' ancestors so the
 * "collapse all / expand all" toggle knows about all groups.
 */
// ─── Filter to topmost items (grouped board view) ────────────────────

/**
 * Filter board columns to show only "topmost" items — items whose parent
 * is NOT present in the same board.  Items without a parentId (standalone)
 * are always shown.  Items with a parentId whose parent IS in the board
 * are hidden (they are only visible in the parent detail panel).
 *
 * When a search term is active and child items match, their topmost parent
 * is still shown so the user sees the relevant group.
 */
export const filterToTopmostItems = <T extends { column: { id: string }; items: WorkItemWithContext[]; count: number }>(
  columns: T[],
): T[] => {
  // Build a set of ALL item IDs across all columns
  const allItemIds = new Set<string>();
  for (const col of columns) {
    for (const item of col.items) {
      allItemIds.add(item.id);
    }
  }

  return columns.map((col) => {
    const filteredItems = col.items.filter((item) => {
      // No parent → always show (standalone item)
      if (!item.parentId) return true;
      // Parent is NOT in the board → show (parent lives in a different board)
      if (!allItemIds.has(item.parentId)) return true;
      // Parent IS in the board → hide (visible via parent detail panel)
      return false;
    });

    return {
      ...col,
      items: filteredItems,
      count: filteredItems.length,
    } as T;
  });
};

export const collectAllGroupKeysFromItems = (items: WorkItemWithContext[]): Set<string> => {
  const keys = new Set<string>();
  let hasUngrouped = false;

  for (const item of items) {
    if (item.ancestors && item.ancestors.length > 0) {
      for (const anc of item.ancestors) {
        keys.add(anc.id);
      }
    } else {
      hasUngrouped = true;
    }
  }

  if (hasUngrouped) {
    keys.add("__ungrouped__");
  }

  return keys;
};

export const collectAllGroupKeysFromItemsForGroupBy = (
  items: WorkItemWithContext[],
  groupBy: Exclude<GroupByMode, "none">,
): Set<string> => {
  const keys = new Set<string>();
  let hasUngrouped = false;

  for (const item of items) {
    const anc = getAncestorForGroupBy(item, groupBy);
    if (anc) {
      keys.add(anc.id);
    } else {
      hasUngrouped = true;
    }
  }

  if (hasUngrouped) keys.add("__ungrouped__");
  return keys;
};

// ─── Topmost-node projection ─────────────────────────────────────────

/**
 * Return the highest ancestor (last in the ancestors array, i.e. the root)
 * or `null` when the item has no ancestors and is itself a root-level item.
 */
export const getTopmostAncestor = (item: WorkItemWithContext): AncestorInfo | null => {
  const ancestors = item.ancestors;
  if (!ancestors || ancestors.length === 0) return null;
  return ancestors[ancestors.length - 1];
};

/**
 * Project items onto their topmost (root) ancestor.
 *
 * For each unique root ancestor found across all items, produces a single
 * `TopmostNodeProjection` that aggregates every leaf item belonging to that
 * branch.  Items without ancestors are treated as their own topmost node
 * (using the item itself as the root ancestor info).
 *
 * This enables a compact "dev view" where the board shows one card per
 * work branch without replacing the existing board layout.
 */
export const buildTopmostNodeProjection = (
  items: WorkItemWithContext[],
): TopmostNodeProjection[] => {
  const projectionById = new Map<string, TopmostNodeProjection>();

  for (const item of items) {
    const topmost = getTopmostAncestor(item);

    // Items without ancestors represent themselves
    const rootAncestor: AncestorInfo = topmost ?? {
      id: item.id,
      title: item.title,
      type: item.type,
      taskId: item.taskId,
    };

    let projection = projectionById.get(rootAncestor.id);
    if (!projection) {
      projection = {
        rootAncestor,
        leafItems: [],
        totalCount: 0,
        completedCount: 0,
        columnDistribution: {},
      };
      projectionById.set(rootAncestor.id, projection);
    }

    projection.leafItems.push(item);
    projection.totalCount += 1;

    // Track column distribution for aggregated status
    const colId = item.boardColumnId ?? "__none__";
    projection.columnDistribution[colId] = (projection.columnDistribution[colId] ?? 0) + 1;
  }

  return Array.from(projectionById.values());
};

/**
 * Convert topmost-node projections into `HierarchyGroupNode[]` so the
 * existing collapse / flatten / render pipeline can consume them without
 * changes.  Each projection becomes a single group whose `items` are the
 * leaf items of that root branch.
 */
// ─── Smart drag & drop for grouped cards ─────────────────────────────

/**
 * Given a childrenSummary and a target column, compute which leaf IDs need to move.
 *
 * Direction is determined by comparing the target column order with the
 * virtual column order (the least-advanced column among all children):
 *
 * - **Forward** (target ahead of virtual): move children whose column order
 *   is less than the target — they "catch up". Children already at or past
 *   the target stay where they are.
 * - **Backward** (target behind virtual): move children whose column order
 *   is greater than the target — they "retreat". Children already at or
 *   behind the target stay where they are.
 *
 * Returns the array of leaf IDs to move, or empty if none need moving.
 */
export const computeChildrenToMove = (
  childrenSummary: ChildrenSummary,
  targetColumnId: string,
  columns: { id: string; order: number }[],
): string[] => {
  const columnOrderMap = new Map(columns.map(c => [c.id, c.order]));
  const targetOrder = columnOrderMap.get(targetColumnId);
  if (targetOrder === undefined) return [];

  // Determine virtual column order (min order among children's current columns)
  let virtualOrder = Infinity;
  for (const columnId of Object.keys(childrenSummary.leafIdsByColumn)) {
    const colOrder = columnOrderMap.get(columnId);
    if (colOrder !== undefined && colOrder < virtualOrder) {
      virtualOrder = colOrder;
    }
  }
  if (virtualOrder === Infinity) return [];

  const isForward = targetOrder > virtualOrder;

  const idsToMove: string[] = [];
  for (const [columnId, leafIds] of Object.entries(childrenSummary.leafIdsByColumn)) {
    const colOrder = columnOrderMap.get(columnId);
    if (colOrder === undefined) continue;

    if (isForward) {
      // Forward: advance children that are behind the target
      if (colOrder < targetOrder) {
        idsToMove.push(...leafIds);
      }
    } else {
      // Backward: retreat children that are ahead of the target
      if (colOrder > targetOrder) {
        idsToMove.push(...leafIds);
      }
    }
  }
  return idsToMove;
};

export const topmostProjectionToGroups = (
  projections: TopmostNodeProjection[],
): HierarchyGroupNode[] =>
  projections.map((p) => ({
    ancestor: p.rootAncestor,
    depth: 0,
    children: [],
    items: p.leafItems,
    totalItemCount: p.totalCount,
  }));
