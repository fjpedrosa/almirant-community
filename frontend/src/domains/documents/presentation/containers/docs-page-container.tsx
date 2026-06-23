"use client";

import { useState, useMemo, useCallback } from "react";
import { useTranslations } from "next-intl";
import { FileText, ChevronsDownUp, ChevronsUpDown, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useDocsPage } from "../../application/hooks/use-docs-page";
import { useDocumentTree } from "../../application/hooks/use-document-tree";
import { useDocumentEditor } from "../../application/hooks/use-document-editor";
import { useDocumentWorkItems } from "../../application/hooks/use-document-work-items";
import { useDocumentImageResolver } from "../../application/hooks/use-document-image-resolver";
import { useDocumentVersions } from "../../application/hooks/use-document-versions";
import {
  useToggleFavoriteHandler,
  useFavoriteDocuments,
} from "../../application/hooks/use-favorite-documents";
import { useSearchDropdown } from "../../application/hooks/use-search-dropdown";
import { DocumentSidebarFilters } from "../components/document-sidebar-filters";
import { DocumentSearchDropdown } from "../components/document-search-dropdown";
import { DocumentTreeSidebar } from "../components/document-tree-sidebar";
import { DocumentMetadataBar } from "../components/document-metadata-bar";
import { DocumentContentView } from "../components/document-content-view";
import { DocumentEditor } from "../components/document-editor";
import { DocumentVersionHistory } from "../components/document-version-history";
import { DocumentVersionBanner } from "../components/document-version-banner";
import { CreateDocumentDialog } from "../components/create-document-dialog";
import { LinkedWorkItemsSection } from "../components/linked-work-items-section";
import { FavoriteDocumentsSection } from "../components/favorite-documents-section";
import type { DocumentCategoryWithCount } from "../../domain/types";

