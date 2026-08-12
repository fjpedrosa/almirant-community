import type { NoteCollection, NotePageSummary, NoteTreeNode } from "./types";

const comparePages = (left: NotePageSummary, right: NotePageSummary) =>
  left.position - right.position
  || left.title.localeCompare(right.title)
  || left.id.localeCompare(right.id);

export const mergeNoteCollections = (
  pages: ReadonlyArray<NoteCollection<NotePageSummary>>,
): NotePageSummary[] => {
  const byId = new Map<string, NotePageSummary>();
  for (const page of pages) {
    for (const item of page.items) {
      if (!byId.has(item.id)) byId.set(item.id, item);
    }
  }
  return [...byId.values()];
};

export const buildNoteTree = (pages: ReadonlyArray<NotePageSummary>): NoteTreeNode[] => {
  const byId = new Map(pages.map((page) => [page.id, page]));
  const children = new Map<string | null, NotePageSummary[]>();
  for (const page of pages) {
    const parentId = page.parentId && byId.has(page.parentId) ? page.parentId : null;
    const siblings = children.get(parentId) ?? [];
    siblings.push(page);
    children.set(parentId, siblings);
  }
  for (const siblings of children.values()) siblings.sort(comparePages);

  const emitted = new Set<string>();
  const visit = (page: NotePageSummary, ancestors: Set<string>): NoteTreeNode | null => {
    if (emitted.has(page.id) || ancestors.has(page.id)) return null;
    const nextAncestors = new Set(ancestors).add(page.id);
    const nodeChildren = (children.get(page.id) ?? [])
      .map((child) => visit(child, nextAncestors))
      .filter((child): child is NoteTreeNode => child !== null);
    emitted.add(page.id);
    return { ...page, children: nodeChildren };
  };

  const result = (children.get(null) ?? [])
    .map((page) => visit(page, new Set()))
    .filter((node): node is NoteTreeNode => node !== null);
  for (const page of [...pages].sort(comparePages)) {
    if (!emitted.has(page.id)) {
      const node = visit(page, new Set());
      if (node) result.push(node);
    }
  }
  return result;
};

export const findBreadcrumbs = (
  pages: ReadonlyArray<NotePageSummary>,
  pageId: string,
): NotePageSummary[] => {
  const byId = new Map(pages.map((page) => [page.id, page]));
  const result: NotePageSummary[] = [];
  const seen = new Set<string>();
  let current = byId.get(pageId);
  while (current && !seen.has(current.id)) {
    result.unshift(current);
    seen.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return result;
};

export const breadcrumbSegments = (
  pages: ReadonlyArray<NotePageSummary>,
  pageId: string,
): Array<NotePageSummary & { isCurrent: boolean }> => {
  const breadcrumbs = findBreadcrumbs(pages, pageId);
  return breadcrumbs.map((crumb, index) => ({ ...crumb, isCurrent: index === breadcrumbs.length - 1 }));
};
