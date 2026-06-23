"use client";

import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { IdeaTraceabilityPanelProps } from "../../domain/types";

export const IdeaTraceabilityPanel: React.FC<IdeaTraceabilityPanelProps> = ({
  open,
  onOpenChange,
  item,
  traceability,
  isLoading,
}) => {
  const t = useTranslations("ideas");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>{t("traceability.dialogTitle")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p className="text-sm text-muted-foreground">{t("traceability.sourceItem")}</p>
            <p className="font-medium">{item?.title ?? "-"}</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">{t("traceability.relatedFeedback")}</h3>
              {isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : (traceability?.feedbackLinks.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">{t("traceability.noFeedback")}</p>
              ) : (
                <div className="space-y-2">
                  {traceability?.feedbackLinks.map((feedback) => (
                    <div
                      key={feedback.id}
                      className="rounded-md border p-2 text-sm"
                    >
                      <p className="font-medium">{feedback.title}</p>
                      <div className="mt-1 flex items-center gap-2">
                        <Badge variant="outline">{feedback.status}</Badge>
                        <Badge variant="outline">{feedback.category}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">{t("traceability.linkedWorkItems")}</h3>
              {isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : (traceability?.workItemLinks.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">{t("traceability.noWorkItems")}</p>
              ) : (
                <div className="space-y-2">
                  {traceability?.workItemLinks.map((workItem) => (
                    <div
                      key={workItem.id}
                      className="rounded-md border p-2 text-sm"
                    >
                      <p className="font-medium">{workItem.title}</p>
                      <div className="mt-1 flex items-center gap-2">
                        <Badge variant="outline">{workItem.type}</Badge>
                        <Badge variant="outline">{workItem.priority}</Badge>
                        <Badge variant="outline">{workItem.columnName}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
