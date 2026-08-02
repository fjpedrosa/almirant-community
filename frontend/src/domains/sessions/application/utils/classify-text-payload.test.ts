import { describe, expect, it } from "bun:test";
import { classifyTextPayload } from "./classify-text-payload";

/** Shaped like the real one: one line, 20 KB, mostly punctuation and URLs. */
const productDump = (products: number): string =>
  JSON.stringify({
    productCount: products,
    products: Array.from({ length: products }, (_, index) => ({
      handle: `prop-starter-kit-${index}`,
      title: `Prop Starter Kit ${index}`,
      vendor: "Your Reformer",
      images: [
        `https://cdn.shopify.com/s/files/1/0566/8424/9273/files/kit-${index}.jpg?v=1764803928`,
      ],
      variants: [{ price: "25.00", sku: `SKU-${index}`, available: true }],
    })),
  });

describe("classifyTextPayload", () => {
  it("classifies the raw JSON a subagent returned as data, not prose", () => {
    const content = productDump(20);
    expect(content.length).toBeGreaterThan(1_500);

    const result = classifyTextPayload(content);

    expect(result.kind).toBe("data");
    expect(result.format).toBe("json");
    expect(result.signals).toEqual({ long: true, dense: true, unwrapped: true });
  });

  it("leaves ordinary prose alone, however long", () => {
    // A long report is exactly what the transcript is for. Only the punctuation
    // density and the unwrapped line tell data apart from a wordy answer.
    const content = Array.from(
      { length: 60 },
      (_, index) =>
        `Paragraph ${index}: the store publishes a structured catalogue, so prices, SKUs and availability all come from one request.`,
    ).join("\n");
    expect(content.length).toBeGreaterThan(1_500);

    const result = classifyTextPayload(content);

    expect(result.kind).toBe("prose");
    expect(result.signals.dense).toBe(false);
    expect(result.signals.unwrapped).toBe(false);
  });

  it("leaves a short snippet inline even when it is JSON", () => {
    // Small structures read better in place than behind a disclosure triangle.
    const result = classifyTextPayload('{"platform":"shopify","products":3}');

    expect(result.kind).toBe("prose");
    expect(result.format).toBe("json");
    expect(result.signals.long).toBe(false);
  });

  it("catches an unparseable dump, because it never parses anything", () => {
    // The real 19,837-character block is not valid JSON: a `"p>"` from another
    // subagent's stream leaked into it. It still must not be rendered as prose.
    const corrupted = `${productDump(20).slice(0, 9_000)}","p>",${productDump(5).slice(1)}`;

    const result = classifyTextPayload(corrupted);

    expect(result.kind).toBe("data");
  });

  it("treats a wide single line as data even without JSON delimiters", () => {
    const csv = `${"value,".repeat(400)}end`;

    const result = classifyTextPayload(csv);

    expect(result.kind).toBe("data");
    expect(result.format).toBe("text");
  });

  it("reports size and line count for the collapsed summary", () => {
    const result = classifyTextPayload("línea uno\nlínea dos");

    // Accented characters take two bytes: the header says KB, so it counts bytes.
    expect(result.byteLength).toBe(21);
    expect(result.lineCount).toBe(2);
  });
});
