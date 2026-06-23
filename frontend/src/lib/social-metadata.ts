import type { Metadata } from "next";
import type { Locale } from "@/i18n/config";
import { getAbsoluteUrl } from "@/lib/site-url";

const SITE_NAME = "Almirant";
const X_HANDLE = "@MaxAlmirant";

const OPEN_GRAPH_LOCALE_BY_APP_LOCALE: Record<Locale, string> = {
  en: "en_US",
  es: "es_ES",
};

type SocialImageInput = {
  alt?: string | null;
  height?: number | null;
  url?: string | null;
  width?: number | null;
};

type SocialMetadataOptions = {
  authors?: string[];
  canonicalPath?: string;
  description?: string;
  image?: SocialImageInput | null;
  includeCanonical?: boolean;
  locale?: Locale;
  openGraphType?: "article" | "website";
  publishedTime?: string;
  title: string;
};

export const DEFAULT_SOCIAL_IMAGE = {
  url: getAbsoluteUrl("/og-image.png?v=2"),
  width: 1200,
  height: 630,
  alt: SITE_NAME,
} as const;

const resolveSocialImage = (
  image: SocialImageInput | null | undefined,
  fallbackAlt: string,
) => {
  if (!image?.url) {
    return {
      ...DEFAULT_SOCIAL_IMAGE,
      alt: fallbackAlt,
    };
  }

  return {
    url: getAbsoluteUrl(image.url),
    width: image.width ?? DEFAULT_SOCIAL_IMAGE.width,
    height: image.height ?? DEFAULT_SOCIAL_IMAGE.height,
    alt: image.alt ?? fallbackAlt,
  };
};

const getAlternateOpenGraphLocales = (locale?: Locale): string[] | undefined => {
  if (!locale) {
    return undefined;
  }

  return Object.entries(OPEN_GRAPH_LOCALE_BY_APP_LOCALE)
    .filter(([candidateLocale]) => candidateLocale !== locale)
    .map(([, openGraphLocale]) => openGraphLocale);
};

export const buildAlternates = (
  canonicalPath: string,
  languages?: Record<string, string>,
): Metadata["alternates"] => ({
  canonical: canonicalPath,
  ...(languages ? { languages } : {}),
});

export const buildSocialMetadata = ({
  authors,
  canonicalPath,
  description,
  image,
  includeCanonical = true,
  locale,
  openGraphType = "website",
  publishedTime,
  title,
}: SocialMetadataOptions): Metadata => {
  const resolvedImage = resolveSocialImage(image, title);
  const resolvedUrl = canonicalPath ? getAbsoluteUrl(canonicalPath) : undefined;

  return {
    ...(includeCanonical && canonicalPath
      ? {
          alternates: buildAlternates(canonicalPath),
        }
      : {}),
    openGraph: {
      title,
      description,
      url: resolvedUrl,
      siteName: SITE_NAME,
      type: openGraphType,
      images: [resolvedImage],
      ...(locale
        ? {
            locale: OPEN_GRAPH_LOCALE_BY_APP_LOCALE[locale],
            alternateLocale: getAlternateOpenGraphLocales(locale),
          }
        : {}),
      ...(openGraphType === "article"
        ? {
            publishedTime,
            authors,
          }
        : {}),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [resolvedImage.url],
      site: X_HANDLE,
      creator: X_HANDLE,
    },
  };
};
