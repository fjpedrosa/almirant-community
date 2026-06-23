import { JsonLd } from "./json-ld";

type FaqItem = {
  question: string;
  answer: string;
};

type FaqPageJsonLdProps = {
  faqs: FaqItem[];
};

/**
 * FAQPage JSON-LD structured data component.
 * Renders schema.org FAQPage markup for rich results in search engines.
 *
 * @see https://schema.org/FAQPage
 * @see https://developers.google.com/search/docs/appearance/structured-data/faqpage
 *
 * @example
 * const faqs = [
 *   { question: "What is Almirant?", answer: "AI orchestration platform." },
 *   { question: "Is it free?", answer: "Yes, there is a free tier." },
 * ];
 * <FaqPageJsonLd faqs={faqs} />
 */
export const FaqPageJsonLd = ({ faqs }: FaqPageJsonLdProps) => {
  const faqPageData = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };

  return <JsonLd data={faqPageData} />;
};
