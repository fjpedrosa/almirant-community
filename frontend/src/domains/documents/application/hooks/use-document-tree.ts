"use client";

import { useState, useCallback, useMemo } from "react";
import { useDocuments } from "./use-documents";
import { useDocumentCategories } from "./use-document-categories";
import { useFavoriteDocumentIds } from "./use-favorite-documents";
import type {
  DocumentWithCategory,
  DocumentCategoryWithCount,
  DocumentTreeNode,
  DocumentTreeFolder,
  DocumentTreeFile,
} from "../../domain/types";

const RECENT_DAYS_THRESHOLD = 7;

/**
 * Returns true if the given date falls within the last RECENT_DAYS_THRESHOLD days.
 */
const isRecentDate = (date: Date): boolean => {
  const now = new Date();
  const threshold = new Date(now.getTime() - RECENT_DAYS_THRESHOLD * 24 * 60 * 60 * 1000);
  return new Date(date).getTime() >= threshold.getTime();
};

/**
 * Collects folder IDs that should be expanded by default:
 * - Project-level folders (depth 0, id starts with __project_) are always expanded
 * - Any folder with recentCount > 0 is expanded
 * - Other folders are collapsed
 */
const collectSmartExpandIds = (nodes: DocumentTreeNode[]): Set<string> => {
  const ids = new Set<string>();
  for (const node of nodes) {
    if (node.type === "folder") {
      const isProjectFolder = node.id.startsWith("__project_");
      if (isProjectFolder || node.recentCount > 0) {
        ids.add(node.id);
      }
      const childIds = collectSmartExpandIds(node.children);
      childIds.forEach((id) => ids.add(id));
    }
  }
  return ids;
};

/**
 * Collects ALL folder IDs in the tree (used for "expand all").
 */
const collectAllFolderIds = (nodes: DocumentTreeNode[]): Set<string> => {
  const ids = new Set<string>();
  for (const node of nodes) {
    if (node.type === "folder") {
      ids.add(node.id);
      const childIds = collectAllFolderIds(node.children);
      childIds.forEach((id) => ids.add(id));
    }
  }
  return ids;
};


/**
 * Transforms flat lists of documents and categories into a recursive N-level
 * tree structure. Categories become folders (nested by parentId), documents
 * become file leaves placed under their direct category folder.
 *
 * Categories that have no direct documents but contain non-empty children
 * are kept in the tree. Truly empty subtrees (no documents anywhere) are pruned.
 * Documents without a category go into an "Uncategorized" folder at root level.
 */
