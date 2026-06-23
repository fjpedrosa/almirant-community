"use client";

import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SeedsPaginationProps } from "../../domain/types";

export const SeedsPagination: React.FC<SeedsPaginationProps> = ({
  page,
  totalPages,
  total,
  limit,
  onPageChange,
}) => {
  const startItem = (page - 1) * limit + 1;
  const endItem = Math.min(page * limit, total);
  const canGoPrevious = page > 1;
  const canGoNext = page < totalPages;

  return (
    <div className="flex flex-col items-center justify-between gap-2 sm:flex-row">
      <p data-testid="pagination-summary" className="text-sm text-muted-foreground">
        Mostrando {startItem}-{endItem} de {total}
      </p>

      <div data-testid="pagination-controls" className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          disabled={!canGoPrevious}
          onClick={() => onPageChange(1)}
          aria-label="First page"
        >
          <ChevronsLeft className="h-4 w-4" />
          <span className="sr-only">Primera página</span>
        </Button>

        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          disabled={!canGoPrevious}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="sr-only">Página anterior</span>
        </Button>

        <span className="px-3 text-sm">
          Página <span className="font-medium">{page}</span> de{" "}
          <span className="font-medium">{totalPages}</span>
        </span>

        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          disabled={!canGoNext}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
          <span className="sr-only">Página siguiente</span>
        </Button>

        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          disabled={!canGoNext}
          onClick={() => onPageChange(totalPages)}
          aria-label="Last page"
        >
          <ChevronsRight className="h-4 w-4" />
          <span className="sr-only">Última página</span>
        </Button>
      </div>
    </div>
  );
};
