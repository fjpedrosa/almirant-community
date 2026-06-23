const LOCALE_TO_LANGUAGE: Record<string, string> = {
  es: "Spanish",
  en: "English",
  pt: "Portuguese",
  fr: "French",
  de: "German",
  it: "Italian",
};

/**
 * Map a locale code (e.g. "es", "en") to a human-readable language name.
 * Falls back to "English" for unknown locales.
 */
export const localeToLanguageName = (locale: string): string => {
  const key = locale.split("-")[0]?.toLowerCase() ?? "en";
  return LOCALE_TO_LANGUAGE[key] ?? LOCALE_TO_LANGUAGE.en!;
};
