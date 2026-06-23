import { Progress } from "@/components/ui/progress";

interface GroupedDetailProgressProps {
  progressPercent: number;
  doneCount: number;
  totalLeafCount: number;
  countPerColumn?: Record<string, number>;
  columnColors?: Record<string, string>;
  columnNames?: Record<string, string>;
}

export const GroupedDetailProgress: React.FC<GroupedDetailProgressProps> = ({
  progressPercent,
  doneCount,
  totalLeafCount,
  countPerColumn,
  columnColors,
  columnNames,
}) => {
  return (
    <div className="space-y-2">
      {/* Progress bar + label */}
      <div className="flex items-center gap-3">
        <Progress value={progressPercent} className="flex-1 h-2" />
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {doneCount}/{totalLeafCount} completed
        </span>
      </div>

      {/* Column distribution dots */}
      {countPerColumn && Object.keys(countPerColumn).length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          {Object.entries(countPerColumn).map(([columnId, count]) => {
            const color = columnColors?.[columnId] ?? "#888";
            const name = columnNames?.[columnId] ?? columnId;
            return (
              <div key={columnId} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: color }}
                />
                <span className="text-xs text-muted-foreground">
                  {name} ({count})
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
