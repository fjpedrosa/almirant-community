import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";

interface GroupedCardProgressProps {
  progressPercent: number;
  doneCount: number;
  totalLeafCount: number;
  countPerColumn?: Record<string, number>;
  columnColors?: Record<string, string>;
  columnNames?: Record<string, string>;
  compact?: boolean;
}

export const GroupedCardProgress: React.FC<GroupedCardProgressProps> = ({
  progressPercent,
  doneCount,
  totalLeafCount,
  countPerColumn,
  columnColors,
  columnNames,
  compact,
}) => {
  if (totalLeafCount === 0) {
    return (
      <span className="text-xs text-muted-foreground italic">No tasks</span>
    );
  }

  if (compact) {
    return (
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <Progress value={progressPercent} className="h-1.5 flex-1 min-w-0" />
        <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
          {doneCount}/{totalLeafCount}
        </span>
      </div>
    );
  }

  const columnEntries =
    countPerColumn && columnNames
      ? Object.entries(countPerColumn)
          .filter(([, count]) => count > 0)
          .map(([columnId, count]) => ({
            columnId,
            name: columnNames[columnId] ?? columnId,
            color: columnColors?.[columnId] ?? undefined,
            count,
          }))
      : [];

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Progress value={progressPercent} className="h-1.5 w-24 shrink-0" />
        <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
          {doneCount}/{totalLeafCount}
        </span>
      </div>
      {columnEntries.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {columnEntries.map(({ columnId, name, color, count }) => (
            <span
              key={columnId}
              className={cn(
                "text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                color
                  ? "text-white"
                  : "bg-muted text-muted-foreground"
              )}
              style={
                color
                  ? { backgroundColor: color }
                  : undefined
              }
            >
              {count} {name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
