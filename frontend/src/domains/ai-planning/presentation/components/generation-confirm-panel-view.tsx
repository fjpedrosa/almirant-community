"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Sparkles, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { aiApi } from "@/lib/api/client";
import { WorkItemPreviewTree } from "./work-item-preview-tree";
import {
  confirmAlreadyCreatedGeneration,
  isGenerationPreviewReadOnly,
  shouldShowGenerationReviewControls,
} from "./generation-confirm-panel-actions";
import type {
  GenerationConfirmPanelProps,
  PlanReviewCapabilityOption,
  PlanReviewSelection,
} from "../../domain/types";

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
  const [capabilities, setCapabilities] = useState<PlanReviewCapabilityOption[]>([]);
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(true);
  const [capabilitiesError, setCapabilitiesError] = useState<string | null>(null);
  const [selectedConnectionRef, setSelectedConnectionRef] = useState("");
  const [selectedModel, setSelectedModel] = useState("");

  useEffect(() => {
    if (!shouldShowGenerationReviewControls(isAlreadyCreated, isPendingReview)) {
      return;
    }

    let active = true;
    void aiApi.getPlanReviewCapabilities()
      .then((nextCapabilities) => {
        if (!active) return;
        setCapabilities(nextCapabilities);
        setCapabilitiesError(null);
        setCapabilitiesLoading(false);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setCapabilitiesError(error instanceof Error ? error.message : t("planReviewCapabilitiesError"));
        setCapabilitiesLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isAlreadyCreated, isPendingReview, t]);

  const selectedCapability = capabilities.find((capability) => capability.connectionRef === selectedConnectionRef);
  const planReview: PlanReviewSelection | undefined = selectedCapability && selectedModel && selectedCapability.models.includes(selectedModel)
    ? {
        enabled: true,
        requestedCriticCount: 2,
        synthesizerConnectionRef: selectedCapability.connectionRef,
        synthesizerModel: selectedModel,
      }
    : undefined;
  const canSubmitReview = !capabilitiesLoading && !capabilitiesError && planReview !== undefined;

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
              onClick={() => planReview && onConfirm(planReview)}
              disabled={!canSubmitReview}
            >
              {t("retryPlanReview")}
            </Button>
          )}
        </div>
      )}

      {shouldShowGenerationReviewControls(isAlreadyCreated, isPendingReview) && (
        <div className="border-t border-border px-4 py-3 text-sm">
          <label className="flex items-start gap-2">
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
          {reviewEnabled && (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className="grid gap-1 text-xs font-medium" htmlFor="plan-review-synthesizer">
                {t("synthesizerConnection")}
                <select
                  id="plan-review-synthesizer"
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm font-normal"
                  value={selectedConnectionRef}
                  onChange={(event) => {
                    setSelectedConnectionRef(event.target.value);
                    setSelectedModel("");
                  }}
                  disabled={isConfirming || isPendingReview || capabilitiesLoading || !!capabilitiesError || capabilities.length === 0}
                >
                  <option value="">
                    {capabilitiesLoading ? t("planReviewCapabilitiesLoading") : t("selectSynthesizerConnection")}
                  </option>
                  {capabilities.map((capability) => (
                    <option key={capability.connectionRef} value={capability.connectionRef}>
                      {capability.name} ({capability.provider})
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-medium" htmlFor="plan-review-synthesizer-model">
                {t("synthesizerModel")}
                <select
                  id="plan-review-synthesizer-model"
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm font-normal"
                  value={selectedModel}
                  onChange={(event) => setSelectedModel(event.target.value)}
                  disabled={isConfirming || isPendingReview || capabilitiesLoading || !selectedCapability}
                >
                  <option value="">
                    {capabilitiesLoading ? t("planReviewCapabilitiesLoading") : t("selectSynthesizerModel")}
                  </option>
                  {(selectedCapability?.models ?? []).map((model) => (
                    <option key={model} value={model}>{model}</option>
                  ))}
                </select>
              </label>
              {capabilitiesError && (
                <span className="text-xs text-destructive sm:col-span-2" role="alert">{capabilitiesError}</span>
              )}
              {!capabilitiesLoading && !capabilitiesError && !canSubmitReview && (
                <span className="text-xs text-muted-foreground sm:col-span-2" role="status" aria-live="polite">
                  {capabilities.length === 0 ? t("noSynthesizerCapabilities") : t("selectSynthesizerGuidance")}
                </span>
              )}
            </div>
          )}
        </div>
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
            onClick={() => onConfirm(reviewEnabled ? planReview : undefined)}
            disabled={isConfirming || isPendingReview || itemCount === 0 || (reviewEnabled && !canSubmitReview)}
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
