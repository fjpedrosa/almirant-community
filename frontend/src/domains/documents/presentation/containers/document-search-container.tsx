"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDocumentSearch } from "../../application/hooks/use-document-search";
import { DocumentSearchBar } from "../components/document-search-bar";
import { DocumentSearchResults } from "../components/document-search-results";
import type { DocumentCategoryWithCount } from "../../domain/types";

interface DocumentSearchContainerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDocumentSelect?: (documentId: string) => void;
}

export const DocumentSearchContainer: React.FC<DocumentSearchContainerProps> = ({
  open,
  onOpenChange,
  onDocumentSelect,
}) => {
  const t = useTranslations("documents");
  const router = useRouter();

  const {
    searchQuery,
    filterProjectId,
    filterCategoryId,
    results,
    total,
    categories,
    projects,
    isSearching,
    handleSearchQueryChange,
    handleProjectChange,
    handleCategoryChange,
    closeSearch,
  } = useDocumentSearch();

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        closeSearch();
      }
      onOpenChange(isOpen);
    },
    [onOpenChange, closeSearch]
  );

  const handleResultClick = useCallback(
    (documentId: string) => {
      if (onDocumentSelect) {
        onDocumentSelect(documentId);
      } else {
        router.push(`/docs?docId=${documentId}`);
      }
      handleOpenChange(false);
    },
    [onDocumentSelect, router, handleOpenChange]
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-4 pt-4 pb-3 border-b">
          <DialogTitle className="text-base">
            {t("search.title")}
          </DialogTitle>
        </DialogHeader>

        <div className="px-4 py-3 border-b">
          <DocumentSearchBar
            query={searchQuery}
            onQueryChange={handleSearchQueryChange}
            projectId={filterProjectId}
            onProjectChange={handleProjectChange}
            categoryId={filterCategoryId}
            onCategoryChange={handleCategoryChange}
            projects={projects}
            categories={categories as DocumentCategoryWithCount[]}
            isSearching={isSearching}
          />
        </div>

        <div className="flex-1 overflow-hidden">
          <DocumentSearchResults
            results={results}
            searchQuery={searchQuery}
            isLoading={isSearching && searchQuery.trim().length >= 2}
            total={total}
            onResultClick={handleResultClick}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
};
