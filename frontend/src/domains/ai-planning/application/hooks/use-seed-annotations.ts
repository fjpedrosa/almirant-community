"use client";

import { useState, useCallback } from "react";

// ---------------------------------------------------------------------------
// Hook: useSeedAnnotations
// ---------------------------------------------------------------------------
// Manages ephemeral (session-only) annotations for seeds in the staging area.
// Annotations are NOT persisted in the database — they exist only for the
// current ideation session and are included in the prompt sent to the agent.
// ---------------------------------------------------------------------------

export const useSeedAnnotations = () => {
  const [annotations, setAnnotations] = useState<Record<string, string>>({});

  const handleAnnotationChange = useCallback(
    (seedId: string, annotation: string) => {
      setAnnotations((prev: Record<string, string>) => {
        if (!annotation) {
          // Remove entry when annotation is cleared
          const { [seedId]: _, ...rest } = prev;
          return rest;
        }
        return { ...prev, [seedId]: annotation };
      });
    },
    [],
  );

  const getAnnotations = useCallback(
    (): Record<string, string> => annotations,
    [annotations],
  );

  const clearAnnotations = useCallback(() => {
    setAnnotations({});
  }, []);

  return {
    annotations,
    handleAnnotationChange,
    getAnnotations,
    clearAnnotations,
  };
};
