import { useTranslations } from "next-intl";
import { ChevronRight, FileText, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { FavoriteDocumentsSectionProps } from "../../domain/types";

export const FavoriteDocumentsSection: React.FC<
  FavoriteDocumentsSectionProps
> = ({
  favorites,
  selectedDocumentId,
  isCollapsed,
  onToggleCollapsed,
  onSelectDocument,
  onRemoveFavorite,
}) => {
  const t = useTranslations("documents.favorites");

  if (favorites.length === 0) {
    return null;
  }

  return (
    <div className="border-b shrink-0">
      {/* Header */}
      <button
        type="button"
        onClick={onToggleCollapsed}
        className="w-full flex items-center gap-1.5 px-3 py-2 text-left hover:bg-accent/30 transition-colors"
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform",
            !isCollapsed && "rotate-90"
          )}
        />
        <Star className="h-3.5 w-3.5 shrink-0 text-yellow-500 fill-yellow-500" />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex-1">
          {t("title")}
        </span>
        <Badge
          variant="secondary"
          className="text-[10px] px-1.5 py-0 h-4 shrink-0"
        >
          {favorites.length}
        </Badge>
      </button>

      {/* Collapsed = header only */}
      {!isCollapsed && (
        <ScrollArea className="max-h-[200px]">
          <div className="px-2 pb-2 space-y-0.5">
            {favorites.map((doc) => {
              const isSelected = doc.id === selectedDocumentId;

              return (
                <div
                  key={doc.id}
                  className={cn(
                    "group group/fav w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md transition-colors text-left overflow-hidden",
                    isSelected
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-accent/50 text-foreground"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelectDocument(doc.id)}
                    className="flex items-center gap-1.5 min-w-0 flex-1 text-left"
                  >
                    <FileText
                      className={cn(
                        "h-3.5 w-3.5 shrink-0",
                        isSelected
                          ? "text-primary"
                          : "text-muted-foreground"
                      )}
                    />
                    <Tooltip delayDuration={500}>
                      <TooltipTrigger asChild>
                        <span className="text-sm truncate flex-1 min-w-0">
                          {doc.title}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        <p>{doc.title}</p>
                        {doc.projectName && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                            <span
                              className="w-2 h-2 rounded-full shrink-0 inline-block"
                              style={{
                                backgroundColor: doc.projectColor ?? undefined,
                              }}
                            />
                            {doc.projectName}
                          </p>
                        )}
                      </TooltipContent>
                    </Tooltip>
                  </button>
                  <button
                    type="button"
                    aria-label={t("remove")}
                    onClick={() => onRemoveFavorite(doc.id)}
                    className="shrink-0 w-5 h-5 flex items-center justify-center rounded-sm transition-all touch-visible text-yellow-500 hover:text-yellow-600"
                  >
                    <Star className="h-3.5 w-3.5" fill="currentColor" />
                  </button>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  );
};
