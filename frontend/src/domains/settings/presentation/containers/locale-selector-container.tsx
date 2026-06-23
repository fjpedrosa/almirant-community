"use client";

import { useLocalePreference } from "../../application/hooks/use-locale-preference";
import { LocaleSelector } from "../components/locale-selector";

export const LocaleSelectorContainer: React.FC = () => {
  const { currentLocale, locales, isUpdating, handleLocaleChange } =
    useLocalePreference();

  return (
    <LocaleSelector
      currentLocale={currentLocale}
      locales={locales}
      isUpdating={isUpdating}
      onLocaleChange={handleLocaleChange}
    />
  );
};
