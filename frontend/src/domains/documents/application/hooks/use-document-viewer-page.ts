"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";

interface UseDocumentViewerPageParams {
  documentId: string;
  versionHash: string | null;
}

/**
 * Manages page-level state for the document viewer:
 * - Mobile sidebar drawer open/close
 * - Document selection navigation (deep linking via URL)
 * - Version selection URL sync (?version=hash)
 */
export const useDocumentViewerPage = ({
  documentId,
  versionHash,
}: UseDocumentViewerPageParams) => {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleSelectDocument = useCallback(
    (docId: string) => {
      router.push(`/docs/${docId}`);
      setSidebarOpen(false);
    },
    [router]
  );

  const handleSelectVersion = useCallback(
    (version: { contentHash: string }) => {
      // If already selected, deselect (go back to latest)
      if (versionHash === version.contentHash) {
        router.push(`/docs/${documentId}`);
      } else {
        router.push(`/docs/${documentId}?version=${version.contentHash}`);
      }
    },
    [router, documentId, versionHash]
  );

  const handleToggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => !prev);
  }, []);

  const handleSidebarOpenChange = useCallback((open: boolean) => {
    setSidebarOpen(open);
  }, []);

  return {
    sidebarOpen,
    handleSelectDocument,
    handleSelectVersion,
    handleToggleSidebar,
    handleSidebarOpenChange,
  };
};
