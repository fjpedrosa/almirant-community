"use client";

import {
  useActiveIntegrationBatches,
  useTriggerIntegrationBatch,
} from "../../application/hooks/use-integration-batches";
import { TriggerBatchButton } from "../components/trigger-batch-button";

interface Props {
  projectId: string;
  repositoryId: string;
  boardId: string;
  /** IDs of work items currently in the Validating column (in user order). */
  validatingWorkItemIds: string[];
}

export const TriggerBatchButtonContainer = ({
  projectId,
  repositoryId,
  boardId,
  validatingWorkItemIds,
}: Props) => {
  const { data: activeBatches } = useActiveIntegrationBatches(projectId);
  const triggerMutation = useTriggerIntegrationBatch();

  const hasActiveBatch = (activeBatches ?? []).some(
    (b) => b.repositoryId === repositoryId,
  );

  const handleTrigger = () => {
    if (validatingWorkItemIds.length === 0) return;
    triggerMutation.mutate({
      projectId,
      repositoryId,
      boardId,
      workItemIds: validatingWorkItemIds,
    });
  };

  return (
    <TriggerBatchButton
      validatingItemCount={validatingWorkItemIds.length}
      hasActiveBatch={hasActiveBatch}
      isLoading={triggerMutation.isPending}
      onTrigger={handleTrigger}
    />
  );
};
