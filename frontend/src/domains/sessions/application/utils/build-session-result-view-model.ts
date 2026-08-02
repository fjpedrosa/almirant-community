import {
  readResultProducts,
  type ResultProduct,
} from "./read-result-products";
import { summarizeResultPayload } from "./summarize-result-payload";

export type SessionResultViewModel =
  | {
      kind: "catalogue";
      summary: string;
      products: ResultProduct[];
    }
  | {
      kind: "structured";
      summary: string;
      value: unknown;
    };

/**
 * Classifies the validated result and prepares everything presentation needs.
 * The component only renders this discriminated model; it never guesses the
 * shape of an unknown payload.
 */
export const buildSessionResultViewModel = (
  payload: unknown,
): SessionResultViewModel => {
  const catalogue = readResultProducts(payload);
  if (!catalogue) {
    return {
      kind: "structured",
      summary: summarizeResultPayload(payload),
      value: payload,
    };
  }

  const summary = `${catalogue.products.length.toLocaleString("es-ES")} ${
    catalogue.products.length === 1 ? "producto" : "productos"
  }${
    catalogue.productsFound !== undefined &&
    catalogue.productsFound > catalogue.products.length
      ? ` de ${catalogue.productsFound.toLocaleString("es-ES")}`
      : ""
  }${catalogue.storeHostname ? ` · ${catalogue.storeHostname}` : ""}`;

  return {
    kind: "catalogue",
    summary,
    products: catalogue.products,
  };
};
