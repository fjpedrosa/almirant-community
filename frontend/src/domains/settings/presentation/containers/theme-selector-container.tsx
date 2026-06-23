"use client";

import { useThemePreference } from "../../application/hooks/use-theme-preference";
import { ThemeSelector } from "../components/theme-selector";
import type { ThemeOption } from "../../domain/types";

export const ThemeSelectorContainer: React.FC = () => {
  const { theme, setTheme, mounted } = useThemePreference();

  const handleThemeChange = (newTheme: ThemeOption) => {
    setTheme(newTheme);
  };

  return (
    <ThemeSelector
      currentTheme={theme as ThemeOption | undefined}
      mounted={mounted}
      onThemeChange={handleThemeChange}
    />
  );
};
