import { JsonLd } from "./json-ld";

/**
 * Breadcrumb item for JSON-LD structured data.
 * The last item in the array should NOT have a url (represents current page).
 */
type BreadcrumbItem = {
  name: string;
  url?: string;
};

type BreadcrumbJsonLdProps = {
  items: BreadcrumbItem[];
};

/**
 * BreadcrumbList JSON-LD component for structured data.
 * Server component - renders a script tag with BreadcrumbList schema.
 *
 * @example
 * <BreadcrumbJsonLd
 *   items={[
 *     { name: "Home", url: "https://www.almirant.ai" },
 *     { name: "Section", url: "https://www.almirant.ai/section" },
 *     { name: "Current Page" } // No url for current page
 *   ]}
 * />
 */
export const BreadcrumbJsonLd = ({ items }: BreadcrumbJsonLdProps) => {
  const itemListElement = items.map((item, index) => {
    const isLast = index === items.length - 1;
    const listItem: Record<string, unknown> = {
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
    };

    // Last item should NOT have "item" (URL) - it represents the current page
    if (!isLast && item.url) {
      listItem.item = item.url;
    }

    return listItem;
  });

  const data = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement,
  };

  return <JsonLd data={data} />;
};
