"use client";

import { useState, useCallback } from "react";

export const useModelDrillDown = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);

  const goToModels = useCallback((provider: string) => {
    setSelectedProvider(provider);
  }, []);

  const goBack = useCallback(() => {
    setSelectedProvider(null);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setTimeout(() => setSelectedProvider(null), 200);
  }, []);

  const toggle = useCallback(() => {
    setIsOpen((prev) => {
      if (prev) {
        setTimeout(() => setSelectedProvider(null), 200);
      }
      return !prev;
    });
  }, []);

  return {
    isOpen,
    setIsOpen,
    selectedProvider,
    goToModels,
    goBack,
    close,
    toggle,
  };
};
