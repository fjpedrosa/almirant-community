import { describe, expect, it } from "bun:test";
import { projectLexicalDocument, setChecklistItemChecked, snapshotLexicalDocument, validateLexicalDocument } from "./lexical-projector";

const text = (value: string, format?: number) => ({ type: "text", text: value, ...(format === undefined ? {} : { format }) });

describe("Lexical markdown/plain projections", () => {
  it("preserves supported Lexical metadata and rejects unsupported fields", () => {
    const document = { root: {
      type: "root", version: 1, direction: "ltr", format: "", children: [{
        type: "paragraph", version: 1, indent: 2, format: "center", textFormat: 3, textStyle: "color: red;", children: [{
          type: "text", version: 1, text: "meta", format: 1, detail: 0, mode: "normal", style: "font-weight:bold",
        }, {
          type: "link", version: 1, url: "https://example.test", rel: "noreferrer", target: "_blank", title: "Example", children: [{ type: "text", text: "link" }],
        }],
      }, { type: "list", version: 1, listType: "number", tag: "ol", start: 2, children: [{ type: "listitem", value: 2, children: [{ type: "text", text: "item" }] }] }, { type: "code", version: 1, language: "ts", children: [{ type: "text", text: "const x = 1;" }] }] } };
    expect(snapshotLexicalDocument(document)).toEqual(document);
    expect(validateLexicalDocument({ root: { type: "root", children: [{ type: "paragraph", children: [], unsupported: "nope" }] } })).toEqual({ valid: false, errors: ["root.children[0].unsupported is unsupported"] });
    const cyclicMetadata: any = { root: { type: "root", children: [] } };
    cyclicMetadata.root.metadata = cyclicMetadata;
    expect(validateLexicalDocument(cyclicMetadata)).toEqual({ valid: false, errors: ["root.metadata is unsupported"] });
  });

  it("preserves official element metadata and nullable LinkNode fields", () => {
    const document = { root: {
      type: "root", format: "", textFormat: 0, textStyle: "", direction: null, children: [
        { type: "paragraph", format: "center", textFormat: 2, textStyle: "font-weight:bold", children: [
          { type: "link", url: "https://example.test", rel: null, target: null, title: null, format: "right", textFormat: 3, textStyle: "color:red", children: [] },
        ] },
        { type: "heading", tag: "h2", format: "end", textFormat: 1, textStyle: "", children: [] },
        { type: "list", listType: "bullet", tag: "ul", format: "left", textFormat: 0, textStyle: "", children: [
          { type: "listitem", format: "justify", textFormat: 0, textStyle: "", children: [] },
        ] },
        { type: "quote", format: "start", textFormat: 0, textStyle: "", children: [] },
        { type: "code", format: "", textFormat: 0, textStyle: "", children: [] },
      ],
    } };
    expect(snapshotLexicalDocument(document)).toEqual(document);
    expect(validateLexicalDocument(document).valid).toBe(true);
  });

  it("enforces Lexical direction, text mode, and nullable link metadata domains", () => {
    const base = { root: { type: "root", children: [{ type: "paragraph", children: [] }] } };
    expect(validateLexicalDocument({ root: { type: "root", direction: "diagonal", children: [] } })).toEqual({ valid: false, errors: ["root.direction must be 'ltr', 'rtl', or null"] });
    expect(validateLexicalDocument({ root: { type: "root", children: [{ type: "paragraph", children: [{ type: "text", text: "x", mode: "invalid" }] }] } })).toEqual({ valid: false, errors: ["root.children[0].children[0].mode must be 'normal', 'token', or 'segmented'"] });
    expect(validateLexicalDocument({ root: { type: "root", children: [{ type: "paragraph", children: [{ type: "link", url: "https://example.test", rel: 1, children: [] }] }] } })).toEqual({ valid: false, errors: ["root.children[0].children[0].rel must be a string or null"] });
    expect(validateLexicalDocument(base).valid).toBe(true);
  });

  it("rejects unsupported document wrapper fields and non-JSON metadata primitives", () => {
    const validRoot = { type: "root", children: [] };
    expect(validateLexicalDocument({ root: validRoot, namespace: "notes" })).toEqual({ valid: false, errors: ["document.namespace is unsupported"] });
    expect(validateLexicalDocument({ root: { type: "root", version: undefined, children: [] } })).toEqual({ valid: false, errors: ["root.version must be a JSON-safe integer"] });
    expect(validateLexicalDocument({ root: { type: "root", direction: 1n, children: [] } })).toEqual({ valid: false, errors: ["root.direction must be a JSON-safe string or null"] });
    expect(validateLexicalDocument({ root: { type: "root", direction: Number.NaN, children: [] } })).toEqual({ valid: false, errors: ["root.direction must be a JSON-safe string or null"] });
    expect(validateLexicalDocument({ root: { type: "root", children: [], format: () => "bold" } })).toEqual({ valid: false, errors: ["root.format must be a valid element format"] });
    expect(validateLexicalDocument({ root: { type: "root", format: 1, children: [] } })).toEqual({ valid: false, errors: ["root.format must be a valid element format"] });
    expect(validateLexicalDocument({ root: { type: "root", children: [{ type: "paragraph", format: 1, children: [] }] } })).toEqual({ valid: false, errors: ["root.children[0].format must be a valid element format"] });
  });

  it("neutralizes one-to-six hash ATX prefixes including a literal hash-only line", () => {
    const result = projectLexicalDocument({ root: { type: "root", children: [{ type: "paragraph", children: [text("#\n## heading\n###### six") ] }] } });
    expect(result.markdown).toBe("\\#\n\\#\\# heading\n\\#\\#\\#\\#\\#\\# six");
  });

  it("clones the document before validation and rendering", () => {
    let reads = 0;
    const validRoot = { type: "root", children: [{ type: "paragraph", children: [text("safe")] }] };
    const hostileRoot = { type: "root", children: [{ type: "paragraph", children: [{ type: "link", url: "note://99999999-9999-4999-8999-999999999999", children: [text("injected")] }] }] };
    const document: any = {};
    Object.defineProperty(document, "root", { enumerable: true, get: () => (++reads === 1 ? validRoot : hostileRoot) });
    const result = projectLexicalDocument(document);
    expect(reads).toBe(1);
    expect(result.plaintext).toBe("safe");
    expect(result.links).toEqual([]);
  });

  it("rejects cyclic and over-deep documents with bounded validation errors", () => {
    const cyclic: any = { root: { type: "root", children: [] } };
    const paragraph: any = { type: "paragraph", children: [] };
    paragraph.children.push(paragraph);
    cyclic.root.children.push(paragraph);
    expect(validateLexicalDocument(cyclic).errors).toContain("root.children[0].children[0] is cyclic");

    let node: any = { type: "paragraph", children: [text("deep")] };
    for (let index = 0; index < 70; index += 1) node = { type: "quote", children: [node] };
    expect(validateLexicalDocument({ root: { type: "root", children: [node] } }).errors).toContain("Lexical document exceeds maximum depth of 64");
  });

  it("fails fast with one bounded error for a flat node bomb", () => {
    const document = { root: { type: "root", children: Array.from({ length: 10_001 }, () => ({ type: "paragraph", children: [] })) } };
    expect(validateLexicalDocument(document)).toEqual({ valid: false, errors: ["Lexical document exceeds maximum child slots of 10000"] });
  });

  it("validates bounded snapshots before checklist mutation", () => {
    const cyclic: any = { root: { type: "root", children: [] } };
    const paragraph: any = { type: "paragraph", children: [] };
    paragraph.children.push(paragraph);
    cyclic.root.children.push(paragraph);
    expect(() => setChecklistItemChecked(cyclic, "33333333-3333-4333-8333-333333333333", true)).toThrow("Invalid Lexical document");

    let deep: any = { type: "paragraph", children: [{ type: "check-listitem", itemId: "33333333-3333-4333-8333-333333333333", checked: false, children: [text("deep")] }] };
    for (let index = 0; index < 70; index += 1) deep = { type: "quote", children: [deep] };
    expect(() => setChecklistItemChecked({ root: { type: "root", children: [deep] } }, "33333333-3333-4333-8333-333333333333", true)).toThrow("maximum depth");
    const valid = { root: { type: "root", children: [{ type: "check-listitem", itemId: "33333333-3333-4333-8333-333333333333", checked: false, children: [text("item")] }] } };
    expect(() => setChecklistItemChecked(valid, "33333333-3333-4333-8333-333333333333", "yes" as never)).toThrow("CHECKLIST_CHECKED_INVALID");
    expect(() => setChecklistItemChecked(valid, "33333333-3333-4333-8333-333333333334", true)).toThrow("CHECKLIST_ITEM_NOT_FOUND");
    const duplicate = { root: { type: "root", children: [{ type: "check-listitem", itemId: "33333333-3333-4333-8333-333333333333", checked: false, children: [text("one")] }, { type: "check-listitem", itemId: "33333333-3333-4333-8333-333333333333", checked: false, children: [text("two")] }] } };
    expect(() => setChecklistItemChecked(duplicate, "33333333-3333-4333-8333-333333333333", true)).toThrow("Invalid Lexical document");
  });

  it("renders text format bitmasks while preserving AST-native plaintext", () => {
    const result = projectLexicalDocument({ root: { type: "root", children: [{ type: "paragraph", children: [text("bold", 1), text(" italic", 2), text(" strike", 4), text(" `code`", 16)] }] } });
    expect(result.markdown).toBe("**bold**&#32;*italic*&#32;~~strike~~&#32;`` `code` ``");
    expect(result.plaintext).toBe("bold italic strike `code`");
  });

  it("respects ordered list start/value metadata", () => {
    const result = projectLexicalDocument({ root: { type: "root", children: [{ type: "list", listType: "number", start: 3, children: [
      { type: "listitem", value: 3, children: [text("third")] },
      { type: "listitem", value: 7, children: [text("seventh")] },
    ] }] } });
    expect(result.markdown).toBe("3. third\n7. seventh");
    expect(result.plaintext).toBe("3. third\n7. seventh");
  });

  it("advances implicit ordered values after every explicit value", () => {
    const result = projectLexicalDocument({ root: { type: "root", children: [{ type: "list", listType: "number", start: 3, children: [
      { type: "listitem", value: 3, children: [text("first")] },
      { type: "listitem", value: 7, children: [text("explicit")] },
      { type: "listitem", children: [text("implicit")] },
    ] }] } });
    expect(result.markdown).toBe("3. first\n7. explicit\n8. implicit");
    expect(result.plaintext).toBe("3. first\n7. explicit\n8. implicit");
  });

  it("keeps numeric values on bullet items and visits nested side effects once", () => {
    const itemId = "33333333-3333-4333-8333-333333333333";
    const targetId = "44444444-4444-4444-8444-444444444444";
    const result = projectLexicalDocument({ root: { type: "root", children: [{ type: "list", listType: "bullet", children: [
      { type: "listitem", value: 9, children: [text("bullet"), { type: "list", listType: "number", start: 10, children: [{ type: "listitem", value: 12, children: [{ type: "check-listitem", itemId, checked: false, children: [{ type: "link", url: `note://${targetId}`, children: [text("nested")] }] }] }] }] },
    ] }] } });
    expect(result.markdown).toBe("- bullet\n  12. - [ ] [nested](note://44444444-4444-4444-8444-444444444444)");
    expect(result.checklist).toEqual([{ itemId, ordinal: 0, text: "nested", checked: false }]);
    expect(result.links).toEqual([{ targetPageId: targetId, ordinal: 0, text: "nested" }]);
  });

  it("sanitizes unsafe external destinations and rejects dangerous schemes", () => {
    const result = projectLexicalDocument({ root: { type: "root", children: [{ type: "paragraph", children: [{ type: "link", url: "https://example.test/a b<q>\\", children: [text("label [x]")] }] }] } });
    expect(result.markdown).toBe("[label \\[x\\]](<https://example.test/a%20b%3Cq%3E%5C>)");
    const validation = validateLexicalDocument({ root: { type: "root", children: [{ type: "paragraph", children: [{ type: "link", url: "javascript:alert(1)", children: [text("x")] }] }] } });
    expect(validation).toEqual({ valid: false, errors: ["root.children[0].children[0].url uses an unsafe scheme"] });
    for (const url of ["javascript&#x3A;alert(1)", "jav&#97;script:alert(1)", "java&Tab;script&colon;alert(1)", "jav&NewLine;ascript&colon;alert(1)", " \njavascript:alert(1)", "https&#x3A;//example.test", "data:text/plain,x"]) {
      expect(validateLexicalDocument({ root: { type: "root", children: [{ type: "paragraph", children: [{ type: "link", url, children: [text("x")] }] }] } }).valid).toBe(false);
    }
    expect(validateLexicalDocument({ root: { type: "root", children: [{ type: "paragraph", children: [{ type: "link", url: "https://example.test/?q=foo&#x3A;bar", children: [text("x")] }] }] } }).valid).toBe(true);
    for (const url of ["/redirect?a=1&next=https://example.test", "docs?a=1&next=https://example.test", "docs?x=java&Tab;script&colon;alert(1)", "#section?next=https://example.test", "docs&more", "docs&amp;more", "docs&#38;more", "docs;v=1", "docs&more:section", "docs;v=1:section", "mailto:user&#x26;tag@example.com"]) {
      expect(validateLexicalDocument({ root: { type: "root", children: [{ type: "paragraph", children: [{ type: "link", url, children: [text("x")] }] }] } }).valid).toBe(true);
    }
    expect(validateLexicalDocument({ root: { type: "root", children: [{ type: "paragraph", children: [{ type: "link", url: "docs&#x26;more:section", children: [text("x")] }] }] } }).valid).toBe(true);
    for (const [document, error] of [
      [{ root: { type: "root", children: {} } }, "root.children must be an array"],
      [{ root: { type: "root", children: [{ type: "paragraph", children: [{ type: "text", text: 1 }] }] } }, "root.children[0].children[0].text must be a string"],
      [{ root: { type: "root", children: [{ type: "paragraph", children: [{ type: "text", text: "x", format: "bold" }] }] } }, "root.children[0].children[0].format must be a finite numeric bitmask"],
      [{ root: { type: "root", children: [{ type: "paragraph", children: [{ type: "link", children: [] }] }] } }, "root.children[0].children[0].url must be a string"],
      [{ root: { type: "root", children: [{ type: "list", listType: "number", start: "3", children: [] }] } }, "root.children[0].start must be an integer"],
      [{ root: { type: "root", children: [{ children: [] }] } }, "root.children[0].type must be a string"],
    ] as const) {
      expect(validateLexicalDocument(document)).toEqual({ valid: false, errors: [error] });
    }
    for (const [document, error] of [
      [{ root: { type: "paragraph", children: [] } }, "document.root.type must be 'root'"],
      [{ root: { type: "root", children: [{ type: "paragraph", children: [{ type: "text", text: "x", children: [{ type: "link", url: "https://example.test", children: [] }] }] }] } }, "root.children[0].children[0].children is not allowed on text"],
      [{ root: { type: "root", children: [{ type: "list", children: [{ type: "paragraph", children: [] }] }] } }, "root.children[0].children[0].type 'paragraph' is not allowed under list"],
      [{ root: { type: "root", children: [{ type: "list", children: [{ type: "listitem", children: [{ type: "code", children: [] }] }] }] } }, "root.children[0].children[0].children[0].type 'code' is not allowed under listitem"],
    ] as const) {
      expect(validateLexicalDocument(document)).toEqual({ valid: false, errors: [error] });
    }
  });

  it("shares one link ordinal counter across list siblings and following blocks", () => {
    const first = "55555555-5555-4555-8555-555555555555";
    const second = "66666666-6666-4666-8666-666666666666";
    const third = "77777777-7777-4777-8777-777777777777";
    const result = projectLexicalDocument({ root: { type: "root", children: [
      { type: "list", children: [
        { type: "listitem", children: [{ type: "link", url: `note://${first}`, children: [text("one")] }] },
        { type: "listitem", children: [{ type: "link", url: `note://${second}`, children: [text("two")] }] },
      ] },
      { type: "paragraph", children: [{ type: "link", url: `note://${third}`, children: [text("three")] }] },
    ] } });
    expect(result.links.map((link) => link.ordinal)).toEqual([0, 1, 2]);
  });

  it("keeps adjacent inline leaves contiguous in plaintext checklist and link projections", () => {
    const target = "88888888-8888-4888-8888-888888888888";
    const result = projectLexicalDocument({ root: { type: "root", children: [
      { type: "check-listitem", itemId: "99999999-9999-4999-8999-999999999999", checked: false, children: [text("foo"), text("bar", 1), { type: "link", url: `note://${target}`, children: [text("baz")] }] },
    ] } });
    expect(result.plaintext).toBe("- foobarbaz");
    expect(result.checklist[0]?.text).toBe("foobarbaz");
    expect(result.links[0]?.text).toBe("baz");
  });

  it("encodes formatted boundary whitespace and preserves plaintext/code newlines", () => {
    const result = projectLexicalDocument({ root: { type: "root", children: [
      { type: "paragraph", children: [text("    bold\t", 1)] },
      { type: "code", children: [text("line\n\n  tail\n")] },
    ] } });
    expect(result.markdown).toContain("&#32;&#32;&#32;&#32;**bold**&#9;");
    expect(result.plaintext).toBe("    bold\t\nline\n\n  tail\n");
  });

  it("escapes table pipes and all line-leading mixed whitespace", () => {
    const result = projectLexicalDocument({ root: { type: "root", children: [
      { type: "paragraph", children: [text("a | b\n| next\n \tliteral\n  \tformatted", 0)] },
      { type: "paragraph", children: [text(" \tformatted", 1)] },
    ] } });
    expect(result.markdown).toBe("a \\| b\n\\| next\n&#32;&#9;literal\n&#32;&#32;&#9;formatted\n\n&#32;&#9;**formatted**");
    expect(result.plaintext).toBe("a | b\n| next\n \tliteral\n  \tformatted\n \tformatted");
  });

  it("keeps boundary whitespace outside emphasis and avoids duplicate code-fence blank lines", () => {
    const result = projectLexicalDocument({ root: { type: "root", children: [{ type: "paragraph", children: [text(" bold ", 1), text(" strike ", 4)] }, { type: "code", children: [text("line\n")] }] } });
    expect(result.markdown).toBe("&#32;**bold**&#32;&#32;~~strike~~&#32;\n\n```\nline\n```");
  });

  it("keeps adjacent block literals from becoming Markdown syntax", () => {
    const result = projectLexicalDocument({ root: { type: "root", children: [
      { type: "paragraph", children: [text("-"), text("-"), text("-\n1."), text(" item")] },
      { type: "paragraph", children: [text("second paragraph")] },
      { type: "code", children: [text("  code ` ``\nend  ")] },
    ] } });
    expect(result.markdown).toBe("\\---\n1\\. item\n\nsecond paragraph\n\n```\n  code ` ``\nend  \n```");
    expect(result.plaintext).toBe("---\n1. item\nsecond paragraph\n  code ` ``\nend  ");
  });

  it("escapes setext and indented-code block contexts", () => {
    const result = projectLexicalDocument({ root: { type: "root", children: [{ type: "paragraph", children: [text("===\n    literal")] }] } });
    expect(result.markdown).toBe("\\===\n&#32;&#32;&#32;&#32;literal");
    expect(result.plaintext).toBe("===\n    literal");
  });

  it("renders quote inline runs without synthesizing nested list markers", () => {
    const result = projectLexicalDocument({ root: { type: "root", children: [{ type: "quote", children: [text("1"), text(". item"), text(" bold ", 1)] }] } });
    expect(result.markdown).toBe("> 1\\. item&#32;**bold**&#32;");
    expect(result.plaintext).toBe("1. item bold ");
  });

  it("preserves an explicit ordered-list start of zero", () => {
    const result = projectLexicalDocument({ root: { type: "root", children: [{ type: "list", listType: "number", start: 0, children: [{ type: "listitem", children: [text("zero")] }, { type: "listitem", children: [text("one")] }] }] } });
    expect(result.markdown).toBe("0. zero\n1. one");
    expect(result.plaintext).toBe("0. zero\n1. one");
  });

  it("bounds unknown fields and recognizes tag-only ordered lists", () => {
    const hugeUnknown = { root: { type: "root", children: [], metadata: "x".repeat(1_000_001) } };
    expect(validateLexicalDocument(hugeUnknown)).toEqual({ valid: false, errors: ["Lexical document exceeds maximum text bytes of 1000000"] });
    const tagOnly = { root: { type: "root", children: [{ type: "list", tag: "ol", start: 999_999_999, children: [{ type: "listitem", children: [text("last")] }, { type: "listitem", children: [text("overflow")] }] }] } };
    expect(validateLexicalDocument(tagOnly)).toEqual({ valid: false, errors: ["root.children[0].children[1].value overflows ordered marker range"] });
    const longCode = "`".repeat(100_000);
    expect(projectLexicalDocument({ root: { type: "root", children: [{ type: "code", children: [text(longCode)] }] } }).markdown.startsWith("``")).toBe(true);
  });

  it("enforces list tag/listType consistency and canonicalizes legacy tag-only lists", () => {
    expect(validateLexicalDocument({ root: { type: "root", children: [{ type: "list", listType: "bullet", tag: "ol", children: [] }] } })).toEqual({ valid: false, errors: ["root.children[0] listType 'bullet' conflicts with tag 'ol'"] });
    expect(validateLexicalDocument({ root: { type: "root", children: [{ type: "list", listType: "number", tag: "ul", children: [] }] } })).toEqual({ valid: false, errors: ["root.children[0] listType 'number' conflicts with tag 'ul'"] });
    expect(validateLexicalDocument({ root: { type: "root", children: [{ type: "list", tag: "menu", children: [] }] } })).toEqual({ valid: false, errors: ["root.children[0].tag must be 'ul' or 'ol'"] });
    const legacy = snapshotLexicalDocument({ root: { type: "root", children: [{ type: "list", tag: "ol", children: [] }] } });
    expect(legacy.root.children?.[0]).toEqual({ type: "list", tag: "ol", listType: "number", children: [] });
  });

  it("requires nested list containers to be terminal list-item children", () => {
    const nested = { type: "list", listType: "bullet", children: [{ type: "listitem", children: [text("after"), { type: "list", children: [{ type: "listitem", children: [text("nested")] }] }, text("invalid")] }] };
    expect(validateLexicalDocument({ root: { type: "root", children: [nested] } })).toEqual({ valid: false, errors: ["root.children[0].children[0].children[2] nested list must be terminal"] });
    const valid = { type: "list", listType: "bullet", children: [{ type: "listitem", children: [text("before"), { type: "list", children: [{ type: "listitem", children: [text("nested")] }] }] }] };
    expect(validateLexicalDocument({ root: { type: "root", children: [valid] } }).valid).toBe(true);
  });

  it("fails before amplification when projected output exceeds its bounded budget", () => {
    let nested: any = { type: "list", children: [{ type: "listitem", children: [text("x\n".repeat(200_000))] }] };
    for (let index = 0; index < 20; index += 1) nested = { type: "list", children: [{ type: "listitem", children: [nested] }] };
    expect(() => projectLexicalDocument({ root: { type: "root", children: [nested] } })).toThrow("OUTPUT_TOO_LARGE");
  });

  it("rejects Markdown whitespace expansion before replacement allocation", () => {
    expect(() => projectLexicalDocument({ root: { type: "root", children: [{ type: "paragraph", children: [text(" ".repeat(900_000))] }] } })).toThrow("OUTPUT_TOO_LARGE");
    expect(() => projectLexicalDocument({ root: { type: "root", children: [{ type: "paragraph", children: [text("\n".repeat(900_000), 1)] }] } })).toThrow("OUTPUT_TOO_LARGE");
    expect(() => projectLexicalDocument({ root: { type: "root", children: [{ type: "paragraph", children: [text("\n".repeat(810_000) + "é".repeat(90_000), 1)] }] } })).toThrow("OUTPUT_TOO_LARGE");
  });

  it("rejects split-node Markdown output before the cumulative join allocates", () => {
    const split = Array.from({ length: 5 }, () => text(" ".repeat(200_000), 1));
    const nativeJoin = Array.prototype.join;
    let oversizedJoinAttempted = false;
    let failure: unknown;
    Array.prototype.join = function guardedJoin(separator?: string): string {
      const values = this as unknown[];
      if (values.length > 0 && values.every((value) => typeof value === "string")) {
        const separatorBytes = new TextEncoder().encode(separator ?? ",").byteLength;
        let bytes = Math.max(0, values.length - 1) * separatorBytes;
        for (const value of values as string[]) {
          bytes += new TextEncoder().encode(value).byteLength;
          if (bytes > 4 * 1024 * 1024) {
            oversizedJoinAttempted = true;
            throw new Error("OVERSIZED_JOIN_ATTEMPT");
          }
        }
      }
      return nativeJoin.call(values, separator);
    };
    try {
      projectLexicalDocument({ root: { type: "root", children: [{ type: "paragraph", children: split }] } });
    } catch (error) {
      failure = error;
    } finally {
      Array.prototype.join = nativeJoin;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("OUTPUT_TOO_LARGE");
    expect(oversizedJoinAttempted).toBe(false);
  });

  it("rejects the aggregate root/paragraph budget before materializing the second formatted fragment", () => {
    const first = text(" ".repeat(790_000), 1);
    const second = text(" ".repeat(199_000) + "`".repeat(10_000), 16);
    const nativeRepeat = String.prototype.repeat;
    let secondFragmentMaterialized = false;
    let failure: unknown;
    String.prototype.repeat = function guardedRepeat(count: number): string {
      if (String(this) === "`" && count > 1_000) {
        secondFragmentMaterialized = true;
        throw new Error("SECOND_FRAGMENT_MATERIALIZED");
      }
      return nativeRepeat.call(String(this), count);
    };
    try {
      projectLexicalDocument({ root: { type: "root", children: [{ type: "paragraph", children: [first, second] }] } });
    } catch (error) {
      failure = error;
    } finally {
      String.prototype.repeat = nativeRepeat;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("OUTPUT_TOO_LARGE");
    expect(secondFragmentMaterialized).toBe(false);
  });

  it("preflights root, list, nested link/checklist templates, and UTF-8 before indentation allocation", () => {
    const nearLimit = text(" ".repeat(838_852), 1);
    const nestedChecklist = {
      type: "check-list",
      children: [{ type: "check-listitem", itemId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", checked: false, children: [text("💥")] }],
    };
    const nested = {
      type: "list",
      listType: "bullet",
      children: [{ type: "listitem", children: [{ type: "link", url: "https://example.test/é", children: [text("é")] }, nestedChecklist] }],
    };
    const nativeSplit = String.prototype.split;
    let nestedFragmentMaterialized = false;
    let failure: unknown;
    String.prototype.split = (function guardedSplit(this: string, separator?: string | RegExp, limit?: number): string[] {
      if (String(this) === "- [ ] 💥" && separator === "\n") {
        nestedFragmentMaterialized = true;
        throw new Error("NESTED_FRAGMENT_MATERIALIZED");
      }
      return nativeSplit.call(String(this), separator as never, limit);
    }) as typeof String.prototype.split;
    try {
      projectLexicalDocument({ root: { type: "root", children: [{ type: "paragraph", children: [nearLimit] }, nested] } } as never);
    } catch (error) {
      failure = error;
    } finally {
      String.prototype.split = nativeSplit;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("OUTPUT_TOO_LARGE");
    expect(nestedFragmentMaterialized).toBe(false);
  });

  it("uses ASCII CommonMark whitespace instead of treating Unicode spaces as indentation", () => {
    const value = "\u00a0literal\u2003\n-\u00a0not-a-list\n1.\u2003not-a-list\n###\u00a0not-a-heading";
    const result = projectLexicalDocument({ root: { type: "root", children: [{ type: "paragraph", children: [text(value)] }, { type: "paragraph", children: [text("\u00a0formatted\u2003", 1)] }] } });
    expect(result.markdown).toBe(`${value}\n\n\u00a0**formatted**\u2003`);
    expect(result.plaintext).toBe(`${value}\n\u00a0formatted\u2003`);
  });

  it("preserves complete setext marker runs, horizontal whitespace, and line endings", () => {
    expect(projectLexicalDocument({ root: { type: "root", children: [{ type: "paragraph", children: [text("----  \n===\t\n")] }] } }).markdown).toBe("\\----&#32;&#32;\n\\===&#9;\n");
    expect(projectLexicalDocument({ root: { type: "root", children: [{ type: "paragraph", children: [text("----  \r\n")] }] } }).markdown).toBe("\\----&#32;&#32;\r\n");
    expect(projectLexicalDocument({ root: { type: "root", children: [{ type: "paragraph", children: [text("-\n--  \r\n=\t\n==\r\n")] }] } }).markdown).toBe("\\-\n\\--&#32;&#32;\r\n\\=&#9;\n\\==\r\n");
  });

  it("rejects official check-list metadata at the persistence boundary and accepts compatible fields", () => {
    const standard = { root: { type: "root", children: [{ type: "list", listType: "check", children: [{ type: "listitem", children: [text("missing stable id")] }] }] } };
    expect(validateLexicalDocument(standard)).toEqual({ valid: false, errors: ["root.children[0].listType 'check' requires custom check-list/check-listitem nodes with stable itemId"] });
    const downgraded = { root: { type: "root", children: [{ type: "list", listType: "bullet", children: [{ type: "listitem", checked: true, children: [text("must not become a bullet")] }] }] } };
    expect(validateLexicalDocument(downgraded)).toEqual({ valid: false, errors: ["root.children[0].children[0].checked requires custom check-list/check-listitem nodes with stable itemId"] });
    const compatible = { root: { type: "root", children: [{ type: "code", language: null, theme: "github-dark", children: [text("code")] }, { type: "list", children: [{ type: "listitem", value: 1, children: [text("official metadata")] }] }] } };
    expect(validateLexicalDocument(compatible)).toEqual({ valid: true, errors: [] });
    expect(snapshotLexicalDocument(compatible)).toEqual(compatible);
    expect(validateLexicalDocument({ root: { type: "root", children: [{ type: "check-list", children: [{ type: "check-listitem", itemId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", checked: false, children: [text("custom")] }] }] } }).valid).toBe(true);
  });

  it("bounds plaintext indentation before splitting deeply nested formatted lists", () => {
    const leadingNewlines = "\n".repeat(190_000);
    let nested: any = { type: "list", listType: "number", start: 0, children: [{ type: "listitem", children: [text(leadingNewlines, 1)] }] };
    for (let index = 0; index < 20; index += 1) nested = { type: "list", listType: "number", start: 0, children: [{ type: "listitem", children: [nested] }] };
    expect(() => projectLexicalDocument({ root: { type: "root", children: [nested] } })).toThrow("OUTPUT_TOO_LARGE");
  });

  it("rejects out-of-range ordered markers and implicit overflow", () => {
    const invalid = (start: number, value?: number) => ({ root: { type: "root", children: [{ type: "list", listType: "number", start, children: [{ type: "listitem", ...(value === undefined ? {} : { value }), children: [text("item")] }] }] } });
    expect(validateLexicalDocument(invalid(-1))).toEqual({ valid: false, errors: ["root.children[0].start must be between 0 and 999999999"] });
    expect(validateLexicalDocument(invalid(1_000_000_000))).toEqual({ valid: false, errors: ["root.children[0].start must be between 0 and 999999999"] });
    expect(validateLexicalDocument(invalid(0, 1_000_000_000))).toEqual({ valid: false, errors: ["root.children[0].children[0].value must be between 0 and 999999999"] });
    const overflow = { root: { type: "root", children: [{ type: "list", listType: "number", start: 999_999_999, children: [{ type: "listitem", children: [text("last")] }, { type: "listitem", children: [text("overflow")] }] }] } };
    expect(validateLexicalDocument(overflow)).toEqual({ valid: false, errors: ["root.children[0].children[1].value overflows ordered marker range"] });
  });
});
