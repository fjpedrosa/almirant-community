import { useCallback, useMemo, useRef, useState } from "react";
import { buildSessionResultViewModel } from "../utils/build-session-result-view-model";

const PRODUCT_PAGE_SIZE = 12;

interface ResultPanelState {
  payload: unknown;
  isOpen: boolean;
  visibleProductCount: number;
}

export const useSessionResultPanel = (payload: unknown) => {
  const viewModel = useMemo(
    () => buildSessionResultViewModel(payload),
    [payload],
  );
  const [state, setState] = useState<ResultPanelState>(() => ({
    payload,
    isOpen: false,
    visibleProductCount: PRODUCT_PAGE_SIZE,
  }));
  const hasConsumedCurrentIntersection = useRef(false);
  const stateMatchesPayload = state.payload === payload;
  const isOpen = stateMatchesPayload && state.isOpen;
  const visibleProductCount = stateMatchesPayload
    ? state.visibleProductCount
    : PRODUCT_PAGE_SIZE;

  const onOpenChange = useCallback(
    (nextOpen: boolean) => {
      hasConsumedCurrentIntersection.current = false;
      setState((current) => ({
        payload,
        isOpen: nextOpen,
        visibleProductCount:
          nextOpen && current.payload === payload
            ? current.visibleProductCount
            : PRODUCT_PAGE_SIZE,
      }));
    },
    [payload],
  );

  const onRevealMoreProducts = useCallback(() => {
    if (viewModel.kind !== "catalogue") return;
    setState((current) => ({
      payload,
      isOpen: true,
      visibleProductCount: Math.min(
        (current.payload === payload
          ? current.visibleProductCount
          : PRODUCT_PAGE_SIZE) + PRODUCT_PAGE_SIZE,
        viewModel.products.length,
      ),
    }));
  }, [payload, viewModel]);

  const onProductsEndVisibilityChange = useCallback(
    (isVisible: boolean) => {
      if (!isVisible) {
        hasConsumedCurrentIntersection.current = false;
        return;
      }
      if (hasConsumedCurrentIntersection.current) return;

      hasConsumedCurrentIntersection.current = true;
      onRevealMoreProducts();
    },
    [onRevealMoreProducts],
  );

  const visibleProducts =
    viewModel.kind === "catalogue" && isOpen
      ? viewModel.products.slice(0, visibleProductCount)
      : [];
  const hiddenProductCount =
    viewModel.kind === "catalogue"
      ? viewModel.products.length - visibleProducts.length
      : 0;

  return {
    viewModel,
    isOpen,
    visibleProducts,
    hiddenProductCount,
    onOpenChange,
    onProductsEndVisibilityChange,
  };
};
