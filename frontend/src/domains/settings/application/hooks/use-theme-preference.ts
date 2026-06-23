"use client";

import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

const emptySubscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export const useThemePreference = () => {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const mounted = useSyncExternalStore(
    emptySubscribe,
    getClientSnapshot,
    getServerSnapshot
  );

  return {
    theme: theme as "light" | "dark" | "system" | undefined,
    setTheme,
    resolvedTheme: resolvedTheme as "light" | "dark" | undefined,
    mounted,
  };
};
