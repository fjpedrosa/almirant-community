import type React from "react";
import { CheckCircle2, AlertCircle, Crown, Puzzle, BookOpen, SquareCheckBig, Lightbulb, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { WorkItemType } from "@/domains/work-items/domain/types";

// ---------------------------------------------------------------------------
// SessionCompletedSummary
// ---------------------------------------------------------------------------
// Presentational component showing a summary of work items created during
// a planning session. Displays item count, scrollable list of items with
// type icons, and optional navigation to the board.
//
// Usage:
// <SessionCompletedSummary
//   workItemCount={5}
//   generatedItems={[{ tempId: "1", type: "story", title: "Create login page" }]}
//   onViewItems={() => navigate("/boards/...")}
// />
// ---------------------------------------------------------------------------

const typeIcons: Record<WorkItemType, React.ElementType> = {
  epic: Crown,
  feature: Puzzle,
  story: BookOpen,
  task: SquareCheckBig,
  idea: Lightbulb,
};

const typeColors: Record<WorkItemType, string> = {
  epic: "text-purple-500",
  feature: "text-blue-500",
  story: "text-green-500",
  task: "text-slate-500",
  idea: "text-amber-500",
};

export interface SessionCompletedSummaryProps {
  /** Total number of work items created. */
  workItemCount: number;
  /** Array of generated work items with their details. */
  generatedItems: Array<{ tempId: string; type: string; title: string }>;
  /** Optional callback to navigate to the board. */
  onViewItems?: () => void;
}

export const SessionCompletedSummary: React.FC<SessionCompletedSummaryProps> = ({
  workItemCount,
  generatedItems,
  onViewItems,
}) => {
  const hasItems = workItemCount > 0;

  return (
    <div className="px-4 py-4 shrink-0 border-t border-border/40" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
      <div className="max-w-3xl mx-auto">
        <div className="rounded-2xl border border-border bg-muted/40 p-4 md:p-5">
          {/* Header with status */}
          <div className="flex items-center justify-center gap-2 mb-3">
            {hasItems ? (
              <CheckCircle2 className="size-5 text-primary shrink-0" />
            ) : (
              <AlertCircle className="size-5 text-amber-500 shrink-0" />
            )}
            <span className="text-sm font-medium text-foreground">
              Sesion completada
            </span>
          </div>

          {/* Summary text */}
          <p className="text-sm text-muted-foreground text-center mb-4">
            {hasItems ? (
              <>
                Se crearon <span className="font-semibold text-foreground">{workItemCount}</span> elemento{workItemCount !== 1 ? "s" : ""}
              </>
            ) : (
              "No se crearon elementos"
            )}
          </p>

          {/* Items list (max 5 visible, scrollable) */}
          {hasItems && generatedItems.length > 0 && (
            <div className="mb-4">
              <div
                className={cn(
                  "space-y-1.5 overflow-y-auto",
                  generatedItems.length > 5 && "max-h-[160px] pr-1"
                )}
              >
                {generatedItems.map((item) => {
                  const itemType = item.type as WorkItemType;
                  const Icon = typeIcons[itemType] ?? SquareCheckBig;
                  const colorClass = typeColors[itemType] ?? "text-muted-foreground";

                  return (
                    <div
                      key={item.tempId}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-background/50 border border-border/50"
                    >
                      <Icon className={cn("size-4 shrink-0", colorClass)} />
                      <span className="text-sm text-foreground truncate">
                        {item.title}
                      </span>
                    </div>
                  );
                })}
              </div>
              {generatedItems.length > 5 && (
                <p className="text-xs text-muted-foreground text-center mt-2">
                  Desplaza para ver mas elementos
                </p>
              )}
            </div>
          )}

          {/* View items button */}
          {hasItems && onViewItems && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={onViewItems}
                className="gap-2 min-h-[44px] md:min-h-[36px]"
              >
                <ExternalLink className="size-4" />
                Ver en el board
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