const buildDocumentTree = (
  documents: DocumentWithCategory[],
  categories: DocumentCategoryWithCount[],
  favoriteIds: Set<string> = new Set()
): DocumentTreeNode[] => {
  // 1. Index categories by ID for O(1) lookup
  const categoryById = new Map<string, DocumentCategoryWithCount>();
  for (const cat of categories) {
    categoryById.set(cat.id, cat);
  }

  // 2. Group child categories by parentId (normalize undefined → null)
  const childrenByParentId = new Map<string | null, DocumentCategoryWithCount[]>();
  for (const cat of categories) {
    const key = cat.parentId ?? null;
    const existing = childrenByParentId.get(key);
    if (existing) {
      existing.push(cat);
    } else {
      childrenByParentId.set(key, [cat]);
    }
  }

  // 3. Group documents by categoryId (normalize undefined → null)
  // Documents whose categoryId doesn't match any known category are treated as uncategorized
  const docsByCategoryId = new Map<string | null, DocumentTreeFile[]>();
  for (const doc of documents) {
    const rawKey = doc.categoryId ?? null;
    // If the document references a category that doesn't exist (orphaned), treat as uncategorized
    const key = rawKey !== null && !categoryById.has(rawKey) ? null : rawKey;
    const file: DocumentTreeFile = {
      type: "file",
      id: doc.id,
      title: doc.title,
      categoryId: doc.categoryId,
      categoryName: doc.categoryName,
      categoryColor: doc.categoryColor,
      categoryIcon: doc.categoryIcon,
      projectId: doc.projectId ?? null,
      projectName: doc.projectName,
      projectColor: doc.projectColor,
      updatedAt: doc.updatedAt,
      wordCount: doc.wordCount,
      isRecent: isRecentDate(doc.updatedAt),
      isRead: doc.isRead ?? false,
      isFavorited: favoriteIds.has(doc.id),
    };

    const existing = docsByCategoryId.get(key);
    if (existing) {
      existing.push(file);
    } else {
      docsByCategoryId.set(key, [file]);
    }
  }

  // 4. Recursive folder builder
  const buildFolder = (
    category: DocumentCategoryWithCount,
    depth: number
  ): DocumentTreeFolder | null => {
    // Build child folders from subcategories, sorted by order
    const childCategories = childrenByParentId.get(category.id) ?? [];
    const sortedChildCategories = [...childCategories].sort(
      (a, b) => a.order - b.order
    );

    const childFolders: DocumentTreeFolder[] = [];
    for (const childCat of sortedChildCategories) {
      const childFolder = buildFolder(childCat, depth + 1);
      if (childFolder) {
        childFolders.push(childFolder);
      }
    }

    // Get direct document files, sorted by updatedAt descending
    const directFiles = [...(docsByCategoryId.get(category.id) ?? [])].sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );

    // Prune: skip folders with no documents anywhere in their subtree
    const childFolderDocCount = childFolders.reduce(
      (sum, f) => sum + f.totalDocumentCount,
      0
    );
    const totalDocumentCount = directFiles.length + childFolderDocCount;

    if (totalDocumentCount === 0) {
      return null;
    }

    // Compute recentCount: direct recent files + child folder recent counts
    const directRecentCount = directFiles.filter((f) => f.isRecent).length;
    const childRecentCount = childFolders.reduce(
      (sum, f) => sum + f.recentCount,
      0
    );

    // Compute unreadCount: direct unread files + child folder unread counts
    const directUnreadCount = directFiles.filter((f) => !f.isRead).length;
    const childUnreadCount = childFolders.reduce(
      (sum, f) => sum + f.unreadCount,
      0
    );

    const folder: DocumentTreeFolder = {
      type: "folder",
      id: category.id,
      name: category.name,
      color: category.color,
      icon: category.icon,
      depth,
      totalDocumentCount,
      recentCount: directRecentCount + childRecentCount,
      unreadCount: directUnreadCount + childUnreadCount,
      children: [...childFolders, ...directFiles],
    };

    return folder;
  };

  // 5. Build root-level tree from categories with parentId === null
  const rootCategories = childrenByParentId.get(null) ?? [];
  const sortedRootCategories = [...rootCategories].sort(
    (a, b) => a.order - b.order
  );

  const tree: DocumentTreeNode[] = [];
  for (const rootCat of sortedRootCategories) {
    const folder = buildFolder(rootCat, 0);
    if (folder) {
      tree.push(folder);
    }
  }

  // 6. Add uncategorized documents as loose files at root level (no wrapper folder)
  const uncategorizedDocs = docsByCategoryId.get(null);
  if (uncategorizedDocs && uncategorizedDocs.length > 0) {
    const sortedUncategorized = [...uncategorizedDocs].sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
    tree.push(...sortedUncategorized);
  }

  return tree;
};

/**
 * Recursively increments the depth of all folder nodes by 1.
 * Used when wrapping category trees inside project-level folders.
 */
const incrementDepths = (nodes: DocumentTreeNode[]): DocumentTreeNode[] =>
  nodes.map((node) =>
    node.type === "folder"
      ? { ...node, depth: node.depth + 1, children: incrementDepths(node.children) }
      : node
  );

/**
 * Groups documents by project first, then builds the category tree inside each project folder.
 * Used when "All projects" is selected to show project-level folders at root.
 */
const buildDocumentTreeGroupedByProject = (
  documents: DocumentWithCategory[],
  categories: DocumentCategoryWithCount[],
  noProjectLabel: string,
  favoriteIds: Set<string> = new Set()
): DocumentTreeNode[] => {
  // Group documents by projectId
  const docsByProject = new Map<string | null, DocumentWithCategory[]>();
  for (const doc of documents) {
    const key = doc.projectId ?? null;
    const existing = docsByProject.get(key);
    if (existing) {
      existing.push(doc);
    } else {
      docsByProject.set(key, [doc]);
    }
  }

  const projectFolders: DocumentTreeFolder[] = [];

  for (const [projectId, projectDocs] of docsByProject.entries()) {
    if (projectId === null) continue; // Handle "no project" separately at the end

    // Build category tree for this project's documents
    const categoryTree = buildDocumentTree(projectDocs, categories, favoriteIds);
    const wrappedChildren = incrementDepths(categoryTree);

    // Get project info from the first document
    const projectName = projectDocs[0]?.projectName ?? "Unknown";
    const projectColor = projectDocs[0]?.projectColor ?? "#6366f1";

    const totalDocs = wrappedChildren.reduce(
      (sum, node) => sum + (node.type === "folder" ? node.totalDocumentCount : 1),
      0
    );

    const recentCount = wrappedChildren.reduce(
      (sum, node) => sum + (node.type === "folder" ? node.recentCount : (node.isRecent ? 1 : 0)),
      0
    );

    const unreadCount = wrappedChildren.reduce(
      (sum, node) => sum + (node.type === "folder" ? node.unreadCount : (node.isRead ? 0 : 1)),
      0
    );

    projectFolders.push({
      type: "folder",
      id: `__project_${projectId}`,
      name: projectName,
      color: projectColor,
      icon: null,
      depth: 0,
      totalDocumentCount: totalDocs,
      recentCount,
      unreadCount,
      children: wrappedChildren,
    });
  }

  // Sort project folders alphabetically
  projectFolders.sort((a, b) => a.name.localeCompare(b.name));

  // Handle documents without a project
  const noProjectDocs = docsByProject.get(null);
  if (noProjectDocs && noProjectDocs.length > 0) {
    const categoryTree = buildDocumentTree(noProjectDocs, categories, favoriteIds);
    const wrappedChildren = incrementDepths(categoryTree);

    const totalDocs = wrappedChildren.reduce(
      (sum, node) => sum + (node.type === "folder" ? node.totalDocumentCount : 1),
      0
    );

    const recentCount = wrappedChildren.reduce(
      (sum, node) => sum + (node.type === "folder" ? node.recentCount : (node.isRecent ? 1 : 0)),
      0
    );

    const unreadCount = wrappedChildren.reduce(
      (sum, node) => sum + (node.type === "folder" ? node.unreadCount : (node.isRead ? 0 : 1)),
      0
    );

    projectFolders.push({
      type: "folder",
      id: "__project_none",
      name: noProjectLabel,
      color: "#71717a",
      icon: null,
      depth: 0,
      totalDocumentCount: totalDocs,
      recentCount,
      unreadCount,
      children: wrappedChildren,
    });
  }

  return projectFolders;
};

