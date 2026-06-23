/**
 * Generic JSON-LD component for structured data.
 * Server component - renders a script tag with JSON-LD content.
 *
 * @example
 * <JsonLd data={{ "@context": "https://schema.org", "@type": "Organization", name: "Example" }} />
 */
type JsonLdProps = {
  data: Record<string, unknown>;
};

export const JsonLd = ({ data }: JsonLdProps) => (
  <script
    type="application/ld+json"
    dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
  />
);
