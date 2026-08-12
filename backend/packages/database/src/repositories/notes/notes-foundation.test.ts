import { describe, expect, it } from "bun:test";
import { notePages, notePageShares, noteChecklistItems, notePageLinks, noteLegacyArchiveItems } from "../../schema";
import { projectLexicalDocument, validateLexicalDocument } from "../../notes/lexical-projector";
import { createNotePage as productionCreateNotePage, createNotesRepository as productionCreateNotesRepository } from "./notes-repository";

const lexical = {
  root: {
    type: "root",
    version: 1,
    children: [
      { type: "heading", tag: "h1", version: 1, children: [{ type: "text", text: "Agenda", version: 1 }] },
      { type: "check-list", version: 1, children: [
        { type: "check-listitem", version: 1, checked: false, itemId: "11111111-1111-4111-8111-111111111111", children: [{ type: "text", text: "Ship notes", version: 1 }] },
      ] },
      { type: "paragraph", version: 1, children: [{ type: "link", version: 1, url: "note://22222222-2222-4222-8222-222222222222", children: [{ type: "text", text: "next" , version: 1 }] }] },
    ],
  },
};

describe("notes foundation", () => {
  it("exposes a root-bound production facade without database or transaction injection", () => {
    expect(productionCreateNotePage.length).toBe(1);
    expect(productionCreateNotesRepository.length).toBe(0);
  });
  it("exports the note schema tables", () => {
    expect(notePages).toBeDefined();
    expect(notePageShares).toBeDefined();
    expect(noteChecklistItems).toBeDefined();
    expect(notePageLinks).toBeDefined();
    expect(noteLegacyArchiveItems).toBeDefined();
  });

  it("projects Lexical JSON without losing stable checklist ids", () => {
    expect(validateLexicalDocument(lexical)).toEqual({ valid: true, errors: [] });
    const projection = projectLexicalDocument(lexical);
    expect(projection.plaintext).toBe("Agenda\n- Ship notes\nnext");
    expect(projection.markdown).toBe("# Agenda\n\n- [ ] Ship notes\n\n[next](note://22222222-2222-4222-8222-222222222222)");
    expect(projection.checklist).toEqual([
      expect.objectContaining({ itemId: "11111111-1111-4111-8111-111111111111", checked: false, text: "Ship notes" }),
    ]);
    expect(projection.links).toEqual([
      expect.objectContaining({ targetPageId: "22222222-2222-4222-8222-222222222222" }),
    ]);
  });

  it("preserves block boundaries for nested lists, headings, and links", () => {
    const projection = projectLexicalDocument({
      root: {
        type: "root",
        version: 1,
        children: [
          { type: "heading", tag: "h2", version: 1, children: [{ type: "text", text: "Plan", version: 1 }] },
          { type: "paragraph", version: 1, children: [{ type: "text", text: "Intro", version: 1 }] },
          { type: "list", version: 1, listType: "bullet", children: [
            { type: "listitem", version: 1, children: [{ type: "text", text: "One", version: 1 }] },
            { type: "listitem", version: 1, children: [{ type: "text", text: "Two", version: 1 }] },
          ] },
        ],
      },
    });
    expect(projection.markdown).toBe("## Plan\n\nIntro\n\n- One\n- Two");
    expect(projection.plaintext).toBe("Plan\nIntro\n- One\n- Two");
  });

  it("rejects duplicate checklist ids instead of silently creating two records", () => {
    const duplicate = structuredClone(lexical);
    const list = duplicate.root.children![1]! as any;
    (list.children![0] as Record<string, unknown>).itemId = "11111111-1111-4111-8111-111111111111";
    list.children!.push(structuredClone(list.children![0]));
    expect(validateLexicalDocument(duplicate).valid).toBe(false);
    expect(() => projectLexicalDocument(duplicate)).toThrow("duplicated");
  });

  it("rejects non-canonical uppercase checklist UUIDs", () => {
    const uppercase = structuredClone(lexical);
    (uppercase.root.children![1]!.children![0] as any).itemId = "11111111-1111-4111-8111-11111111111A";
    expect(validateLexicalDocument(uppercase)).toEqual({ valid: false, errors: ["root.children[1].children[0].itemId must be a lowercase canonical UUID"] });
  });

  it("preserves exact boundaries for multiple checklist items and nested lists", () => {
    const projection = projectLexicalDocument({
      root: {
        type: "root",
        version: 1,
        children: [{ type: "check-list", version: 1, children: [
          { type: "check-listitem", version: 1, checked: false, itemId: "33333333-3333-4333-8333-333333333333", children: [{ type: "text", version: 1, text: "First" }] },
          { type: "check-listitem", version: 1, checked: true, itemId: "44444444-4444-4444-8444-444444444444", children: [{ type: "text", version: 1, text: "Second" }] },
        ] }, { type: "list", version: 1, children: [
          { type: "listitem", version: 1, children: [{ type: "text", version: 1, text: "Parent" }, { type: "list", version: 1, children: [{ type: "listitem", version: 1, children: [{ type: "text", version: 1, text: "Nested" }] }] }] },
        ] }],
      },
    });
    expect(projection.markdown).toBe("- [ ] First\n- [x] Second\n\n- Parent\n  - Nested");
    expect(projection.plaintext).toBe("- First\n- Second\n- Parent\n  - Nested");
  });

  it("walks nested list descendants exactly once", () => {
    const projection = projectLexicalDocument({
      root: {
        type: "root",
        version: 1,
        children: [{ type: "list", version: 1, children: [{
          type: "listitem",
          version: 1,
          children: [
            { type: "text", version: 1, text: "Parent" },
            { type: "list", version: 1, children: [{
              type: "listitem",
              version: 1,
              children: [
                { type: "link", version: 1, url: "note://55555555-5555-4555-8555-555555555555", children: [{ type: "text", version: 1, text: "Nested link" }] },
                { type: "check-list", version: 1, children: [{ type: "check-listitem", version: 1, checked: false, itemId: "66666666-6666-4666-8666-666666666666", children: [{ type: "text", version: 1, text: "Nested check" }] }] },
              ],
            }] },
          ],
        }] }],
      },
    });
    expect(projection.markdown).toBe("- Parent\n  - [Nested link](note://55555555-5555-4555-8555-555555555555)\n    - [ ] Nested check");
    expect(projection.plaintext).toBe("- Parent\n  - Nested link\n    - Nested check");
    expect(projection.links).toHaveLength(1);
    expect(projection.checklist).toHaveLength(1);
    expect(projection.checklist[0]?.itemId).toBe("66666666-6666-4666-8666-666666666666");
  });

  it("escapes adversarial literal text and derives plaintext directly from the AST", () => {
    const projection = projectLexicalDocument({
      root: {
        type: "root",
        version: 1,
        children: [
          { type: "heading", tag: "h2", version: 1, children: [{ type: "text", text: "# literal * _ ~ ` [brackets]", version: 1 }] },
          { type: "paragraph", version: 1, children: [{ type: "text", text: "URL https://example.com/a_(b) and [literal]", version: 1 }] },
          { type: "paragraph", version: 1, children: [{ type: "link", version: 1, url: "https://example.com/a_(b)", children: [{ type: "text", text: "[external]", version: 1 }] }] },
          { type: "code", version: 1, children: [{ type: "text", text: "const x = `literal`", version: 1 }] },
        ],
      },
    });
    expect(projection.markdown).toBe("## \\# literal \\* \\_ \\~ \\` \\[brackets\\]\n\nURL https://example.com/a\\_\\(b\\) and \\[literal\\]\n\n[\\[external\\]](<https://example.com/a_(b)>)\n\n```\nconst x = `literal`\n```");
    expect(projection.plaintext).toBe("# literal * _ ~ ` [brackets]\nURL https://example.com/a_(b) and [literal]\n[external]\nconst x = `literal`");
  });

  it("keeps checklist labels and link anchors plaintext while Markdown escapes them", () => {
    const projection = projectLexicalDocument({
      root: {
        type: "root",
        version: 1,
        children: [
          { type: "check-listitem", version: 1, checked: false, itemId: "77777777-7777-4777-8777-777777777777", children: [{ type: "text", text: "* _ ~ ` [label]", version: 1 }] },
          { type: "paragraph", version: 1, children: [{ type: "link", version: 1, url: "note://88888888-8888-4888-8888-888888888888", children: [{ type: "text", text: "[anchor] *", version: 1 }] }] },
        ],
      },
    });
    expect(projection.checklist[0]?.text).toBe("* _ ~ ` [label]");
    expect(projection.links[0]?.text).toBe("[anchor] *");
    expect(projection.plaintext).toBe("- * _ ~ ` [label]\n[anchor] *");
  });

  it("uses a code fence longer than every literal backtick run", () => {
    const projection = projectLexicalDocument({
      root: { type: "root", children: [{ type: "code", children: [{ type: "text", text: "a``b```c" }] }] },
    });
    expect(projection.markdown).toBe("````\na``b```c\n````");
    expect(projection.plaintext).toBe("a``b```c");
  });

  it("escapes block markers, HTML, entities, and thematic breaks as literal text", () => {
    const projection = projectLexicalDocument({
      root: { type: "root", children: [
        { type: "paragraph", children: [{ type: "text", text: "1. ordered <b>raw</b> &copy;" }] },
        { type: "paragraph", children: [{ type: "text", text: "---" }] },
      ] },
    });
    expect(projection.markdown).toBe("1\\. ordered \\<b\\>raw\\</b\\> \\&copy;\n\n\\---");
    expect(projection.plaintext).toBe("1. ordered <b>raw</b> &copy;\n---");
  });

  it("does not synthesize ordered markers across adjacent text leaves", () => {
    const projection = projectLexicalDocument({
      root: { type: "root", children: [{ type: "paragraph", children: [
        { type: "text", text: "1" },
        { type: "text", text: ". split marker" },
      ] }] },
    });
    expect(projection.markdown).toBe("1\\. split marker");
    expect(projection.plaintext).toBe("1. split marker");
  });

  it("separates paragraph blocks and preserves multiline code boundaries", () => {
    const projection = projectLexicalDocument({
      root: { type: "root", children: [
        { type: "paragraph", children: [{ type: "text", text: "first" }] },
        { type: "paragraph", children: [{ type: "text", text: "second" }] },
        { type: "code", children: [{ type: "text", text: "  a``b\n\n c  " }] },
      ] },
    });
    expect(projection.markdown).toBe("first\n\nsecond\n\n```\n  a``b\n\n c  \n```");
    expect(projection.plaintext).toBe("first\nsecond\n  a``b\n\n c  ");
  });
});
