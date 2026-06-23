"use client";

import { useCallback } from "react";
import { useUpdateWorkItem } from "../../application/hooks/use-work-items";
import { AggregatedUserActionsChecklist } from "../components/aggregated-user-actions-checklist";
import type { ChildUserActions } from "../../domain/types";

interface AggregatedUserActionsChecklistContainerProps {
  entries: ChildUserActions[];
}

export const AggregatedUserActionsChecklistContainer: React.FC<AggregatedUserActionsChecklistContainerProps> = ({
  entries,
}) => {
  const { mutate } = useUpdateWorkItem();

  const handleToggle = useCallback(
    (itemId: string, updatedMarkdown: string) => {
      const entry = entries.find((e) => e.itemId === itemId);
      const targetField = entry?.isDeployChecklist ? "deployChecklist" : "userActions";
      mutate({
        id: itemId,
        data: {
          metadata: { [targetField]: updatedMarkdown },
        },
      });
    },
    [entries, mutate]
  );

  return (
    <AggregatedUserActionsChecklist entries={entries} onToggle={handleToggle} />
  );
};