export const DocsPageContainer: React.FC = () => {
  const t = useTranslations("documents");
  const tCommon = useTranslations("common");
  const {
    selectedDocId,
    activeProjectFilter,
    searchQuery,
    createDialogOpen,
    selectedDocument,
    categories,
    projects,
    isLoadingDocs,
    setSelectedDocId,
    setActiveProjectFilter,
    setSearchQuery,
    setCreateDialogOpen,
    handleCreateDocument,
    handleDeleteDocument,
    handleTogglePin,
    handleChangeProject,
    isCreating,
  } = useDocsPage();

  // Search dropdown for full-text search results
  const handleSearchSelect = useCallback(
    (docId: string) => {
      setSelectedDocId(docId);
    },
    [setSelectedDocId]
  );

  const {
    results: searchResults,
    total: searchTotal,
    isLoading: isSearchLoading,
    isOpen: isSearchDropdownOpen,
    shouldShowTypeToSearch,
    selectedIndex: searchSelectedIndex,
    handleKeyDown: handleSearchKeyDown,
    handleFocus: handleSearchFocus,
    handleBlur: handleSearchBlur,
    closeDropdown: closeSearchDropdown,
    listRef: searchListRef,
  } = useSearchDropdown(searchQuery, activeProjectFilter, handleSearchSelect);

  // Build params for the document tree (search + project, no category since tree IS navigation)
  const treeParams = useMemo(() => {
    const p = new URLSearchParams();
    if (searchQuery) p.set("search", searchQuery);
    if (activeProjectFilter) p.set("projectId", activeProjectFilter);
    p.set("limit", "500");
    return p;
  }, [searchQuery, activeProjectFilter]);

  const {
    tree,
    expandedFolders,
    isLoading: isTreeLoading,
    isAllCollapsed,
    handleToggleFolder,
    handleExpandAll,
    handleCollapseAll,
  } = useDocumentTree(treeParams, activeProjectFilter, t("filters.noProject"));

  const handleToggleFavorite = useToggleFavoriteHandler();
  const { data: favoriteDocuments } = useFavoriteDocuments();
  const [favoritesCollapsed, setFavoritesCollapsed] = useState(false);

  const {
    content,
    isEditing,
    handleContentChange,
    toggleEditing,
  } = useDocumentEditor(
    selectedDocId,
    selectedDocument?.content || ""
  );

  const { data: linkedWorkItems, isLoading: isLoadingLinkedWorkItems } = useDocumentWorkItems(selectedDocId);

  // Image resolver for relative paths in markdown
  const { components: imageComponents } = useDocumentImageResolver(
    selectedDocument?.filePath,
    selectedDocument?.projectId
  );

  // Document version history
  const {
    versions,
    isLoading: isLoadingVersions,
    selectedVersion,
    selectedVersionHash,
    versionContent,
    isLoadingContent: isLoadingVersionContent,
    handleSelectVersion,
    handleDeselectVersion,
  } = useDocumentVersions(selectedDocId);

  // Show version content when a historical version is selected, otherwise current content
  const displayContent = selectedVersion && versionContent !== null
    ? versionContent
    : content;

  const sidebarContent = (
    <>
      <div className="p-3 border-b shrink-0 flex items-center justify-between">
        <h2 className="text-sm font-semibold">{t("title")}</h2>
        <button
          type="button"
          onClick={isAllCollapsed ? handleExpandAll : handleCollapseAll}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title={isAllCollapsed ? t("expandAll") : t("collapseAll")}
        >
          {isAllCollapsed ? (
            <ChevronsUpDown className="h-4 w-4" />
          ) : (
            <ChevronsDownUp className="h-4 w-4" />
          )}
        </button>
      </div>

      <DocumentSidebarFilters
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onSearchKeyDown={handleSearchKeyDown}
        onSearchFocus={handleSearchFocus}
        onSearchBlur={handleSearchBlur}
        projects={projects}
        activeProjectFilter={activeProjectFilter}
        onProjectFilterChange={setActiveProjectFilter}
        searchDropdownContent={
          isSearchDropdownOpen ? (
            <DocumentSearchDropdown
              results={searchResults}
              isLoading={isSearchLoading}
              selectedIndex={searchSelectedIndex}
              total={searchTotal}
              showTypeToSearch={shouldShowTypeToSearch}
              onSelectResult={(docId) => {
                handleSearchSelect(docId);
                closeSearchDropdown();
              }}
              listRef={searchListRef}
            />
          ) : null
        }
      />

      <FavoriteDocumentsSection
        favorites={favoriteDocuments ?? []}
        selectedDocumentId={selectedDocId}
        isCollapsed={favoritesCollapsed}
        onToggleCollapsed={() => setFavoritesCollapsed((prev) => !prev)}
        onSelectDocument={setSelectedDocId}
        onRemoveFavorite={handleToggleFavorite}
      />

      <DocumentTreeSidebar
        tree={tree}
        selectedDocumentId={selectedDocId}
        expandedFolders={expandedFolders}
        onToggleFolder={handleToggleFolder}
        onSelectDocument={setSelectedDocId}
        onToggleFavorite={handleToggleFavorite}
        isLoading={isTreeLoading}
      />
    </>
  );

  return (
    <div className="flex h-full">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:w-72 md:shrink-0 border-r flex-col bg-card/30 overflow-hidden min-h-0">
        {sidebarContent}
      </aside>

      {/* Content area */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Mobile header with menu trigger */}
        <div className="flex items-center gap-3 border-b px-4 py-3 md:hidden">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Open documents menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[280px] p-0">
              <SheetTitle className="sr-only">{t("title")}</SheetTitle>
              <div className="flex flex-col h-full overflow-hidden">
                {sidebarContent}
              </div>
            </SheetContent>
          </Sheet>
          <h1 className="text-lg font-semibold">{t("title")}</h1>
        </div>

        {selectedDocument ? (
          <>
            <DocumentMetadataBar
              title={selectedDocument.title}
              categoryName={selectedDocument.categoryName}
              categoryColor={selectedDocument.categoryColor}
              categoryIcon={selectedDocument.categoryIcon}
              projectName={selectedDocument.projectName}
              projectColor={selectedDocument.projectColor}
              wordCount={selectedDocument.wordCount}
              sizeBytes={selectedDocument.sizeBytes}
              updatedAt={selectedDocument.updatedAt}
              isPinned={selectedDocument.isPinned}
              isEditing={isEditing}
              projects={projects}
              currentProjectId={selectedDocument.projectId}
              onChangeProject={handleChangeProject}
              onToggleEdit={toggleEditing}
              onTogglePin={handleTogglePin}
              onDelete={handleDeleteDocument}
            />
            <LinkedWorkItemsSection
              workItems={linkedWorkItems ?? []}
              isLoading={isLoadingLinkedWorkItems}
            />
            {!isEditing && (
              <DocumentVersionHistory
                versions={versions}
                selectedVersionHash={selectedVersionHash}
                onSelectVersion={handleSelectVersion}
                isLoading={isLoadingVersions}
              />
            )}
            {selectedVersion && !isEditing && (
              <DocumentVersionBanner
                version={selectedVersion}
                isLoadingContent={isLoadingVersionContent}
                onBackToLatest={handleDeselectVersion}
              />
            )}
            {isEditing ? (
              <DocumentEditor
                content={content}
                onChange={handleContentChange}
              />
            ) : (
              <DocumentContentView content={displayContent} components={imageComponents} />
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-3">
              <FileText className="h-12 w-12 text-muted-foreground/50 mx-auto" />
              <p className="text-muted-foreground text-sm">
                {isLoadingDocs ? tCommon("loading") : t("selectDocument")}
              </p>
            </div>
          </div>
        )}
      </div>

      <CreateDocumentDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        categories={categories as DocumentCategoryWithCount[]}
        projects={projects}
        onSubmit={handleCreateDocument}
        isPending={isCreating}
      />

    </div>
  );
};
