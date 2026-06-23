import { SITE_URL } from "@/lib/site-url";
import { JsonLd } from "./json-ld";

/**
 * WebSite JSON-LD structured data for Almirant.
 * Renders schema.org WebSite markup with SearchAction for sitelinks search box.
 *
 * @see https://schema.org/WebSite
 * @see https://developers.google.com/search/docs/appearance/structured-data/sitelinks-searchbox
 */
export const WebSiteJsonLd = () => {
  const websiteData = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Almirant",
    url: SITE_URL,
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${SITE_URL}/search?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };

  return <JsonLd data={websiteData} />;
};
