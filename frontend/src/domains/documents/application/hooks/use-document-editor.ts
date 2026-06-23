"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useUpdateDocument } from "./use-documents";

export const useDocumentEditor = (documentId: string | null, initialContent: string) => {
  const [content, setContent] = useState(initialContent);
  const [isDirty, setIsDirty] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const updateDocument = useUpdateDocument();

  // Reset content when document changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setContent(initialContent);
    setIsDirty(false);
  }, [initialContent, documentId]);

  const handleContentChange = useCallback((newContent: string) => {
    setContent(newContent);
    setIsDirty(true);

    // Auto-save with debounce (2 seconds)
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    if (documentId) {
      saveTimeoutRef.current = setTimeout(() => {
        updateDocument.mutate({ id: documentId, data: { content: newContent } });
        setIsDirty(false);
      }, 2000);
    }
  }, [documentId, updateDocument]);

  const handleSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    if (documentId && isDirty) {
      updateDocument.mutate({ id: documentId, data: { content } });
      setIsDirty(false);
    }
  }, [documentId, content, isDirty, updateDocument]);

  const toggleEditing = useCallback(() => {
    if (isEditing && isDirty) {
      handleSave();
    }
    setIsEditing((prev) => !prev);
  }, [isEditing, isDirty, handleSave]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  return {
    content,
    isDirty,
    isEditing,
    isSaving: updateDocument.isPending,
    handleContentChange,
    handleSave,
    toggleEditing,
  };
};
