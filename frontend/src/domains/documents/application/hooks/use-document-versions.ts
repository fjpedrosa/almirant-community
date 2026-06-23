"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { documentsApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import type { DocumentVersion } from "../../domain/types";

const documentVersionKeys = {
  byDocument: (documentId: string) =>
    ["document-versions", documentId] as const,
  content: (documentId: string, contentHash: string) =>
    ["document-version-content", documentId, contentHash] as const,
};

export const useDocumentVersions = (documentId: string | null) => {
  const [selectedVersion, setSelectedVersion] =
    useState<DocumentVersion | null>(null);

  const scopedKey = useOrgScopedKey(documentVersionKeys.byDocument(documentId ?? ""));
  const contentScopedKey = useOrgScopedKey(documentVersionKeys.content(
    documentId ?? "",
    selectedVersion?.contentHash ?? ""
  ));

  const query = useQuery({
    queryKey: scopedKey,
    queryFn: () =>
      documentsApi.getVersions(documentId!) as Promise<DocumentVersion[]>,
    enabled: !!documentId,
  });

  // Fetch version content from S3 when a version is selected
  const contentQuery = useQuery({
    queryKey: contentScopedKey,
    queryFn: () =>
      documentsApi.getVersionContent(
        documentId!,
        selectedVersion!.contentHash
      ),
    enabled: !!documentId && !!selectedVersion,
    staleTime: Infinity, // Version content never changes
  });

  const handleSelectVersion = useCallback(
    (version: DocumentVersion) => {
      // If clicking the already-selected version, deselect it (back to latest)
      if (selectedVersion?.contentHash === version.contentHash) {
        setSelectedVersion(null);
      } else {
        setSelectedVersion(version);
      }
    },
    [selectedVersion]
  );

  const handleDeselectVersion = useCallback(() => {
    setSelectedVersion(null);
  }, []);

  return {
    versions: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    selectedVersion,
    selectedVersionHash: selectedVersion?.contentHash ?? null,
    versionContent: contentQuery.data?.content ?? null,
    isLoadingContent: contentQuery.isLoading && !!selectedVersion,
    handleSelectVersion,
    handleDeselectVersion,
  };
};
