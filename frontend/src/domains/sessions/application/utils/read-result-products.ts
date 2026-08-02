/**
 * Reads a product grid out of a validated agent output, or declines.
 *
 * The transcript is the wrong source for this and measurement says so: of ten
 * product-shaped text blocks in one job, one parsed. The largest — the 19,837
 * characters that prompted the whole exercise — is not valid JSON, because eight
 * subagents write interleaved and the payload carries no part identifier to
 * reorder them by. A grid built on that is a grid that breaks at random.
 *
 * The submission is the opposite: the server validated it against the sink's
 * schema before storing it. So there is nothing to guess here — only to check
 * that the fields a card needs are actually present, and to decline cleanly when
 * they are not, so the caller can fall back to the generic JSON tree.
 */

export interface ResultProduct {
  name: string;
  url?: string;
  price?: number;
  currency?: string;
  image?: string;
  description?: string;
  inStock?: boolean;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asNonEmptyString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined;

const asFiniteNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const firstImage = (value: unknown): string | undefined =>
  Array.isArray(value) ? asNonEmptyString(value[0]) : undefined;

const toProduct = (value: unknown): ResultProduct | null => {
  const record = asRecord(value);
  if (!record) return null;
  const name = asNonEmptyString(record.name);
  // A card with no name is a card with nothing to read. One nameless entry does
  // not sink the grid; it is dropped and the rest still render.
  if (!name) return null;
  return {
    name,
    url: asNonEmptyString(record.url),
    price: asFiniteNumber(record.price),
    currency: asNonEmptyString(record.currency),
    image: firstImage(record.images),
    description: asNonEmptyString(record.description),
    inStock: typeof record.inStock === "boolean" ? record.inStock : undefined,
  };
};

export interface ResultCatalogue {
  storeHostname?: string;
  productsFound?: number;
  products: ResultProduct[];
}

/**
 * Returns null whenever a grid would be the wrong way to show this payload —
 * which is most payloads, since every agent can submit output of its own shape.
 */
export const readResultProducts = (payload: unknown): ResultCatalogue | null => {
  const record = asRecord(payload);
  if (!record || !Array.isArray(record.products)) return null;

  const products = record.products
    .map(toProduct)
    .filter((product): product is ResultProduct => product !== null);
  if (products.length === 0) return null;

  return {
    storeHostname: asNonEmptyString(record.storeHostname),
    productsFound: asFiniteNumber(record.productsFound),
    products,
  };
};
