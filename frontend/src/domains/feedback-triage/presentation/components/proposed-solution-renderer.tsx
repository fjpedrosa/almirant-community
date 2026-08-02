import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type {
  ProposedSolution,
  ProposedSolutionChange,
} from "../../domain/proposed-solution";

export interface ProposedSolutionRendererProps {
  solution: ProposedSolution;
}

const confidenceConfig: Record<
  ProposedSolution["confidence"],
  { label: string; className: string }
> = {
  high: {
    label: "High confidence",
    className:
      "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800",
  },
  medium: {
    label: "Medium confidence",
    className:
      "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800",
  },
  low: {
    label: "Low confidence",
    className:
      "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800",
  },
};

const ChangeCard: React.FC<{ change: ProposedSolutionChange }> = ({
  change,
}) => {
  const hasDiff = Boolean(change.before) || Boolean(change.after);

  if (!hasDiff) {
    return (
      <div className="rounded-md border p-3">
        <div className="flex flex-col gap-1 min-w-0">
          <code className="text-xs font-mono text-foreground break-all">
            {change.file}
          </code>
          <p className="text-sm text-muted-foreground">{change.description}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border p-3">
      <Collapsible>
        <CollapsibleTrigger
          className={cn(
            "flex w-full items-start justify-between gap-2 text-left",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm",
          )}
        >
          <div className="flex flex-col gap-1 min-w-0">
            <code className="text-xs font-mono text-foreground break-all">
              {change.file}
            </code>
            <p className="text-sm text-muted-foreground">{change.description}</p>
          </div>
          <ChevronDown
            className="h-4 w-4 shrink-0 mt-0.5 transition-transform data-[state=open]:rotate-180"
            aria-hidden="true"
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3 space-y-2">
          {change.before && (
            <div className="space-y-1">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Antes
              </p>
              <pre className="text-xs overflow-x-auto rounded bg-muted p-2 whitespace-pre-wrap">
                {change.before}
              </pre>
            </div>
          )}
          {change.after && (
            <div className="space-y-1">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Después
              </p>
              <pre className="text-xs overflow-x-auto rounded bg-muted p-2 whitespace-pre-wrap">
                {change.after}
              </pre>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
};

/**
 * Structured renderer for a parsed `ProposedSolution` payload.
 * Presentational only: no hooks, props in / JSX out. The Collapsible
 * primitives manage their own open/close state internally.
 *
 * Usage:
 *   const parsed = parseSolutionProposed(attempt.solutionProposed);
 *   {parsed ? <ProposedSolutionRenderer solution={parsed} /> : <p>{raw}</p>}
 */
export const ProposedSolutionRenderer: React.FC<
  ProposedSolutionRendererProps
> = ({ solution }) => {
  const confidence = confidenceConfig[solution.confidence];

  return (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed">{solution.rootCause}</p>

      <div>
        <Badge
          variant="outline"
          className={cn("h-5 px-2 font-medium", confidence.className)}
        >
          {confidence.label}
        </Badge>
      </div>

      {solution.changes.length > 0 && (
        <div className="space-y-2">
          {solution.changes.map((change, idx) => (
            <ChangeCard key={`${change.file}-${idx}`} change={change} />
          ))}
        </div>
      )}
    </div>
  );
};
