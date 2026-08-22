"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Sparkles, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WorkItemPreviewTree } from "./work-item-preview-tree";
import {
  confirmAlreadyCreatedGeneration,
  isGenerationPreviewReadOnly,
  shouldShowGenerationReviewControls,
} from "./generation-confirm-panel-actions";
import type { GenerationConfirmPanelProps } from "../../domain/types";

export const GenerationConfirmPanel: React.FC<GenerationConfirmPanelProps> = ({
  items,
  onUpdateItem,
  onRemoveItem,
  onConfirm,
  onCancel,
  isConfirming,
  itemCount,
  isAlreadyCreated,
  isPendingReview,
  planReviewError,
}) => {
  const t = useTranslations("aiPlanning");
  const [reviewEnabled, setReviewEnabled] = useState(false);

  return (
    <div className="flex flex-col rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        {isAlreadyCreated ? (
          <CheckCircle2 className="size-4 text-emerald-500" />
        ) : (
          <Sparkles className="size-4 text-primary" />
        )}
        <h3 className="text-sm font-semibold flex-1">
          {isAlreadyCreated ? t("alreadyCreatedItems") : t("generatedItems")}
        </h3>
        <span className="text-xs text-muted-foreground">
          {isAlreadyCreated
            ? t("itemsCreatedCount", { count: itemCount })
            : t("itemsReady", { count: itemCount })}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2 max-h-[400px]">
        <WorkItemPreviewTree
          items={items}
          onUpdateItem={onUpdateItem}
          onRemoveItem={onRemoveItem}
          readOnly={isGenerationPreviewReadOnly(isAlreadyCreated, isPendingReview)}
        />
      </div>

      {planReviewError && (
        <div role="alert" className="mx-4 mb-3 flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <span>{planReviewError}</span>
          {!isAlreadyCreated && !isPendingReview && (
            <Button
              type="button"
              variant="outline"
              className="shrink-0"
              onClick={() => onConfirm({ enabled: true, requestedCriticCount: 2 })}
            >
              {t("retryPlanReview")}
            </Button>
          )}
        </div>
      )}

      {shouldShowGenerationReviewControls(isAlreadyCreated, isPendingReview) && (
        <label className="flex items-start gap-2 border-t border-border px-4 py-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-primary"
            checked={reviewEnabled}
            onChange={(event) => setReviewEnabled(event.target.checked)}
            disabled={isConfirming || isPendingReview}
          />
          <span className="flex flex-col gap-0.5">
            <span className="font-medium">{t("reviewBeforeCreating")}</span>
            <span className="text-xs text-muted-foreground">{t("reviewBeforeCreatingHint")}</span>
          </span>
        </label>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
        <Button
          variant="outline"
          className="min-h-[44px] md:min-h-0 md:h-auto"
          onClick={onCancel}
          disabled={isConfirming || isPendingReview}
        >
          {isAlreadyCreated ? t("close") : t("cancel")}
        </Button>
        {!isAlreadyCreated && (
          <Button
            className="min-h-[44px] md:min-h-0 md:h-auto"
            onClick={() => onConfirm(reviewEnabled ? { enabled: true, requestedCriticCount: 2 } : undefined)}
            disabled={isConfirming || isPendingReview || itemCount === 0}
          >
            {isPendingReview ? (
              <>{t("reviewQueued")}</>
            ) : isConfirming ? (
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
          <Button className="min-h-[44px] md:min-h-0 md:h-auto" onClick={() => confirmAlreadyCreatedGeneration(onConfirm)}>
            <CheckCircle2 className="size-3.5" />
            {t("done")}
          </Button>
        )}
      </div>
    </div>
  );
};
