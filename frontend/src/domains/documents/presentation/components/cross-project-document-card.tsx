import { Pin, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { CrossProjectDocumentCardProps } from "../../domain/types";

export const CrossProjectDocumentCard: React.FC<
  CrossProjectDocumentCardProps
> = ({ title, categoryName, categoryColor, wordCount, isPinned, onClick }) => {
  return (
    <button
      onClick={onClick}
      className="w-full text-left p-3 rounded-lg border border-border/50 hover:border-border hover:bg-accent/30 transition-colors group"
    >
      <div className="flex items-start gap-2">
        <FileText className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-medium truncate">{title}</p>
            {isPinned && (
              <Pin className="h-3 w-3 text-amber-500 shrink-0" />
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            {categoryName && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 h-4 gap-1 font-normal"
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: categoryColor || "#8b5cf6" }}
                />
                {categoryName}
              </Badge>
            )}
            {wordCount !== null && wordCount !== undefined && wordCount > 0 && (
              <span className="text-xs text-muted-foreground">
                {wordCount}w
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
};
