import { ChevronDown, GitBranch } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import type { IdeaTraceabilitySectionProps } from "../../domain/types";

export const IdeaTraceabilitySection: React.FC<IdeaTraceabilitySectionProps> = ({
  feedbackLinks,
  workItemLinks,
  isLoading,
}) => {
  const t = useTranslations("ideas");
  const totalLinks = feedbackLinks.length + workItemLinks.length;
  const hasLinks = totalLinks > 0;

  return (
    <Collapsible defaultOpen={hasLinks}>
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/50 [&[data-state=open]>svg:last-child]:rotate-180">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-muted-foreground" />
          {t("traceability.title")} {totalLinks > 0 && `(${totalLinks})`}
        </div>
        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-4 px-3 pb-2 pt-1">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : !hasLinks ? (
            <p className="py-3 text-center text-sm text-muted-foreground">
              {t("traceability.noLinks")}
            </p>
          ) : (
            <>
              {feedbackLinks.length > 0 && (
                <section className="space-y-2">
                  <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {t("traceability.feedback")} ({feedbackLinks.length})
                  </h4>
                  <div className="space-y-1.5">
                    {feedbackLinks.map((link) => (
                      <div
                        key={link.id}
                        className="rounded-md border p-2 text-sm"
                      >
                        <p className="font-medium">{link.title}</p>
                        <div className="mt-1 flex items-center gap-1.5">
                          <Badge variant="outline" className="text-xs">
                            {link.status}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {link.category}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {workItemLinks.length > 0 && (
                <section className="space-y-2">
                  <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {t("traceability.workItems")} ({workItemLinks.length})
                  </h4>
                  <div className="space-y-1.5">
                    {workItemLinks.map((link) => (
                      <div
                        key={link.id}
                        className="rounded-md border p-2 text-sm"
                      >
                        <div className="flex items-center gap-2">
                          {link.taskId && (
                            <span className="font-mono text-xs text-muted-foreground">
                              {link.taskId}
                            </span>
                          )}
                          <p className="font-medium">{link.title}</p>
                        </div>
                        <div className="mt-1 flex items-center gap-1.5">
                          <Badge variant="outline" className="text-xs">
                            {link.type}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {link.priority}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {link.columnName}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};
