import { useTranslations } from "next-intl";
import { Sparkles, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WorkItemPreviewTree } from "./work-item-preview-tree";
import type { GenerationConfirmPanelProps } from "../../domain/types";

// Usage:
// <GenerationConfirmPanel
//   items={previewItems}
//   onUpdateItem={handleUpdate}
//   onRemoveItem={handleRemove}
//   onConfirm={handleCreateAll}
//   onCancel={handleCancel}
//   isConfirming={isPending}
//   itemCount={activeItems.length}
//   isAlreadyCreated={false}
// />

export const GenerationConfirmPanel: React.FC<GenerationConfirmPanelProps> = ({
  items,
  onUpdateItem,
  onRemoveItem,
  onConfirm,
  onCancel,
  isConfirming,
  itemCount,
  isAlreadyCreated,
}) => {
  const t = useTranslations("aiPlanning");

  return (
    <div className="flex flex-col rounded-lg border border-border bg-card">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        {isAlreadyCreated ? (
          <CheckCircle2 className="size-4 text-emerald-500" />
        ) : (
          <Sparkles className="size-4 text-primary" />
        )}
        <h3 className="text-sm font-semibold flex-1">
          {isAlreadyCreated
            ? t("alreadyCreatedItems")
            : t("generatedItems")}
        </h3>
        <span className="text-xs text-muted-foreground">
          {isAlreadyCreated
            ? t("itemsCreatedCount", { count: itemCount })
            : t("itemsReady", { count: itemCount })}
        </span>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto px-2 py-2 max-h-[400px]">
        <WorkItemPreviewTree
          items={items}
          onUpdateItem={onUpdateItem}
          onRemoveItem={onRemoveItem}
          readOnly={isAlreadyCreated}
        />
      </div>

      {/* Footer actions */}
      <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
        <Button
          variant="outline"
          className="min-h-[44px] md:min-h-0 md:h-auto"
          onClick={onCancel}
          disabled={isConfirming}
        >
          {isAlreadyCreated ? t("close") : t("cancel")}
        </Button>
        {!isAlreadyCreated && (
          <Button
            className="min-h-[44px] md:min-h-0 md:h-auto"
            onClick={onConfirm}
            disabled={isConfirming || itemCount === 0}
          >
            {isConfirming ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                {t("creating")}
              </>
            ) : (
              <>
                <Sparkles className="size-3.5" />
                {t("createAll")} ({itemCount})
              </>
            )}
          </Button>
        )}
        {isAlreadyCreated && (
          <Button className="min-h-[44px] md:min-h-0 md:h-auto" onClick={onConfirm}>
            <CheckCircle2 className="size-3.5" />
            {t("done")}
          </Button>
        )}
      </div>
    </div>
  );
};
