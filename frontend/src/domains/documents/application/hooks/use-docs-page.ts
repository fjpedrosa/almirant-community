"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { useDocuments, useDocument, useCreateDocument, useDeleteDocument, useUpdateDocument } from "./use-documents";
import { useDocumentCategories } from "./use-document-categories";
import { useMarkDocumentRead } from "./use-mark-document-read";
import { useProjects } from "@/domains/projects/application/hooks/use-projects";
import { useDocsPageFilters } from "./use-docs-page-filters";
import type {
  CreateDocumentRequest,
  DocumentWithCategory,
  ProjectOption,
} from "../../domain/types";
import type { ProjectWithRelations } from "@/domains/projects/domain/types";

export const useDocsPage = () => {
  const { filters, setProjectId, setDocId, setSearch } = useDocsPageFilters();
  const [searchQuery, setSearchQuery] = useState(filters.search);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const selectedDocId = filters.docId;
  const activeProjectFilter = filters.projectId;

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setSearchQuery((currentSearch) =>
        currentSearch === filters.search ? currentSearch : filters.search
      );
    });

    return () => cancelAnimationFrame(frame);
  }, [filters.search]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (searchQuery !== filters.search) {
        setSearch(searchQuery);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchQuery, filters.search, setSearch]);

  // Build params — category filtering is done client-side to support hierarchy
  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (filters.search) p.set("search", filters.search);
    if (activeProjectFilter) p.set("projectId", activeProjectFilter);
    p.set("limit", "100");
    return p;
  }, [filters.search, activeProjectFilter]);

  // Data queries
  const { data: documents, isLoading: isLoadingDocs } = useDocuments(params);
  const { data: selectedDocument, isLoading: isLoadingDoc } = useDocument(selectedDocId);
  const { data: categories, isLoading: isLoadingCategories } = useDocumentCategories();
  const { data: projectsData } = useProjects();

  // Map projects to ProjectOption format (only active projects)
  const projects: ProjectOption[] = useMemo(() => {
    if (!projectsData) return [];
    return (projectsData as ProjectWithRelations[])
      .filter((p) => p.status === "active")
      .map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
      }));
  }, [projectsData]);

  // Mutations
  const createDocument = useCreateDocument();
  const deleteDocument = useDeleteDocument();
  const updateDocument = useUpdateDocument();
  const markAsRead = useMarkDocumentRead();

  // Wrap setSelectedDocId to also trigger mark-as-read
  const handleSelectDocument = useCallback((docId: string | null) => {
    setDocId(docId);
    if (docId) {
      markAsRead.mutate(docId);
    }
  }, [setDocId, markAsRead]);

  const handleCreateDocument = useCallback((data: CreateDocumentRequest) => {
    createDocument.mutate(data, {
      onSuccess: (newDoc) => {
        setCreateDialogOpen(false);
        const doc = newDoc as DocumentWithCategory;
        if (doc?.id) {
          setDocId(doc.id);
        }
      },
    });
  }, [createDocument, setDocId]);

  const handleDeleteDocument = useCallback(() => {
    if (selectedDocId) {
      deleteDocument.mutate(selectedDocId, {
        onSuccess: () => {
          setDocId(null);
        },
      });
    }
  }, [selectedDocId, deleteDocument, setDocId]);

  const handleTogglePin = useCallback(() => {
    if (selectedDocId && selectedDocument) {
      updateDocument.mutate({
        id: selectedDocId,
        data: { isPinned: !selectedDocument.isPinned },
      });
    }
  }, [selectedDocId, selectedDocument, updateDocument]);

  const handleChangeProject = useCallback((projectId: string | null) => {
    if (selectedDocId) {
      updateDocument.mutate({
        id: selectedDocId,
        data: { projectId },
      });
    }
  }, [selectedDocId, updateDocument]);

  return {
    // State
    selectedDocId,
    activeProjectFilter,
    searchQuery,
    createDialogOpen,
    // Data
    documents: (documents as DocumentWithCategory[]) || [],
    selectedDocument: selectedDocument as DocumentWithCategory | undefined,
    categories: categories || [],
    projects,
    // Loading states
    isLoadingDocs,
    isLoadingDoc,
    isLoadingCategories,
    // Actions
    setSelectedDocId: handleSelectDocument,
    setActiveProjectFilter: setProjectId,
    setSearchQuery,
    setCreateDialogOpen,
    handleCreateDocument,
    handleDeleteDocument,
    handleTogglePin,
    handleChangeProject,
    isCreating: createDocument.isPending,
  };
};
