"use client";

import { ChevronDown, Package } from "lucide-react";
import { useEffect, useRef } from "react";
import { JsonTreeBlock } from "@/domains/shared/presentation/components/streaming-blocks";
import type { SessionResultViewModel } from "../../application/utils/build-session-result-view-model";
import type { ResultProduct } from "../../application/utils/read-result-products";
import { ProductCard } from "./product-card";

interface SessionResultPanelProps {
  viewModel: SessionResultViewModel;
  isOpen: boolean;
  visibleProducts: ResultProduct[];
  hiddenProductCount: number;
  onOpenChange: (isOpen: boolean) => void;
  onProductsEndVisibilityChange: (isVisible: boolean) => void;
}

const PRODUCT_LOAD_AHEAD_PX = 224;

/**
 * The job's validated result, shown as a result rather than as a transcript.
 *
 * The payload comes from the output submission, which the server already
 * validated against the sink's schema — unlike the transcript, where the same
 * data arrives interleaved between subagents and frequently does not even parse.
 *
 * Application provides a discriminated view model: a catalogue becomes a
 * horizontal product list, while any other validated result uses the JSON tree.
 * Heavy content is only mounted after the reader opens the panel.
 */
export const SessionResultPanel: React.FC<SessionResultPanelProps> = ({
  viewModel,
  isOpen,
  visibleProducts,
  hiddenProductCount,
  onOpenChange,
  onProductsEndVisibilityChange,
}) => {
  const carouselRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen || viewModel.kind !== "catalogue" || hiddenProductCount === 0) {
      return;
    }

    const carousel = carouselRef.current;
    const sentinel = sentinelRef.current;
    if (!carousel || !sentinel) return;

    if (typeof IntersectionObserver === "undefined") {
      // Older browsers load only in response to horizontal scrolling. This
      // keeps rendering bounded, but cannot auto-fill a non-overflowing row.
      const handleScroll = () => {
        const remainingScroll =
          carousel.scrollWidth - carousel.clientWidth - carousel.scrollLeft;
        onProductsEndVisibilityChange(
          remainingScroll <= PRODUCT_LOAD_AHEAD_PX,
        );
      };

      carousel.addEventListener("scroll", handleScroll, { passive: true });
      return () => carousel.removeEventListener("scroll", handleScroll);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const sentinelEntry = entries.find(
          (entry) => entry.target === sentinel,
        );
        if (sentinelEntry) {
          onProductsEndVisibilityChange(sentinelEntry.isIntersecting);
        }
      },
      {
        root: carousel,
        rootMargin: `0px ${PRODUCT_LOAD_AHEAD_PX}px 0px 0px`,
        threshold: 0,
      },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [
    hiddenProductCount,
    isOpen,
    onProductsEndVisibilityChange,
    viewModel.kind,
  ]);

  return (
    <section
      data-testid="session-result-panel"
      className="w-full min-w-0 max-w-full rounded-xl border border-primary/20 bg-primary/5"
    >
      <details
        className="group"
        open={isOpen}
        onToggle={(event) => onOpenChange(event.currentTarget.open)}
      >
        <summary className="flex min-w-0 cursor-pointer list-none items-center gap-2 px-3 py-2.5 marker:content-none">
          <Package className="size-4 shrink-0 text-primary" />
          <h3 className="shrink-0 text-sm font-semibold text-foreground">
            Resultado
          </h3>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {viewModel.summary}
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>

        {isOpen ? (
          <div className="min-w-0 max-w-full border-t border-primary/10 px-3 py-3">
            {viewModel.kind === "catalogue" ? (
              <>
                <div
                  ref={carouselRef}
                  data-testid="result-products-carousel"
                  role="region"
                  aria-label="Productos del resultado"
                  tabIndex={0}
                  className="flex min-w-0 max-w-full snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain pb-2 outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                >
                  {visibleProducts.map((product, index) => (
                    <div
                      key={product.url ?? `${product.name}-${index}`}
                      data-testid="result-product-item"
                      className="w-56 shrink-0 snap-start"
                    >
                      <ProductCard product={product} />
                    </div>
                  ))}
                  {hiddenProductCount > 0 ? (
                    <div
                      ref={sentinelRef}
                      data-testid="result-products-sentinel"
                      aria-hidden="true"
                      className="w-px shrink-0 self-stretch"
                    />
                  ) : null}
                </div>
                <p
                  role="status"
                  aria-live="polite"
                  className="mt-1 text-right text-[11px] text-muted-foreground"
                >
                  Mostrando {visibleProducts.length.toLocaleString("es-ES")} de{" "}
                  {viewModel.products.length.toLocaleString("es-ES")} productos
                </p>
              </>
            ) : (
              <JsonTreeBlock
                value={viewModel.value}
                defaultOpenDepth={1}
                constrainHeight={false}
              />
            )}
          </div>
        ) : null}
      </details>
    </section>
  );
};
