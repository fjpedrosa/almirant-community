"use client";

import { useTranslations } from "next-intl";
import { PanelLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDocumentTree } from "../../application/hooks/use-document-tree";
import { useDocumentViewer } from "../../application/hooks/use-document-viewer";
import { useDocumentVersions } from "../../application/hooks/use-document-versions";
import { useDocumentViewerPage } from "../../application/hooks/use-document-viewer-page";
import { useDocumentImageResolver } from "../../application/hooks/use-document-image-resolver";
import { useToggleFavoriteHandler } from "../../application/hooks/use-favorite-documents";
import { DocumentTreeSidebar } from "../components/document-tree-sidebar";
import { DocumentViewer } from "../components/document-viewer";
import { DocumentVersionHistory } from "../components/document-version-history";

interface DocumentViewerContainerProps {
  documentId: string;
  versionHash?: string | null;
}

export const DocumentViewerContainer: React.FC<DocumentViewerContainerProps> = ({
  documentId,
  versionHash: versionHashProp,
}) => {
  const t = useTranslations("documents.viewer");
  const resolvedVersionHash = versionHashProp ?? null;

  // Page-level state: sidebar drawer, navigation, version URL sync
  const {
    sidebarOpen,
    handleSelectDocument,
    handleSelectVersion,
    handleToggleSidebar,
    handleSidebarOpenChange,
  } = useDocumentViewerPage({
    documentId,
    versionHash: resolvedVersionHash,
  });

  // Document tree for the sidebar
  const {
    tree,
    expandedFolders,
    isLoading: isTreeLoading,
    handleToggleFolder,
  } = useDocumentTree();

  // Document viewer data
  const { document, isLoading: isViewerLoading, error, handleBack } = useDocumentViewer({
    documentId,
    versionHash: resolvedVersionHash,
  });

  // Version history
  const {
    versions,
    isLoading: isVersionsLoading,
  } = useDocumentVersions(documentId);

  // Image resolver for relative paths in markdown
  const { components: imageComponents } = useDocumentImageResolver(
    document?.filePath,
    document?.projectId
  );

  const handleToggleFavorite = useToggleFavoriteHandler();

  // Sidebar content shared between desktop and mobile drawer
  const sidebarContent = (
    <DocumentTreeSidebar
      tree={tree}
      selectedDocumentId={documentId}
      expandedFolders={expandedFolders}
      onToggleFolder={handleToggleFolder}
      onSelectDocument={handleSelectDocument}
      onToggleFavorite={handleToggleFavorite}
      isLoading={isTreeLoading}
    />
  );

  return (
    <div className="flex h-full">
      {/* Desktop sidebar - hidden on mobile */}
      <div className="hidden md:flex w-64 border-r flex-col bg-card/30">
        <div className="p-3 border-b">
          <h2 className="text-sm font-semibold">{t("sidebarTitle")}</h2>
        </div>
        {sidebarContent}
      </div>

      {/* Mobile sidebar drawer */}
      <Sheet open={sidebarOpen} onOpenChange={handleSidebarOpenChange}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetHeader className="p-3 border-b">
            <SheetTitle className="text-sm font-semibold">
              {t("sidebarTitle")}
            </SheetTitle>
          </SheetHeader>
          {sidebarContent}
        </SheetContent>
      </Sheet>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile sidebar toggle */}
        <div className="md:hidden flex items-center px-2 py-1.5 border-b">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleToggleSidebar}
                aria-label={t("toggleSidebar")}
              >
                <PanelLeft className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("toggleSidebar")}</TooltipContent>
          </Tooltip>
        </div>

        {/* Version history bar */}
        <DocumentVersionHistory
          versions={versions}
          selectedVersionHash={resolvedVersionHash}
          onSelectVersion={handleSelectVersion}
          isLoading={isVersionsLoading}
        />

        {/* Document viewer */}
        <DocumentViewer
          title={document?.title ?? ""}
          content={document?.content ?? ""}
          updatedAt={document?.updatedAt ?? new Date()}
          categoryName={document?.categoryName ?? null}
          categoryColor={document?.categoryColor ?? null}
          projectName={document?.projectName ?? null}
          projectColor={document?.projectColor ?? null}
          wordCount={document?.wordCount ?? null}
          isLoading={isViewerLoading}
          error={error}
          onBack={handleBack}
          components={imageComponents}
        />
      </div>
    </div>
  );
};
