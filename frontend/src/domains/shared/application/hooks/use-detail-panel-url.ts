"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

interface UseDetailPanelUrlReturn {
  selectedItemId: string | null;
  isOpen: boolean;
  open: (id: string) => void;
  onOpenChange: (open: boolean) => void;
}

interface UseDetailPanelUrlOptions {
  legacyParamNames?: readonly string[];
}

/**
 * Shared hook that syncs a detail-panel open/close state with a URL query
 * parameter, enabling deep-linking (e.g. from email notifications).
 *
 * @param paramName - The canonical query-string key to read/write (e.g. "todoId", "id", "leadId").
 * @param options.legacyParamNames - Optional legacy query-string keys to read and clean up.
 *
 * Behaviour:
 * - When the URL already contains `paramName`, the panel opens automatically
 *   with that item selected (deep-link mode).
 * - `open(id)` sets local state AND writes the param to the URL.
 * - `onOpenChange(false)` clears both local state and the URL param.
 * - `onOpenChange(true)` syncs the current selectedItemId into the URL.
 * - All other existing query parameters are preserved.
 * - Uses `router.replace` with `{ scroll: false }` to avoid page jumps.
 *
 * @example
 * ```ts
 * const { selectedItemId, isOpen, open, onOpenChange } = useDetailPanelUrl("todoId");
 *
 * // Open detail for an item (updates URL to ?todoId=abc)
 * open(item.id);
 *
 * // Pass to Sheet/Dialog
 * <Sheet open={isOpen} onOpenChange={onOpenChange}>...</Sheet>
 * ```
 */
export const useDetailPanelUrl = (
  paramName: string,
  options?: UseDetailPanelUrlOptions,
): UseDetailPanelUrlReturn => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const legacyParamNames = (options?.legacyParamNames ?? []).filter(
    (legacyParamName) => legacyParamName !== paramName,
  );

  const linkedId = searchParams.get(paramName);
  const legacyLinkedId =
    legacyParamNames
      .map((legacyParamName) => searchParams.get(legacyParamName))
      .find((value): value is string => Boolean(value)) ?? null;

  const [detailOpenLocal, setDetailOpenLocal] = useState(false);
  const [manualSelectedItemId, setManualSelectedItemId] = useState<string | null>(null);

  const selectedItemId = linkedId ?? legacyLinkedId ?? manualSelectedItemId;
  const isOpen = linkedId || legacyLinkedId ? true : detailOpenLocal;

  const setParamInUrl = useCallback(
    (id: string | null) => {
      const params = new URLSearchParams(searchParams.toString());

      if (id) {
        params.set(paramName, id);
      } else {
        params.delete(paramName);
      }

      legacyParamNames.forEach((legacyParamName) => {
        params.delete(legacyParamName);
      });

      const nextQuery = params.toString();
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, {
        scroll: false,
      });
    },
    [legacyParamNames, paramName, pathname, router, searchParams],
  );

  useEffect(() => {
    if (!linkedId && legacyLinkedId) {
      setParamInUrl(legacyLinkedId);
    }
  }, [legacyLinkedId, linkedId, setParamInUrl]);

  const open = useCallback(
    (id: string) => {
      setManualSelectedItemId(id);
      setDetailOpenLocal(true);
      setParamInUrl(id);
    },
    [setParamInUrl],
  );

  const onOpenChange = useCallback(
    (nextOpen: boolean) => {
      setDetailOpenLocal(nextOpen);
      if (!nextOpen) {
        setManualSelectedItemId(null);
        setParamInUrl(null);
      } else if (selectedItemId) {
        setParamInUrl(selectedItemId);
      }
    },
    [selectedItemId, setParamInUrl],
  );

  return {
    selectedItemId,
    isOpen,
    open,
    onOpenChange,
  };
};
