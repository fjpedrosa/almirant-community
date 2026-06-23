"use client";

import { useState, useCallback } from "react";
import type { CurrencyCode } from "../../domain/types";

// Simple hook for currency display preferences
// The actual exchange rates come from the backend aggregations (amountEur field)
export const useExpenseCurrency = () => {
  const [displayCurrency, setDisplayCurrency] = useState<CurrencyCode>("EUR");

  const formatAmount = useCallback((amount: string, currency: CurrencyCode = "EUR"): string => {
    const num = parseFloat(amount);
    if (isNaN(num)) return "—";
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(num);
    } catch {
      return `${num.toFixed(2)} ${currency}`;
    }
  }, []);

  return {
    displayCurrency,
    setDisplayCurrency,
    formatAmount,
  };
};
