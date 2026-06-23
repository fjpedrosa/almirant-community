"use client";

import { useCallback } from "react";
import { useUpdateWorkItem } from "../../application/hooks/use-work-items";
import { UserActionsChecklist } from "../components/user-actions-checklist";
import type { WorkItemMetadata } from "../../domain/types";

interface UserActionsChecklistContainerProps {
  itemId: string;
  metadata: WorkItemMetadata;
  userActions: string;
}

export const UserActionsChecklistContainer: React.FC<UserActionsChecklistContainerProps> = ({
  itemId,
  metadata,
  userActions,
}) => {
  const { mutate } = useUpdateWorkItem();

  const handleToggle = useCallback(
    (updatedMarkdown: string) => {
      const targetField = metadata?.deployChecklist ? "deployChecklist" : "userActions";
      mutate({
        id: itemId,
        data: {
          metadata: { ...metadata, [targetField]: updatedMarkdown },
        },
      });
    },
    [itemId, metadata, mutate]
  );

  return <UserActionsChecklist markdown={userActions} onToggle={handleToggle} />;
};
