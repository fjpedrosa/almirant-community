import { getAbsoluteUrl, SITE_URL } from "@/lib/site-url";
import { JsonLd } from "./json-ld";

/**
 * BlogPosting JSON-LD structured data for blog posts.
 * Renders schema.org BlogPosting markup for search engines.
 *
 * @see https://schema.org/BlogPosting
 * @see https://developers.google.com/search/docs/appearance/structured-data/article
 */
type ArticleJsonLdProps = {
  headline: string;
  description?: string;
  image?: string;
  datePublished?: string;
  dateModified: string;
  authorName?: string;
  url: string;
};

export const ArticleJsonLd = ({
  headline,
  description,
  image,
  datePublished,
  dateModified,
  authorName,
  url,
}: ArticleJsonLdProps) => {
  const articleData: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline,
    dateModified,
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": url,
    },
    publisher: {
      "@type": "Organization",
      name: "Almirant",
      logo: {
        "@type": "ImageObject",
        url: getAbsoluteUrl("/logo.png"),
      },
      url: SITE_URL,
    },
  };

  if (description) {
    articleData.description = description;
  }

  if (image) {
    articleData.image = [image];
  }

  if (datePublished) {
    articleData.datePublished = datePublished;
  }

  if (authorName) {
    articleData.author = {
      "@type": "Person",
      name: authorName,
    };
  }

  return <JsonLd data={articleData} />;
};
