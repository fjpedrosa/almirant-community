import { useTranslations } from "next-intl";
import { GANTT_COLORS, GANTT_TYPE_COLORS } from "../../domain/gantt-colors";
import type { GanttColorMode } from "../../domain/types";

interface GanttLegendProps {
  colorMode: GanttColorMode;
}

const TYPE_ICONS: Record<string, string> = {
  epic: "◆",
  feature: "▸",
  story: "○",
  task: "·",
};

const STATUS_ITEMS = [
  { key: "done" as const, color: GANTT_COLORS.done },
  { key: "inProgress" as const, color: GANTT_COLORS.inProgress },
  { key: "review" as const, color: GANTT_COLORS.review },
  { key: "notStarted" as const, color: GANTT_COLORS.notStarted },
] as const;

const TYPE_ITEMS = [
  { key: "epic" as const, color: GANTT_TYPE_COLORS.epic },
  { key: "feature" as const, color: GANTT_TYPE_COLORS.feature },
  { key: "story" as const, color: GANTT_TYPE_COLORS.story },
  { key: "task" as const, color: GANTT_TYPE_COLORS.task },
] as const;

export const GanttLegend: React.FC<GanttLegendProps> = ({ colorMode }) => {
  const t = useTranslations("roadmap.gantt.legend");

  const items = colorMode === "status" ? STATUS_ITEMS : TYPE_ITEMS;

  return (
    <div className="flex items-center gap-3 flex-wrap rounded-md border bg-muted/30 px-3 py-2">
      {items.map((item) => (
        <div key={item.key} className="flex items-center gap-1.5">
          {colorMode === "type" && (
            <span className="text-[10px] text-muted-foreground leading-none">
              {TYPE_ICONS[item.key]}
            </span>
          )}
          <div
            className="h-2.5 w-5 rounded-sm shrink-0"
            style={{ backgroundColor: item.color }}
          />
          <span className="text-xs text-muted-foreground font-medium">
            {t(item.key)}
          </span>
        </div>
      ))}
    </div>
  );
};
