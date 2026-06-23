import { Bookmark, Trash2, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import type { SavedViewsDropdownProps } from "../../domain/types";

export const SavedViewsDropdown: React.FC<
  SavedViewsDropdownProps & {
    newViewName: string;
    onNewViewNameChange: (name: string) => void;
    isPopoverOpen: boolean;
    onPopoverOpenChange: (open: boolean) => void;
    deletingViewId: string | null;
    onRequestDelete: (id: string) => void;
    onCancelDelete: () => void;
  }
> = ({
  views,
  isLoading,
  activeViewId,
  activeViewName,
  onSave,
  onDelete,
  onApply,
  isSaving,
  newViewName,
  onNewViewNameChange,
  isPopoverOpen,
  onPopoverOpenChange,
  deletingViewId,
  onRequestDelete,
  onCancelDelete,
}) => {
  const t = useTranslations("workItems.savedViews");
  const isActiveViewApplied = Boolean(activeViewId && activeViewName);

  return (
    <Popover open={isPopoverOpen} onOpenChange={onPopoverOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-8 text-xs gap-1.5",
            isActiveViewApplied &&
              "border-violet-500/50 bg-violet-500/10 text-violet-600 dark:text-violet-400"
          )}
        >
          <Bookmark className="h-3.5 w-3.5" />
          <span className="max-w-36 truncate">
            {activeViewName ?? t("label")}
          </span>
          {views.length > 0 && (
            <Badge
              variant="secondary"
              className="h-4 px-1 text-[10px] font-bold"
            >
              {views.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        {/* Save current view */}
        <div className="p-3 space-y-2">
          <p className="text-sm font-medium">{t("saveCurrentView")}</p>
          <div className="flex gap-1.5">
            <Input
              value={newViewName}
              onChange={(e) => onNewViewNameChange(e.target.value)}
              placeholder={t("viewNamePlaceholder")}
              className="h-7 text-xs"
              onKeyDown={(e) => {
                if (e.key === "Enter" && newViewName.trim()) {
                  onSave(newViewName.trim());
                }
              }}
            />
            <Button
              size="sm"
              className="h-7 px-2 text-xs shrink-0"
              disabled={!newViewName.trim() || isSaving}
              onClick={() => onSave(newViewName.trim())}
            >
              {isSaving ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                t("save")
              )}
            </Button>
          </div>
        </div>

        {/* Saved views list */}
        {(views.length > 0 || isLoading) && (
          <>
            <Separator />
            <div className="py-1">
              <p className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
                {t("savedViewsList")}
              </p>
              {isLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <ScrollArea className="max-h-48">
                  <div className="px-1 pb-1">
                    {views.map((view) => (
                      <div
                        key={view.id}
                        className={cn(
                          "flex items-center gap-1 rounded-md px-2 py-1.5 group",
                          activeViewId === view.id
                            ? "bg-accent text-accent-foreground"
                            : "hover:bg-accent"
                        )}
                      >
                        {activeViewId === view.id ? (
                          <Check className="h-3.5 w-3.5 shrink-0 text-violet-600 dark:text-violet-400" />
                        ) : (
                          <span className="h-3.5 w-3.5 shrink-0" />
                        )}
                        <button
                          type="button"
                          className="flex-1 text-left text-sm truncate cursor-pointer"
                          onClick={() => onApply(view)}
                        >
                          {view.name}
                        </button>

                        {deletingViewId === view.id ? (
                          <div className="flex items-center gap-0.5 shrink-0">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-5 w-5 p-0 text-destructive hover:text-destructive"
                              onClick={() => onDelete(view.id)}
                            >
                              <Check className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-5 w-5 p-0 text-muted-foreground"
                              onClick={onCancelDelete}
                            >
                              <span className="text-xs">&times;</span>
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 w-5 p-0 touch-visible text-muted-foreground hover:text-destructive shrink-0"
                            onClick={() => onRequestDelete(view.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
};
