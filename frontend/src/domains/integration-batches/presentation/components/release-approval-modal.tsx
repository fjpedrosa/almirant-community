import { Button } from "@/components/ui/button";
import { BatchStatusBadge } from "./batch-status-badge";
import type { IntegrationBatchWithItems } from "../../domain/types";

interface Props {
  batch: IntegrationBatchWithItems;
  isPending: boolean;
  onApprove: () => void;
  onReject: () => void;
  onClose: () => void;
}

export const ReleaseApprovalModal = ({
  batch,
  isPending,
  onApprove,
  onReject,
  onClose,
}: Props) => {
  const summary = batch.items.reduce(
    (acc, item) => {
      acc[item.status] = (acc[item.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto">
        <div className="p-6 border-b">
          <h2 className="text-xl font-semibold">Release batch</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Branch: <code className="bg-muted px-1.5 py-0.5 rounded">{batch.integrationBranch}</code>
          </p>
          <div className="flex gap-3 mt-3 text-sm text-muted-foreground">
            <span>{summary.merged ?? 0} merged</span>
            <span>·</span>
            <span>{summary.skipped ?? 0} skipped</span>
            <span>·</span>
            <span>{summary.failed ?? 0} failed</span>
          </div>
        </div>

        <div className="p-6 space-y-3">
          {batch.items.map((item) => (
            <div
              key={item.id}
              className="border rounded-md p-3 flex items-start justify-between gap-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {item.prNumber !== null && (
                    <a
                      href={item.prUrl ?? "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-primary hover:underline"
                    >
                      #{item.prNumber}
                    </a>
                  )}
                  {item.branchName && (
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded truncate max-w-[300px]">
                      {item.branchName}
                    </code>
                  )}
                </div>
                {item.failureReason && (
                  <p className="text-sm text-red-600 dark:text-red-400 mt-1.5">
                    {item.failureCategory && (
                      <span className="font-mono text-xs mr-1.5">
                        [{item.failureCategory}]
                      </span>
                    )}
                    {item.failureReason}
                  </p>
                )}
              </div>
              <BatchStatusBadge status={item.status} />
            </div>
          ))}
        </div>

        <div className="p-6 border-t flex justify-between gap-2">
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Close
          </Button>
          <div className="flex gap-2">
            <Button
              variant="destructive"
              onClick={onReject}
              disabled={isPending}
            >
              Reject
            </Button>
            <Button onClick={onApprove} disabled={isPending}>
              Approve
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
