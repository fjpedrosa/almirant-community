import { useTranslations } from "next-intl";
import { Loader2, Plus, Sprout } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SeedEnrichmentListProps } from "@/domains/ai-planning/domain/types";
import { SeedEnrichmentCard } from "./seed-enrichment-card";

const EXPANDED_THRESHOLD = 4;

export const SeedEnrichmentList: React.FC<SeedEnrichmentListProps> = ({
  seeds,
  annotations,
  onAnnotationChange,
  onSeedClick,
  onRemoveSeed,
  onAddMore,
  onStart,
  isStarting,
}) => {
  const t = useTranslations("aiPlanning");
  const defaultExpanded = seeds.length < EXPANDED_THRESHOLD;
  const canStart = !isStarting && seeds.length > 0;

  return (
    <div className="flex h-full flex-col">
      {/* Sticky header */}
      <header className="sticky top-0 z-10 border-b bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <div className="flex items-center gap-2">
            <Sprout className="size-5 text-primary" />
            <h1 className="text-base font-semibold">{t("enrichment.title")}</h1>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {seeds.length}
            </span>
          </div>
          <Button variant="ghost" size="sm" onClick={onAddMore}>
            <Plus className="mr-1 size-4" />
            {t("enrichment.addMore")}
          </Button>
        </div>
      </header>

      {/* Scrollable seed list */}
      <div className="flex-1 overflow-y-auto px-4 pb-24 md:pb-20">
        <div className="mx-auto max-w-2xl space-y-3 py-4">
          {seeds.map((seed) => (
            <SeedEnrichmentCard
              key={seed.id}
              seed={seed}
              annotation={annotations[seed.id] ?? ""}
              onAnnotationChange={onAnnotationChange}
              onSeedClick={onSeedClick}
              onRemove={onRemoveSeed}
              defaultExpanded={defaultExpanded}
            />
          ))}
        </div>
      </div>

      {/* Sticky bottom CTA */}
      <div
        className="sticky bottom-0 z-10 border-t bg-background/95 px-4 pt-3 backdrop-blur supports-[backdrop-filter]:bg-background/60"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto max-w-2xl">
          <Button
            className="h-12 w-full md:h-10"
            disabled={!canStart}
            onClick={onStart}
          >
            {isStarting ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                {t("enrichment.starting")}
              </>
            ) : (
              t("enrichment.startPlanning", { count: seeds.length })
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};
