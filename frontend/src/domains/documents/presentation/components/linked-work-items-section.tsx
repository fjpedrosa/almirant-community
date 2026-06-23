import { Loader2, SquareCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import type { LinkedWorkItemsSectionProps } from "../../domain/types";

export const LinkedWorkItemsSection: React.FC<LinkedWorkItemsSectionProps> = ({
  workItems,
  isLoading,
}) => {
  const t = useTranslations("documents.linkedWorkItems");

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-4 py-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground">{t("loading")}</span>
      </div>
    );
  }

  if (workItems.length === 0) return null;

  return (
    <div className="px-4 py-2 border-b bg-card/30">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">
        {t("title")}
      </p>
      <div className="space-y-1">
        {workItems.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-2 text-sm"
          >
            <SquareCheck className="h-3 w-3 text-muted-foreground shrink-0" />
            <span className="text-[10px] font-mono text-muted-foreground shrink-0">
              {item.taskId || item.type}
            </span>
            <span className="truncate flex-1 text-sm">{item.title}</span>
            {item.columnName && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0"
                style={{
                  backgroundColor: `${item.columnColor || "#6b7280"}20`,
                  color: item.columnColor || "#6b7280",
                }}
              >
                {item.columnName}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
