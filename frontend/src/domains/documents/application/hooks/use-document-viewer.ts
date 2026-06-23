"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useDocument } from "./use-documents";
import type { DocumentWithCategory, DocumentViewerData } from "../../domain/types";

interface UseDocumentViewerParams {
  documentId: string;
  versionHash?: string | null;
}

export const useDocumentViewer = ({
  documentId,
  versionHash,
}: UseDocumentViewerParams): DocumentViewerData & {
  versionHash: string | null;
  handleBack: () => void;
} => {
  const router = useRouter();
  const { data, isLoading, error } = useDocument(documentId);

  const document = useMemo(() => {
    if (!data) return null;
    return data as DocumentWithCategory;
  }, [data]);

  const errorMessage = useMemo(() => {
    if (error) {
      return error instanceof Error ? error.message : "Failed to load document";
    }
    return null;
  }, [error]);

  const handleBack = () => {
    router.push("/docs");
  };

  return {
    document,
    isLoading,
    error: errorMessage,
    versionHash: versionHash ?? null,
    handleBack,
  };
};
