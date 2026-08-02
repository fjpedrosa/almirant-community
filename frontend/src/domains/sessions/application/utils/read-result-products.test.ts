import { describe, expect, it } from "bun:test";
import { readResultProducts } from "./read-result-products";

const catalogue = {
  platform: "shopify",
  storeHostname: "yourreformer.com.au",
  productsFound: 46,
  productsExtracted: 46,
  products: [
    {
      url: "https://yourreformer.com.au/products/yr-original",
      slug: "yr-original",
      name: "YR Original",
      sku: "ORIG-MCA-01",
      price: 2995,
      currency: "AUD",
      inStock: true,
      images: ["https://cdn.shopify.com/s/files/yr-original.jpg"],
      description: "Transform your home into a studio-quality Pilates sanctuary.",
    },
  ],
};

describe("readResultProducts", () => {
  it("reads a validated catalogue into cards", () => {
    const result = readResultProducts(catalogue);

    expect(result?.storeHostname).toBe("yourreformer.com.au");
    expect(result?.productsFound).toBe(46);
    expect(result?.products[0]).toEqual({
      name: "YR Original",
      url: "https://yourreformer.com.au/products/yr-original",
      price: 2995,
      currency: "AUD",
      image: "https://cdn.shopify.com/s/files/yr-original.jpg",
      description: "Transform your home into a studio-quality Pilates sanctuary.",
      inStock: true,
    });
  });

  it("declines any payload that is not a product catalogue", () => {
    // Every agent can submit output of its own shape. Declining is the normal
    // path, and the caller falls back to the generic JSON tree.
    expect(readResultProducts({ summary: "done", counts: { fixed: 3 } })).toBeNull();
    expect(readResultProducts({ products: "many" })).toBeNull();
    expect(readResultProducts([1, 2, 3])).toBeNull();
    expect(readResultProducts(null)).toBeNull();
    expect(readResultProducts("{}")).toBeNull();
  });

  it("declines when no entry carries a name, rather than rendering blanks", () => {
    expect(
      readResultProducts({ products: [{ price: 10 }, { sku: "X" }] }),
    ).toBeNull();
  });

  it("drops a nameless entry but keeps the rest", () => {
    const result = readResultProducts({
      products: [{ price: 10 }, { name: "Reformer" }],
    });

    expect(result?.products).toHaveLength(1);
    expect(result?.products[0]?.name).toBe("Reformer");
  });

  it("omits fields it cannot trust instead of inventing them", () => {
    // Rendering `undefined` as text is how a card ends up saying "undefined AUD".
    const result = readResultProducts({
      products: [
        {
          name: "Sin datos",
          price: "2995.00",
          images: [],
          inStock: "yes",
          description: "   ",
        },
      ],
    });

    const product = result?.products[0];
    expect(product?.name).toBe("Sin datos");
    expect(product?.price).toBeUndefined();
    expect(product?.image).toBeUndefined();
    expect(product?.inStock).toBeUndefined();
    expect(product?.description).toBeUndefined();
  });
});
