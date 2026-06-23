import type { DoneItemPreview } from "../../domain/types";
import type { WorkItemType } from "@/domains/work-items/domain/types";

export interface DoneItemTreeNode {
  item: DoneItemPreview;
  children: DoneItemTreeNode[];
  isVirtualParent?: boolean;
}

const TYPE_ORDER: Record<string, number> = {
  epic: 0,
  feature: 1,
  story: 2,
  task: 3,
};

const sortNodes = (nodes: DoneItemTreeNode[]) => {
  nodes.sort(
    (a, b) => (TYPE_ORDER[a.item.type] ?? 4) - (TYPE_ORDER[b.item.type] ?? 4)
  );
};

/**
 * Builds a full hierarchy tree from a flat list of done items.
 *
 * Each item may have an `ancestors` array: [directParent, grandparent, ...].
 * The algorithm reconstructs the FULL chain including virtual nodes for
 * intermediate levels not present in the done list.
 *
 * Example: If done items are Feature1 and Task1, and Task1.ancestors = [Story1, Feature1, Epic1],
 * the result is:  Epic1 (virtual) > Feature1 > Story1 (virtual) > Task1
 */
export function buildDoneItemsTree(
  items: DoneItemPreview[]
): DoneItemTreeNode[] {
  // All nodes (real + virtual), keyed by id
  const allNodes = new Map<string, DoneItemTreeNode>();
  // Parent relationship: childId -> parentId
  const childOf = new Map<string, string>();

  // 1. Create real nodes
  for (const item of items) {
    allNodes.set(item.id, { item, children: [] });
  }

  // 2. For each item, process its ancestor chain to build the full hierarchy
  for (const item of items) {
    const ancestors = item.ancestors ?? [];
    if (ancestors.length === 0) continue;

    // ancestors = [parent, grandparent, great-grandparent]
    // Reverse to get root-first order: [great-grandparent, grandparent, parent]
    const chain = [...ancestors].reverse();

    // Ensure all ancestor nodes exist and link them
    for (let i = 0; i < chain.length; i++) {
      const ancestor = chain[i];

      // Create virtual node if not already in the map (real or virtual)
      if (!allNodes.has(ancestor.id)) {
        allNodes.set(ancestor.id, {
          item: {
            id: ancestor.id,
            title: ancestor.title,
            type: ancestor.type as WorkItemType,
            priority: "low",
            assignee: null,
            finishedAt: null,
          },
          children: [],
          isVirtualParent: true,
        });
      }

      // Link ancestor to its parent in the chain (if not root of chain)
      if (i > 0) {
        const parentId = chain[i - 1].id;
        if (!childOf.has(ancestor.id)) {
          childOf.set(ancestor.id, parentId);
        }
      }
    }

    // Link item to its direct parent (last in chain)
    if (!childOf.has(item.id)) {
      childOf.set(item.id, chain[chain.length - 1].id);
    }
  }

  // 3. Wire children arrays from the childOf map
  for (const [childId, parentId] of childOf) {
    const parent = allNodes.get(parentId);
    const child = allNodes.get(childId);
    if (parent && child && !parent.children.some((c) => c.item.id === childId)) {
      parent.children.push(child);
    }
  }

  // 4. Roots = nodes not in childOf (they have no parent in the tree)
  const roots: DoneItemTreeNode[] = [];
  for (const [id, node] of allNodes) {
    if (!childOf.has(id)) {
      roots.push(node);
    }
  }

  // 5. Sort recursively by type order
  const sortRecursive = (nodes: DoneItemTreeNode[]) => {
    sortNodes(nodes);
    for (const node of nodes) {
      if (node.children.length > 0) {
        sortRecursive(node.children);
      }
    }
  };

  sortRecursive(roots);

  return roots;
}
