import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PaginationMeta } from "@/domains/shared/domain/types";

interface SessionHistoryPaginationProps {
  meta: PaginationMeta;
  onPageChange: (page: number) => void;
}

export const SessionHistoryPagination: React.FC<
  SessionHistoryPaginationProps
> = ({ meta, onPageChange }) => {
  const { page, limit, total, totalPages } = meta;

  const startItem = (page - 1) * limit + 1;
  const endItem = Math.min(page * limit, total);

  const canGoPrevious = page > 1;
  const canGoNext = page < totalPages;

  return (
    <div className="flex items-center justify-between py-4">
      {/* Item count */}
      <p className="text-sm text-muted-foreground">
        Showing {startItem}-{endItem} of {total}
      </p>

      {/* Pagination controls */}
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          onClick={() => onPageChange(1)}
          disabled={!canGoPrevious}
          aria-label="First page"
        >
          <ChevronsLeft className="size-4" />
        </Button>

        <Button
          variant="outline"
          size="icon"
          className="size-8"
          onClick={() => onPageChange(page - 1)}
          disabled={!canGoPrevious}
          aria-label="Previous page"
        >
          <ChevronLeft className="size-4" />
        </Button>

        <span className="flex items-center gap-1 px-3 text-sm">
          <span className="text-muted-foreground">Page</span>
          <span className="font-medium">{page}</span>
          <span className="text-muted-foreground">of</span>
          <span className="font-medium">{totalPages}</span>
        </span>

        <Button
          variant="outline"
          size="icon"
          className="size-8"
          onClick={() => onPageChange(page + 1)}
          disabled={!canGoNext}
          aria-label="Next page"
        >
          <ChevronRight className="size-4" />
        </Button>

        <Button
          variant="outline"
          size="icon"
          className="size-8"
          onClick={() => onPageChange(totalPages)}
          disabled={!canGoNext}
          aria-label="Last page"
        >
          <ChevronsRight className="size-4" />
        </Button>
      </div>
    </div>
  );
};
