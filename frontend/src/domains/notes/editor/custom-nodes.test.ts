import { describe, expect, it } from "bun:test";
import { $createTextNode, $getRoot, createEditor } from "lexical";
import {
  $createCheckListItemNode,
  $createCheckListNode,
  CheckListItemNode,
  CheckListNode,
  regenerateInsertedChecklistIds,
} from "./custom-nodes";
import { resolveChecklistItemAnchor } from "./custom-nodes";

describe("custom Notes checklist Lexical nodes", () => {
  it("serializes exactly as check-list/check-listitem with a stable lowercase UUID", () => {
    const id = "a0000000-0000-4000-8000-000000000001";
    const editor = createEditor({
      namespace: "notes-checklist-contract",
      nodes: [CheckListNode, CheckListItemNode],
      onError: (error) => { throw error; },
    });
    editor.update(() => {
      $getRoot().append(
        $createCheckListNode().append(
          $createCheckListItemNode(id, false).append($createTextNode("Ship it")),
        ),
      );
    }, { discrete: true });

    const child = editor.getEditorState().toJSON().root.children[0] as unknown as {
      type: string;
      children: Array<Record<string, unknown>>;
    };
    expect(child.type).toBe("check-list");
    expect(child).not.toHaveProperty("listType");
    expect(child.children[0]).toEqual(expect.objectContaining({
      type: "check-listitem",
      version: 1,
      itemId: id,
      checked: false,
    }));
    expect(child.children[0]).not.toHaveProperty("value");
  });

  it("generates one stable ID at creation and rejects malformed imported IDs", () => {
    const editor = createEditor({
      namespace: "notes-checklist-id-contract",
      nodes: [CheckListNode, CheckListItemNode],
      onError: (error) => { throw error; },
    });
    let first = "";
    let second = "";
    editor.update(() => {
      const generated = $createCheckListItemNode();
      first = generated.exportJSON().itemId;
      second = generated.exportJSON().itemId;
    }, { discrete: true });
    expect(first).toMatch(/^[0-9a-f-]+$/);
    expect(second).toBe(first);
    expect(() => CheckListItemNode.importJSON({
      type: "check-listitem",
      version: 1,
      itemId: "BAD",
      checked: false,
      children: [],
      direction: null,
      format: "",
      indent: 0,
    })).toThrow("INVALID_CHECKLIST_ITEM_ID");
  });

  it("inserts a fresh unchecked item with a new stable id after Enter", () => {
    const editor = createEditor({
      namespace: "notes-checklist-enter-contract",
      nodes: [CheckListNode, CheckListItemNode],
      onError: (error) => { throw error; },
    });
    const firstId = "a0000000-0000-4000-8000-000000000001";
    let secondId = "";
    editor.update(() => {
      const list = $createCheckListNode();
      const first = $createCheckListItemNode(firstId, true).append($createTextNode("first"));
      list.append(first);
      $getRoot().append(list);
      const inserted = first.insertNewAfter(undefined, true);
      secondId = inserted.getItemId();
    }, { discrete: true });
    expect(secondId).toMatch(/^[0-9a-f]{8}-[0-9a-f-]+$/);
    expect(secondId).not.toBe(firstId);
    const items = (editor.getEditorState().toJSON().root.children[0] as unknown as { children: Array<Record<string, unknown>> }).children;
    expect(items).toHaveLength(2);
    expect(items[1]).toEqual(expect.objectContaining({ itemId: secondId, checked: false }));
  });

  it("resolves an empty item when the Lexical anchor is the ElementNode itself", () => {
    const editor = createEditor({ namespace: "notes-checklist-anchor-contract", nodes: [CheckListNode, CheckListItemNode], onError: (error) => { throw error; } });
    let item!: CheckListItemNode;
    let child!: ReturnType<typeof $createTextNode>;
    editor.update(() => {
      item = $createCheckListItemNode();
      child = $createTextNode("");
      item.append(child);
      $getRoot().append($createCheckListNode().append(item));
      expect(resolveChecklistItemAnchor(item)).toBe(item);
      expect(resolveChecklistItemAnchor(child)).toBe(item);
    }, { discrete: true });
  });

  it("regenerates only inserted checklist identities while preserving destination IDs and rich children", () => {
    const destinationId = "a0000000-0000-4000-8000-000000000001";
    const pastedId = "a0000000-0000-4000-8000-000000000002";
    const nestedId = "a0000000-0000-4000-8000-000000000003";
    const editor = createEditor({ namespace: "notes-checklist-paste-identity-contract", nodes: [CheckListNode, CheckListItemNode], onError: (error) => { throw error; } });
    let destination!: CheckListItemNode;
    let pasted!: CheckListItemNode;
    let nested!: CheckListItemNode;
    editor.update(() => {
      destination = $createCheckListItemNode(destinationId).append($createTextNode("existing"));
      pasted = $createCheckListItemNode(pastedId).append($createTextNode("rich"));
      nested = $createCheckListItemNode(nestedId).append($createTextNode("nested"));
      pasted.append($createCheckListNode().append(nested));
      $getRoot().append($createCheckListNode().append(destination), $createCheckListNode().append(pasted));
      regenerateInsertedChecklistIds($getRoot(), new Set([destination.getKey()]));
      expect(destination.getItemId()).toBe(destinationId);
      expect(pasted.getItemId()).not.toBe(pastedId);
      expect(nested.getItemId()).not.toBe(nestedId);
      expect(pasted.getItemId()).not.toBe(nested.getItemId());
      expect(pasted.getTextContent()).toContain("rich");
      expect(nested.getTextContent()).toContain("nested");
    }, { discrete: true });
  });
});
