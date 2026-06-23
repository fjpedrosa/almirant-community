"use client";

import { useState } from "react";
import {
  useActiveIntegrationBatches,
  useIntegrationBatch,
  useApproveIntegrationBatch,
  useRejectIntegrationBatch,
} from "../../application/hooks/use-integration-batches";
import { ReleaseApprovalModal } from "../components/release-approval-modal";

interface Props {
  projectId: string;
  repositoryId: string;
}

export const ReleaseApprovalContainer = ({
  projectId,
  repositoryId,
}: Props) => {
  const { data: activeBatches } = useActiveIntegrationBatches(projectId);
  const releaseBatch = (activeBatches ?? []).find(
    (b) => b.repositoryId === repositoryId && b.status === "awaiting_release",
  );
  const [open, setOpen] = useState(true);

  const { data: batchWithItems } = useIntegrationBatch(
    open && releaseBatch ? releaseBatch.id : null,
  );
  const approveMutation = useApproveIntegrationBatch();
  const rejectMutation = useRejectIntegrationBatch();

  if (!releaseBatch || !batchWithItems || !open) return null;

  const isPending = approveMutation.isPending || rejectMutation.isPending;

  return (
    <ReleaseApprovalModal
      batch={batchWithItems}
      isPending={isPending}
      onApprove={() =>
        approveMutation.mutate(releaseBatch.id, {
          onSuccess: () => setOpen(false),
        })
      }
      onReject={() =>
        rejectMutation.mutate(releaseBatch.id, {
          onSuccess: () => setOpen(false),
        })
      }
      onClose={() => setOpen(false)}
    />
  );
};
