import { useCallback, useState } from "react";

interface UseProgressiveJsonNodeOptions {
  defaultOpen: boolean;
  totalChildren: number;
  pageSize: number;
}

export const useProgressiveJsonNode = ({
  defaultOpen,
  totalChildren,
  pageSize,
}: UseProgressiveJsonNodeOptions) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [pageState, setPageState] = useState(() => ({
    totalChildren,
    visibleCount: Math.min(pageSize, totalChildren),
  }));
  const visibleCount =
    pageState.totalChildren === totalChildren
      ? pageState.visibleCount
      : Math.min(pageSize, totalChildren);

  const toggle = useCallback(() => {
    setIsOpen((open) => !open);
  }, []);

  const revealNextPage = useCallback(() => {
    setPageState((current) => ({
      totalChildren,
      visibleCount: Math.min(
        (current.totalChildren === totalChildren
          ? current.visibleCount
          : Math.min(pageSize, totalChildren)) + pageSize,
        totalChildren,
      ),
    }));
  }, [pageSize, totalChildren]);

  const hiddenCount = Math.max(0, totalChildren - visibleCount);
  const nextPageCount = Math.min(pageSize, hiddenCount);

  return {
    isOpen,
    visibleCount,
    hiddenCount,
    nextPageCount,
    toggle,
    revealNextPage,
  };
};
