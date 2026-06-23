import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { locales, defaultLocale, type Locale } from "./config";

export { locales, defaultLocale, type Locale };

/**
 * Parses the Accept-Language header and returns the first supported locale,
 * or null if no supported locale is found.
 *
 * Accept-Language format: "en-US,en;q=0.9,es;q=0.8"
 * - Entries are comma-separated
 * - Each entry may have a quality value (;q=0.X), defaults to 1.0
 * - Base language is extracted before the dash: "en-US" -> "en"
 */
export const negotiateLocale = (
  acceptLanguage: string | null
): Locale | null => {
  if (!acceptLanguage) return null;

  const parsed = acceptLanguage
    .split(",")
    .map((entry) => {
      const [langTag, qualityStr] = entry.trim().split(";");
      const quality = qualityStr
        ? parseFloat(qualityStr.replace("q=", ""))
        : 1.0;
      const baseLang = langTag.trim().split("-")[0].toLowerCase();
      return { lang: baseLang, quality };
    })
    .sort((a, b) => b.quality - a.quality);

  for (const { lang } of parsed) {
    if (locales.includes(lang as Locale)) {
      return lang as Locale;
    }
  }

  return null;
};

export default getRequestConfig(async () => {
  const store = await cookies();
  const cookieLocale = store.get("locale")?.value;

  let locale: Locale;

  if (locales.includes(cookieLocale as Locale)) {
    // Priority 1: Explicit cookie
    locale = cookieLocale as Locale;
  } else {
    // Priority 2: Accept-Language header negotiation
    const headerStore = await headers();
    const acceptLanguage = headerStore.get("accept-language");
    const negotiated = negotiateLocale(acceptLanguage);
    // Priority 3: Default "en"
    locale = negotiated ?? defaultLocale;
  }

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
