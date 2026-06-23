"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useMutation } from "@tanstack/react-query";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { useTranslations } from "next-intl";
import { usersApi } from "@/lib/api/client";
import { defaultLocale, locales, type Locale } from "@/i18n/config";
import type { LocaleOption } from "../../domain/types";

const LOCALE_OPTIONS: LocaleOption[] = [
  { value: "es", label: "Español", flag: "🇪🇸" },
  { value: "en", label: "English", flag: "🇬🇧" },
];

const validLocales = new Set<string>(locales);

// ---------------------------------------------------------------------------
// useSyncExternalStore plumbing for locale cookie
// ---------------------------------------------------------------------------

const readLocaleCookie = (): Locale => {
  const match = document.cookie.match(/(?:^|;\s*)locale=([^;]*)/);
  const value = match ? decodeURIComponent(match[1]) : defaultLocale;
  return validLocales.has(value) ? (value as Locale) : defaultLocale;
};

const setLocaleCookie = (locale: string) => {
  document.cookie = `locale=${locale};path=/;max-age=${365 * 24 * 60 * 60};samesite=lax`;
};

// No-op subscribe since locale only changes via explicit user action
// (which triggers window.location.reload).
const subscribeToLocale = () => () => {};
const getServerSnapshot = () => defaultLocale;

export const useLocalePreference = () => {
  const t = useTranslations("settings.language");

  // useSyncExternalStore reads the cookie on the client and returns
  // defaultLocale on the server, avoiding hydration mismatches.
  const currentLocale = useSyncExternalStore(
    subscribeToLocale,
    readLocaleCookie,
    getServerSnapshot,
  );

  const mutation = useMutation({
    mutationFn: (locale: string) => usersApi.updateLocale(locale),
    onSuccess: (_data, locale) => {
      setLocaleCookie(locale);
      showToast.success(t("updated"));
      window.location.reload();
    },
    onError: () => {
      showToast.error(t("updateError"));
    },
  });

  const handleLocaleChange = useCallback(
    (locale: string) => {
      if (locale === currentLocale) return;
      mutation.mutate(locale);
    },
    [currentLocale, mutation]
  );

  return {
    currentLocale,
    locales: LOCALE_OPTIONS,
    isUpdating: mutation.isPending,
    handleLocaleChange,
  };
};
