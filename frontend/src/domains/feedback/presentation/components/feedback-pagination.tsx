"use client";

import { useTranslations } from "next-intl";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FeedbackPaginationProps } from "../../domain/types";

export const FeedbackPagination: React.FC<FeedbackPaginationProps> = ({
  page,
  totalPages,
  total,
  limit,
  onPageChange,
}) => {
  const t = useTranslations("feedback");

  const startItem = (page - 1) * limit + 1;
  const endItem = Math.min(page * limit, total);

  const canGoPrevious = page > 1;
  const canGoNext = page < totalPages;

  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between px-2 py-4">
      {/* Item count */}
      <p className="text-sm text-muted-foreground">
        {t("pagination.showing", { start: startItem, end: endItem, total })}
      </p>

      {/* Pagination controls */}
      <div className="flex items-center gap-1">
        {/* First page */}
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => onPageChange(1)}
          disabled={!canGoPrevious}
          aria-label="First page"
        >
          <ChevronsLeft className="h-4 w-4" />
          <span className="sr-only">{t("pagination.firstPage")}</span>
        </Button>

        {/* Previous page */}
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => onPageChange(page - 1)}
          disabled={!canGoPrevious}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="sr-only">{t("pagination.previousPage")}</span>
        </Button>

        {/* Page indicator */}
        <span className="flex items-center gap-1 px-3 text-sm">
          <span className="text-muted-foreground">{t("pagination.page")}</span>
          <span className="font-medium">{page}</span>
          <span className="text-muted-foreground">{t("pagination.of")}</span>
          <span className="font-medium">{totalPages}</span>
        </span>

        {/* Next page */}
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => onPageChange(page + 1)}
          disabled={!canGoNext}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
          <span className="sr-only">{t("pagination.nextPage")}</span>
        </Button>

        {/* Last page */}
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => onPageChange(totalPages)}
          disabled={!canGoNext}
          aria-label="Last page"
        >
          <ChevronsRight className="h-4 w-4" />
          <span className="sr-only">{t("pagination.lastPage")}</span>
        </Button>
      </div>
    </div>
  );
};
