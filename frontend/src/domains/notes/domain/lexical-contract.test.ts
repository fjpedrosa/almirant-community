import { describe, expect, it } from "bun:test";
import {
  assertPersistableLexicalDocument,
  createChecklistBlock,
  emptyLexicalDocument,
  isSafeNoteUrl,
  normalizeLexicalDocumentForEditor,
  cloneLexicalDocumentWithFreshChecklistIds,
  mergeChecklistCheckedState,
  normalizeLexicalDocumentForPaste,
  safeNoteHref,
} from "./lexical-contract";

describe("Notes Lexical persistence contract", () => {
  it("regenerates every checklist identity when copying a draft to a new page", () => {
    const first = "a0000000-0000-4000-8000-000000000001";
    const second = "a0000000-0000-4000-8000-000000000002";
    const copied = cloneLexicalDocumentWithFreshChecklistIds({ root: { type: "root", children: [{ type: "check-list", children: [
      { type: "check-listitem", itemId: first, checked: false, children: [{ type: "text", text: "one" }] },
      { type: "check-listitem", itemId: second, checked: true, children: [{ type: "text", text: "two" }] },
    ] }] } });
    const ids = copied.root.children[0]?.children?.map((item) => item.itemId);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(ids).not.toContain(first);
    expect(ids).not.toContain(second);
    expect(copied.root.children[0]?.children?.[1]?.checked).toBe(true);
    expect(copied.root.children[0]?.children?.[1]?.children?.[0]?.text).toBe("two");
  });

  it("merges a checklist command response into a newer queued draft without dropping typed text", () => {
    const id = "a0000000-0000-4000-8000-000000000001";
    const merged = mergeChecklistCheckedState({ root: { type: "root", children: [{ type: "paragraph", children: [{ type: "text", text: "newer text" }] }, { type: "check-listitem", itemId: id, checked: false, children: [] }] } }, id, true);
    expect(merged.root.children[0]?.children?.[0]?.text).toBe("newer text");
    expect(merged.root.children[1]?.checked).toBe(true);
  });
  it("normalizes a persistable empty root to Lexical's required paragraph before editor allocation", () => {
    const persisted = { root: { type: "root", version: 1, children: [] } };
    const normalized = normalizeLexicalDocumentForEditor(persisted);
    expect(normalized.root.children).toEqual([expect.objectContaining({ type: "paragraph", children: [] })]);
    expect(persisted.root.children).toEqual([]);
  });

  it("creates only the custom stable checklist shape with a lowercase UUID", () => {
    const itemId = "10000000-0000-4000-8000-000000000001";
    const block = createChecklistBlock("Remember this", () => itemId);
    expect(block).toEqual({
      type: "check-list",
      version: 1,
      children: [{
        type: "check-listitem",
        version: 1,
        itemId,
        checked: false,
        children: [{ type: "text", version: 1, text: "Remember this" }],
      }],
    });
    expect(assertPersistableLexicalDocument({
      root: { ...emptyLexicalDocument.root, children: [block] },
    })).toBe(true);
  });

  it("fails closed for malformed or duplicate IDs and every stock checklist representation", () => {
    const id = "a0000000-0000-4000-8000-000000000001";
    const item = { type: "check-listitem", version: 1, itemId: id, checked: false, children: [] };
    expect(() => assertPersistableLexicalDocument({ root: { type: "root", version: 1, children: [item, item] } })).toThrow("DUPLICATE_CHECKLIST_ITEM_ID");
    expect(() => assertPersistableLexicalDocument({ root: { type: "root", version: 1, children: [{ ...item, itemId: id.toUpperCase() }] } })).toThrow("INVALID_CHECKLIST_ITEM_ID");
    expect(() => assertPersistableLexicalDocument({ root: { type: "root", version: 1, children: [{ type: "list", version: 1, listType: "check", children: [] }] } })).toThrow("STANDARD_CHECKLIST_NOT_PERSISTABLE");
    expect(() => assertPersistableLexicalDocument({ root: { type: "root", version: 1, children: [{ type: "listitem", version: 1, checked: false, value: 1, children: [] }] } })).toThrow("STANDARD_CHECKLIST_NOT_PERSISTABLE");
  });

  it("converts pasted stock task lists and regenerates duplicate checklist ids", () => {
    const id = "a0000000-0000-4000-8000-000000000001";
    const converted = normalizeLexicalDocumentForEditor({
      root: {
        type: "root",
        version: 1,
        children: [{
          type: "list",
          version: 1,
          listType: "check",
          children: [
            { type: "listitem", version: 1, value: 1, checked: true, children: [{ type: "text", version: 1, text: "one" }] },
            { type: "listitem", version: 1, checked: false, children: [{ type: "text", version: 1, text: "two" }] },
          ],
        }, {
          type: "check-list",
          version: 1,
          children: [{ type: "check-listitem", version: 1, itemId: id, checked: false, children: [] }, { type: "check-listitem", version: 1, itemId: id, checked: false, children: [] }],
        }],
      },
    });
    const children = converted.root.children;
    expect(children[0]?.type).toBe("check-list");
    expect(children[0]?.children?.every((item) => item.type === "check-listitem")).toBe(true);
    expect(children[0]?.children?.[0]?.value).toBeUndefined();
    expect((children[0]?.children?.[0] as { checked?: boolean }).checked).toBe(true);
    const ids = children[1]?.children?.map((item) => item.itemId);
    expect(new Set(ids).size).toBe(2);
    expect(assertPersistableLexicalDocument(converted)).toBe(true);
  });

  it("preserves rich stock checklist children and regenerates cross-page pasted IDs", () => {
    const existing = "a0000000-0000-4000-8000-000000000001";
    const pasted = normalizeLexicalDocumentForPaste({ root: { type: "root", children: [{
      type: "list", listType: "check", children: [{ type: "listitem", checked: false, children: [
        { type: "text", text: "rich", format: 1 },
        { type: "link", url: "https://example.com", children: [{ type: "text", text: "link" }] },
        { type: "linebreak" },
      ] }],
    }, { type: "check-list", children: [{ type: "check-listitem", itemId: existing, checked: false, children: [] }] }] } }, new Set([existing]));
    const stockItem = pasted.root.children[0]?.children?.[0];
    expect(stockItem?.children?.map((child) => child.type)).toEqual(["text", "link", "linebreak"]);
    expect(stockItem?.children?.[0]?.format).toBe(1);
    expect((pasted.root.children[1]?.children?.[0]?.itemId)).not.toBe(existing);
    expect(assertPersistableLexicalDocument(pasted)).toBe(true);
  });

  it("never serializes server checklist audit fields into Lexical JSON", () => {
    const document = {
      root: {
        type: "root",
        version: 1,
        children: [{
          type: "check-listitem",
          version: 1,
          itemId: "10000000-0000-4000-8000-000000000001",
          checked: true,
          completedAt: "2026-08-11T09:00:00.000Z",
          completedByUserId: "user-1",
          children: [],
        }],
      },
    };
    expect(() => assertPersistableLexicalDocument(document)).toThrow("UNSUPPORTED_NODE_FIELD");
  });

  it("uses the exact relative/http/https/mailto URL allowlist and strict internal page links", () => {
    const pageId = "a0000000-0000-4000-8000-000000000001";
    for (const url of ["/help", "docs", "./docs", "#section", "?q=notes", `\/notes/${pageId}`, `note://${pageId}`, `notes://${pageId}`, "https://example.com", "http://example.com", "mailto:team@example.com"]) {
      expect(isSafeNoteUrl(url)).toBe(true);
      expect(safeNoteHref(url)).toBe(url.startsWith("note://") || url.startsWith("notes://") ? `/notes/${pageId}` : url);
    }
    for (const url of ["javascript:alert(1)", "java&#x73;cript&#x3a;alert(1)", "data:text/html,bad", "ftp://example.com", "//evil.example", `/notes/${pageId.toUpperCase()}`, "docs:javascript:alert(1)"]) {
      expect(isSafeNoteUrl(url)).toBe(false);
      expect(safeNoteHref(url)).toBe("#");
    }
  });

  it("accepts Lexical element textFormat and textStyle metadata on supported blocks", () => {
    expect(() => assertPersistableLexicalDocument({
      root: {
        type: "root",
        version: 1,
        children: [{
          type: "heading",
          version: 1,
          tag: "h2",
          direction: null,
          format: "",
          indent: 0,
          textFormat: 0,
          textStyle: "",
          children: [],
        }],
      },
    })).not.toThrow();
  });

  it("rejects invalid Lexical direction, element format, and text mode domains", () => {
    const base = { type: "root", version: 1, children: [] };
    expect(() => assertPersistableLexicalDocument({ root: { ...base, direction: "diagonal" } })).toThrow("INVALID_LEXICAL_DIRECTION");
    expect(() => assertPersistableLexicalDocument({ root: { ...base, format: "diagonal" } })).toThrow("INVALID_LEXICAL_FORMAT");
    expect(() => assertPersistableLexicalDocument({ root: { ...base, children: [{ type: "text", text: "x", mode: "invalid" }] } })).toThrow("INVALID_LEXICAL_MODE");
  });

  it("accepts Lexical's omitted direction value emitted by editor state JSON", () => {
    expect(() => assertPersistableLexicalDocument({
      root: { type: "root", version: 1, direction: undefined, children: [] },
    })).not.toThrow();
  });
});
