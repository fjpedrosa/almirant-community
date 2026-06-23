"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { useCrossProjectDocuments } from "../../application/hooks/use-cross-project-documents";
import { CrossProjectDocuments } from "../components/cross-project-documents";

export const CrossProjectDocumentsContainer: React.FC = () => {
  const router = useRouter();
  const {
    groups,
    categories,
    searchQuery,
    activeCategoryId,
    expandedGroups,
    isLoading,
    setSearchQuery,
    handleCategoryChange,
    handleToggleGroup,
  } = useCrossProjectDocuments();

  const handleDocumentClick = useCallback(
    (docId: string) => {
      // Navigate to the docs page with the document selected via query param
      router.push(`/docs?docId=${docId}`);
    },
    [router]
  );

  return (
    <CrossProjectDocuments
      groups={groups}
      isLoading={isLoading}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      categories={categories}
      activeCategoryId={activeCategoryId}
      onCategoryChange={handleCategoryChange}
      expandedGroups={expandedGroups}
      onToggleGroup={handleToggleGroup}
      onDocumentClick={handleDocumentClick}
    />
  );
};
