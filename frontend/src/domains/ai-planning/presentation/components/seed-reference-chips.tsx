import { Sprout } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SeedReferenceChipsProps } from "../../domain/types";

export const SeedReferenceChips: React.FC<SeedReferenceChipsProps> = ({
  seeds,
  annotations,
  onChipClick,
}) => {
  if (seeds.length === 0) return null;

  return (
    <div className="border-b bg-muted/20 px-2 py-2">
      <div
        className="flex items-center gap-2 overflow-x-auto snap-x snap-mandatory scrollbar-none"
        style={{
          maskImage:
            "linear-gradient(to right, transparent 0, black 12px, black calc(100% - 12px), transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to right, transparent 0, black 12px, black calc(100% - 12px), transparent 100%)",
        }}
      >
        {/* Leading seed count */}
        <div className="flex shrink-0 items-center gap-1.5 px-1 text-xs text-muted-foreground">
          <Sprout className="h-4 w-4" />
          <span>{seeds.length}</span>
        </div>

        {/* Seed chips */}
        {seeds.map((seed) => {
          const annotation = annotations[seed.id];

          return (
            <button
              key={seed.id}
              type="button"
              onClick={() => onChipClick(seed)}
              className={cn(
                "snap-start shrink-0 w-[200px] md:w-[240px] min-h-[44px]",
                "rounded-lg border bg-card px-3 py-2 text-left",
                "active:scale-[0.98] transition-all",
                "hover:border-primary/30 hover:bg-accent/50",
              )}
            >
              <p className="truncate text-sm font-medium leading-tight">
                {seed.title}
              </p>
              {annotation && (
                <p className="mt-0.5 truncate text-xs text-muted-foreground leading-tight">
                  {annotation}
                </p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
