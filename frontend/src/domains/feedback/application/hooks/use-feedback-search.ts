"use client";

import { useCallback, useRef, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";

/**
 * Hook for managing debounced search input with URL sync.
 * Separates search from dynamic filters since search needs debouncing.
 */
export const useFeedbackSearch = () => {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track if user is actively editing (to show local value vs URL value)
  const [localValue, setLocalValue] = useState<string | null>(null);

  // The displayed value: local edit takes priority, otherwise URL
  const displayValue = localValue !== null ? localValue : (searchParams.get("search") || "");

  const pushSearch = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set("search", value);
      } else {
        params.delete("search");
      }
      // Reset page when search changes
      params.delete("page");
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [searchParams, router, pathname]
  );

  const handleChange = useCallback(
    (value: string) => {
      setLocalValue(value);

      // Clear any pending debounce
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      // Debounce URL update
      debounceRef.current = setTimeout(() => {
        pushSearch(value);
        setLocalValue(null); // Reset to URL-driven
      }, 300);
    },
    [pushSearch]
  );

  const handleClear = useCallback(() => {
    // Clear any pending debounce
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    setLocalValue(null);
    pushSearch("");
  }, [pushSearch]);

  return {
    value: displayValue,
    onChange: handleChange,
    onClear: handleClear,
  };
};
