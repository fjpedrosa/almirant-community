import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { X, Plus, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { DependencySectionProps } from "../../domain/types";

export const DependencySection: React.FC<DependencySectionProps> = ({
  workItemId,
  dependencies,
  dependents,
  isLoading,
  availableWorkItems,
  onAddDependency,
  onRemoveDependency,
  isAdding,
}) => {
  const t = useTranslations("workItems.dependencies");
  const [search, setSearch] = useState("");
  const [popoverOpen, setPopoverOpen] = useState(false);

  const existingBlockerIds = new Set(dependencies.map((d) => d.blockedByWorkItemId));

  const filteredItems = availableWorkItems.filter((item) => {
    if (item.id === workItemId) return false;
    if (existingBlockerIds.has(item.id)) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      item.title.toLowerCase().includes(q) ||
      (item.taskId && item.taskId.toLowerCase().includes(q))
    );
  });

  const handleSelect = (blockedByWorkItemId: string) => {
    onAddDependency(blockedByWorkItemId);
    setSearch("");
    setPopoverOpen(false);
  };

  if (isLoading) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end">
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 max-md:h-8 max-md:w-8"
              title={t("add")}
              aria-label={t("add")}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-2" align="end">
            <Input
              placeholder={t("searchWorkItem")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 text-sm mb-2"
              autoFocus
            />
            <div className="max-h-48 overflow-y-auto space-y-0.5">
              {isAdding && (
                <div className="flex items-center justify-center py-3">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              )}
              {!isAdding && filteredItems.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-3">
                  {t("noItems")}
                </p>
              )}
              {!isAdding &&
                filteredItems.slice(0, 20).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="w-full text-left px-2 py-1.5 rounded-sm text-sm hover:bg-accent flex items-center gap-2"
                    onClick={() => handleSelect(item.id)}
                  >
                    <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                      {item.taskId || item.type}
                    </span>
                    <span className="truncate">{item.title}</span>
                  </button>
                ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Dependencies list (blocked by) */}
      {dependencies.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            {t("blockedBy")}
          </p>
          {dependencies.map((dep) => (
            <div
              key={dep.id}
              className="flex items-center gap-2 text-sm bg-muted/50 rounded px-2 py-1 group"
            >
              <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                {dep.blockedByWorkItem.taskId || dep.blockedByWorkItem.type}
              </span>
              <span className="truncate flex-1">{dep.blockedByWorkItem.title}</span>
              <button
                type="button"
                className="touch-visible text-muted-foreground hover:text-destructive"
                onClick={() => onRemoveDependency(dep.blockedByWorkItemId)}
                title={t("removeDependency")}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Dependents list (blocks) */}
      {dependents.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            {t("blocks")}
          </p>
          {dependents.map((dep) => (
            <div
              key={dep.id}
              className="flex items-center gap-2 text-sm bg-muted/30 rounded px-2 py-1"
            >
              <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                {dep.workItem.taskId || dep.workItem.type}
              </span>
              <span className="truncate flex-1 text-muted-foreground">{dep.workItem.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
