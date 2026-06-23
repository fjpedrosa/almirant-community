import { getAbsoluteUrl, SITE_URL } from "@/lib/site-url";
import { JsonLd } from "./json-ld";

/**
 * Organization JSON-LD structured data for Almirant.
 * Renders schema.org Organization markup for search engines.
 *
 * @see https://schema.org/Organization
 */
export const OrganizationJsonLd = () => {
  const organizationData = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Almirant",
    url: SITE_URL,
    logo: getAbsoluteUrl("/logo.png"),
    description: "The Operating System for human-agent teams. Stop Managing Agents. Start Shipping Products.",
    sameAs: [
      "https://x.com/MaxAlmirant",
    ],
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer support",
      url: SITE_URL,
    },
  };

  return <JsonLd data={organizationData} />;
};
