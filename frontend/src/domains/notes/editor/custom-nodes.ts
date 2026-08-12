import {
  $applyNodeReplacement,
  ElementNode,
  setDOMUnmanaged,
  type LexicalNode,
  type LexicalUpdateJSON,
  type NodeKey,
  type SerializedElementNode,
  type Spread,
} from "lexical";
import { isStableChecklistItemId } from "../domain/lexical-contract";

export type SerializedCheckListNode = Spread<{
  type: "check-list";
  version: 1;
}, SerializedElementNode>;

export type SerializedCheckListItemNode = Spread<{
  type: "check-listitem";
  version: 1;
  itemId: string;
  checked: boolean;
}, SerializedElementNode>;

export class CheckListNode extends ElementNode {
  static getType(): string {
    return "check-list";
  }

  static clone(node: CheckListNode): CheckListNode {
    return new CheckListNode(node.__key);
  }

  static importJSON(serialized: SerializedCheckListNode): CheckListNode {
    return $createCheckListNode().updateFromJSON(serialized);
  }

  constructor(key?: NodeKey) {
    super(key);
  }

  createDOM(): HTMLElement {
    const element = document.createElement("ul");
    element.className = "notes-check-list";
    element.setAttribute("role", "list");
    return element;
  }

  updateDOM(): false {
    return false;
  }

  exportJSON(): SerializedCheckListNode {
    return { ...super.exportJSON(), type: "check-list", version: 1 };
  }

  canBeEmpty(): false {
    return false;
  }
}

export class CheckListItemNode extends ElementNode {
  __itemId: string;
  __checked: boolean;

  static getType(): string {
    return "check-listitem";
  }

  static clone(node: CheckListItemNode): CheckListItemNode {
    return new CheckListItemNode(node.__itemId, node.__checked, node.__key);
  }

  static importJSON(serialized: SerializedCheckListItemNode): CheckListItemNode {
    if (!isStableChecklistItemId(serialized.itemId)) throw new Error("INVALID_CHECKLIST_ITEM_ID");
    return $createCheckListItemNode(serialized.itemId, serialized.checked).updateFromJSON(serialized);
  }

  constructor(itemId = crypto.randomUUID(), checked = false, key?: NodeKey) {
    super(key);
    if (!isStableChecklistItemId(itemId)) throw new Error("INVALID_CHECKLIST_ITEM_ID");
    this.__itemId = itemId;
    this.__checked = checked;
  }

  createDOM(): HTMLElement {
    const element = document.createElement("li");
    element.className = "notes-check-listitem";
    element.dataset.checkItemId = this.__itemId;
    element.setAttribute("role", "checkbox");
    element.setAttribute("aria-checked", String(this.__checked));
    element.tabIndex = 0;
    const audit = document.createElement("small");
    audit.dataset.noteCheckAudit = "true";
    audit.contentEditable = "false";
    audit.className = "notes-check-audit";
    audit.hidden = true;
    setDOMUnmanaged(audit);
    element.append(audit);
    return element;
  }

  getDOMSlot(element: HTMLElement) {
    const audit = element.querySelector<HTMLElement>("[data-note-check-audit]");
    return audit ? super.getDOMSlot(element).withAfter(audit) : super.getDOMSlot(element);
  }

  updateDOM(previous: CheckListItemNode, dom: HTMLElement): boolean {
    if (previous.__checked !== this.__checked) dom.setAttribute("aria-checked", String(this.__checked));
    if (previous.__itemId !== this.__itemId) dom.dataset.checkItemId = this.__itemId;
    return false;
  }

  exportJSON(): SerializedCheckListItemNode {
    return {
      ...super.exportJSON(),
      type: "check-listitem",
      version: 1,
      itemId: this.__itemId,
      checked: this.__checked,
    };
  }

  getItemId(): string {
    return this.getLatest().__itemId;
  }

  setItemId(itemId: string): this {
    if (!isStableChecklistItemId(itemId)) throw new Error("INVALID_CHECKLIST_ITEM_ID");
    const writable = this.getWritable();
    writable.__itemId = itemId;
    return writable;
  }

  getChecked(): boolean {
    return this.getLatest().__checked;
  }

  setChecked(checked: boolean): this {
    const writable = this.getWritable();
    writable.__checked = checked;
    return writable;
  }

  toggleChecked(): this {
    return this.setChecked(!this.getChecked());
  }

  isParentRequired(): true {
    return true;
  }

  createParentElementNode(): CheckListNode {
    return $createCheckListNode();
  }

  insertNewAfter(_selection?: unknown, restoreSelection = true): CheckListItemNode {
    const next = $createCheckListItemNode();
    this.insertAfter(next, restoreSelection);
    return next;
  }
}

export const $createCheckListNode = (): CheckListNode =>
  $applyNodeReplacement(new CheckListNode());

export const $isCheckListNode = (node: LexicalNode | null | undefined): node is CheckListNode =>
  node instanceof CheckListNode;

export const $createCheckListItemNode = (
  itemId = crypto.randomUUID(),
  checked = false,
): CheckListItemNode => $applyNodeReplacement(new CheckListItemNode(itemId, checked));

export const $isCheckListItemNode = (
  node: LexicalNode | null | undefined,
): node is CheckListItemNode => node instanceof CheckListItemNode;

export const resolveChecklistItemAnchor = (anchor: LexicalNode): CheckListItemNode | null => {
  if (anchor instanceof CheckListItemNode) return anchor;
  const parent = anchor.getParent();
  return parent instanceof CheckListItemNode ? parent : null;
};

/**
 * Regenerates checklist identities for nodes introduced by a paste/import.
 * Existing destination nodes are identified by their stable Lexical keys and
 * are deliberately left byte-identical. This must run inside editor.update().
 */
export const regenerateInsertedChecklistIds = (
  root: LexicalNode,
  existingChecklistKeys: ReadonlySet<string>,
): void => {
  const items: CheckListItemNode[] = [];
  const stack: LexicalNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node instanceof CheckListItemNode) items.push(node);
    if (node instanceof ElementNode) stack.push(...node.getChildren());
  }

  const usedIds = new Set<string>();
  for (const item of items) {
    if (existingChecklistKeys.has(item.getKey())) usedIds.add(item.getItemId());
  }
  for (const item of items) {
    if (existingChecklistKeys.has(item.getKey())) continue;
    let nextId = crypto.randomUUID();
    while (usedIds.has(nextId)) nextId = crypto.randomUUID();
    item.setItemId(nextId);
    usedIds.add(nextId);
  }
};

export const updateCheckListItemFromJSON = (
  node: CheckListItemNode,
  serialized: LexicalUpdateJSON<SerializedCheckListItemNode>,
): CheckListItemNode => node.setChecked(serialized.checked);
