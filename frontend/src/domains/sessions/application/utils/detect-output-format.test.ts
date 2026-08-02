import { describe, expect, it } from "bun:test";
import { detectOutputFormat } from "./detect-output-format";

describe("detectOutputFormat", () => {
  it("recognises the file envelope the read tool returns", () => {
    const content =
      "<path>/app/src/index.ts</path>\n<type>file</type>\n<content>\n1: export const main = () => {};\n</content>";

    expect(detectOutputFormat(content)).toEqual({ format: "file-envelope" });
  });

  it("recognises a subagent task envelope", () => {
    const content =
      '<task id="ses_066291f69ffe">\n<task_result>Encontré 46 productos.</task_result>\n</task>';

    expect(detectOutputFormat(content)).toEqual({ format: "task-envelope" });
  });

  it("recognises an HTTP response by its shape, not by its host", () => {
    const content = JSON.stringify({
      requestId: "req-1",
      provider: "http",
      statusCode: 200,
      contentType: "application/json",
      body: '{"products":[]}',
    });

    const result = detectOutputFormat(content);

    expect(result.format).toBe("http-response");
    expect(result.parsed).toMatchObject({ statusCode: 200 });
  });

  it("parses ordinary JSON and hands back the value", () => {
    const result = detectOutputFormat('{"platform":"shopify","products":46}');

    expect(result.format).toBe("json");
    expect(result.parsed).toEqual({ platform: "shopify", products: 46 });
  });

  it("falls back to text when the payload only looks like JSON", () => {
    // The real 19,837-character block: another subagent's output spliced into
    // the middle. Anything that assumed it could parse would break here.
    const corrupted = '{"productCount":20,"products":[{"title":"x","p>",}]}';

    const result = detectOutputFormat(corrupted);

    expect(result.format).toBe("text");
    expect(result.parsed).toBeUndefined();
  });

  it("refuses to parse a payload too large to be worth it", () => {
    const huge = `{"data":"${"x".repeat(600 * 1024)}"}`;

    const result = detectOutputFormat(huge);

    expect(result.format).toBe("text");
    expect(result.parsed).toBeUndefined();
  });

  it("treats plain prose as text without trying to parse it", () => {
    expect(detectOutputFormat("He inspeccionado la tienda.")).toEqual({
      format: "text",
    });
  });
});