export const useDocumentTree = (
  params?: URLSearchParams,
  activeProjectFilter?: string | null,
  noProjectLabel?: string,
) => {
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string> | null>(
    null
  );

  // Ensure the tree always fetches all available documents (high limit).
  // Without this, the default backend pagination (limit=50) would truncate
  // the document list and cause incorrect folder counts.
  const effectiveParams = useMemo(() => {
    const p = params ? new URLSearchParams(params.toString()) : new URLSearchParams();
    if (!p.has("limit")) {
      p.set("limit", "500");
    }
    return p;
  }, [params]);

  // Fetch documents, categories, and favorite IDs
  const { data: documents, isLoading: isLoadingDocs } = useDocuments(effectiveParams);
  const { data: categories, isLoading: isLoadingCategories } = useDocumentCategories();
  const { data: favoriteIds } = useFavoriteDocumentIds();

  // Build tree structure from flat documents list
  const tree = useMemo(() => {
    const docs = (documents as DocumentWithCategory[]) || [];
    const cats = (categories as DocumentCategoryWithCount[]) || [];
    const favIds = favoriteIds ?? new Set<string>();

    // When no project filter is active ("All projects"), group by project at root level
    if (!activeProjectFilter) {
      return buildDocumentTreeGroupedByProject(docs, cats, noProjectLabel ?? "No project", favIds);
    }

    // With a specific project selected, show category tree directly
    return buildDocumentTree(docs, cats, favIds);
  }, [documents, categories, activeProjectFilter, noProjectLabel, favoriteIds]);

  // Smart expand: when user hasn't interacted yet (null), use smart defaults.
  // Once user interacts (Set, even empty), respect their choice.
  const effectiveExpanded = useMemo(() => {
    if (expandedFolders !== null) return expandedFolders;
    if (tree.length === 0) return new Set<string>();
    return collectSmartExpandIds(tree);
  }, [tree, expandedFolders]);

  const handleToggleFolder = useCallback((folderId: string) => {
    setExpandedFolders((prev) => {
      // On first interaction (null), start from the smart expand state
      const base = prev !== null ? prev : collectSmartExpandIds(tree);
      const next = new Set(base);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }, [tree]);

  const handleExpandAll = useCallback(() => {
    setExpandedFolders(collectAllFolderIds(tree));
  }, [tree]);

  const handleCollapseAll = useCallback(() => {
    // Set to empty Set (not null) so smart expand does NOT re-activate
    setExpandedFolders(new Set<string>());
  }, []);

  // True when the user has explicitly collapsed all folders (empty Set, not null)
  const isAllCollapsed = useMemo(
    () => effectiveExpanded.size === 0,
    [effectiveExpanded]
  );

  const handleSelectDocument = useCallback((documentId: string) => {
    setSelectedDocumentId(documentId);
  }, []);

  return {
    tree,
    selectedDocumentId,
    expandedFolders: effectiveExpanded,
    isLoading: isLoadingDocs || isLoadingCategories,
    isAllCollapsed,
    handleToggleFolder,
    handleExpandAll,
    handleCollapseAll,
    handleSelectDocument,
  };
};
