"use client";

import { CodeNode, $createCodeNode } from "@lexical/code";
import { $isLinkNode, LinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import { $insertDataTransferForRichText } from "@lexical/clipboard";
import {
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListItemNode,
  ListNode,
  $isListItemNode,
} from "@lexical/list";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { $setBlocksType } from "@lexical/selection";
import { $createHeadingNode, $createQuoteNode, HeadingNode, QuoteNode } from "@lexical/rich-text";
import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  KEY_DOWN_COMMAND,
  PASTE_COMMAND,
  COMMAND_PRIORITY_HIGH,
  type EditorState,
  type LexicalEditor,
  type LexicalNode,
  type TextFormatType,
} from "lexical";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { assertPersistableLexicalDocument, normalizeLexicalDocumentForEditor, safeNoteHref, isSafeNoteUrl, type LexicalJsonDocument } from "../domain/lexical-contract";
import type { NoteChecklistItemSummary, NotePageSummary } from "../domain/types";
import { EditorToolbar, type EditorCommand, type EditorToolbarLabels } from "../presentation/components/editor-toolbar";
import {
  $createCheckListItemNode,
  $createCheckListNode,
  CheckListItemNode,
  CheckListNode,
  regenerateInsertedChecklistIds,
  resolveChecklistItemAnchor,
} from "./custom-nodes";

export type NotesEditorHandle = {
  getDocument: () => LexicalJsonDocument;
  setDocument: (document: Record<string, unknown>) => void;
  focus: () => void;
};

type EditorLabels = EditorToolbarLabels & {
  bodyPlaceholder: string;
  linkPrompt: string;
  invalidLink: string;
  pageLink: string;
  untitled: string;
  saveLink: string;
  cancel: string;
  completion: (date: string, actor: string) => string;
  memberFallback: string;
  updated: (date: string) => string;
};

const CaptureEditorPlugin = ({ onReady }: { onReady: (editor: LexicalEditor) => void }) => {
  const [editor] = useLexicalComposerContext();
  useEffect(() => onReady(editor), [editor, onReady]);
  return null;
};

const ToolbarSelectionPlugin = ({ onActiveChange }: { onActiveChange: (commands: ReadonlySet<EditorCommand>) => void }) => {
  const [editor] = useLexicalComposerContext();
  useEffect(() => editor.registerUpdateListener(({ editorState }) => {
    editorState.read(() => {
      const selection = $getSelection();
      const active = new Set<EditorCommand>();
      if ($isRangeSelection(selection)) {
        if (selection.hasFormat("bold")) active.add("bold");
        if (selection.hasFormat("italic")) active.add("italic");
        if (selection.hasFormat("underline")) active.add("underline");
        if (selection.hasFormat("strikethrough")) active.add("strike");
        if (selection.hasFormat("code")) active.add("inline-code");
        const block = selection.anchor.getNode().getTopLevelElementOrThrow();
        if (block.getType() === "heading") {
          const tag = (block as unknown as { getTag?: () => string }).getTag?.();
          active.add(tag === "h1" ? "heading1" : tag === "h2" ? "heading2" : "paragraph");
        } else if (block.getType() === "list") {
          const listType = (block as unknown as { getListType?: () => string }).getListType?.();
          active.add(listType === "number" ? "number" : listType === "check" ? "checklist" : "bullet");
        } else if (block.getType() === "quote") active.add("quote");
        else if (block.getType() === "code") active.add("code");
        else active.add("paragraph");
      }
      onActiveChange(active);
    });
  }), [editor, onActiveChange]);
  return null;
};

const SafeLinkPlugin = () => {
  const [editor] = useLexicalComposerContext();
  useEffect(() => editor.registerMutationListener(LinkNode, (mutations) => {
    editor.getEditorState().read(() => {
      for (const [key] of mutations) {
        const node = $getNodeByKey(key);
        if (!$isLinkNode(node)) continue;
        const element = editor.getElementByKey(key) as HTMLAnchorElement | null;
        if (!element) continue;
        element.href = safeNoteHref(node.getURL());
        element.rel = "noopener noreferrer";
      }
    });
  }), [editor]);
  return null;
};

const ChecklistInteractionPlugin = ({
  onToggle,
  enabled,
}: {
  onToggle: (itemId: string, checked: boolean) => Promise<void> | void;
  enabled: boolean;
}) => {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    const root = editor.getRootElement();
    if (!root) return;
    const applyAccessibility = () => {
      for (const element of root.querySelectorAll<HTMLElement>("[data-check-item-id]")) {
        element.tabIndex = enabled ? 0 : -1;
        if (enabled) element.removeAttribute("aria-disabled"); else element.setAttribute("aria-disabled", "true");
      }
    };
    applyAccessibility();
    const unregisterUpdate = editor.registerUpdateListener(() => queueMicrotask(applyAccessibility));
    if (!enabled) return unregisterUpdate;
    const activate = (target: EventTarget | null, keyboard = false, clientX?: number) => {
      const element = target instanceof Element ? target.closest<HTMLElement>("[data-check-item-id]") : null;
      if (!element) return false;
      if (!keyboard && clientX !== undefined && clientX > element.getBoundingClientRect().left + 30) return false;
      const itemId = element.dataset.checkItemId;
      if (!itemId) return false;
      const checked = element.getAttribute("aria-checked") === "true";
      void onToggle(itemId, !checked);
      return true;
    };
    const click = (event: MouseEvent) => {
      if (activate(event.target, false, event.clientX)) event.preventDefault();
    };
    const keydown = (event: KeyboardEvent) => {
      if ((event.key === " " || event.key === "Enter") && activate(event.target, true)) event.preventDefault();
    };
    root.addEventListener("click", click);
    root.addEventListener("keydown", keydown);
    return () => {
      unregisterUpdate();
      root.removeEventListener("click", click);
      root.removeEventListener("keydown", keydown);
    };
  }, [editor, enabled, onToggle]);
  return null;
};

const ChecklistAuditPlugin = ({
  items,
  members,
  labels,
}: {
  items: NoteChecklistItemSummary[];
  members: Map<string, string>;
  labels: Pick<EditorLabels, "completion" | "memberFallback" | "updated">;
}) => {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    const apply = () => {
      const root = editor.getRootElement();
      if (!root) return;
      const byId = new Map(items.map((item) => [item.itemId, item]));
      for (const element of root.querySelectorAll<HTMLElement>("[data-check-item-id]")) {
        const small = element.querySelector<HTMLElement>("[data-note-check-audit]");
        if (!small) continue;
        const item = byId.get(element.dataset.checkItemId ?? "");
        if (!item) {
          small.hidden = true;
          small.textContent = "";
          continue;
        }
        const completed = item.checked && item.completedAt
          ? labels.completion(item.completedAt, members.get(item.completedByUserId ?? "") || labels.memberFallback)
          : null;
        small.textContent = completed ?? labels.updated(item.updatedAt);
        small.hidden = false;
      }
    };
    const scheduleApply = () => queueMicrotask(apply);
    scheduleApply();
    const unregisterRoot = editor.registerRootListener((root) => {
      if (root) scheduleApply();
    });
    const unregisterUpdate = editor.registerUpdateListener(scheduleApply);
    return () => {
      unregisterRoot();
      unregisterUpdate();
    };
  }, [editor, items, labels, members]);
  return null;
};

/**
 * Clipboard insertion can clone a checklist item with its source UUID. Keep
 * identity normalization inside the live editor transaction so the next
 * toggle targets the inserted item, not its source.
 */
const ChecklistIdentityPlugin = () => {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    let normalizing = false;
    return editor.registerUpdateListener(({ editorState, tags }) => {
      if (normalizing || tags.has("notes-checklist-normalize")) return;
      const duplicateKeys: string[] = [];
      editorState.read(() => {
        const seen = new Set<string>();
        const stack: LexicalNode[] = [$getRoot()];
        while (stack.length) {
          const node = stack.pop()!;
          if (node instanceof CheckListItemNode) {
            const itemId = node.getItemId();
            if (seen.has(itemId)) duplicateKeys.push(node.getKey());
            else seen.add(itemId);
          }
          if ($isElementNode(node)) stack.push(...node.getChildren());
        }
      });
      if (duplicateKeys.length === 0) return;
      normalizing = true;
      editor.update(() => {
        for (const key of duplicateKeys) {
          const node = $getNodeByKey(key);
          if (node instanceof CheckListItemNode) node.setItemId(crypto.randomUUID());
        }
      }, { tag: "notes-checklist-normalize" });
      normalizing = false;
    });
  }, [editor]);
  return null;
};

const ChecklistPasteIdentityPlugin = () => {
  const [editor] = useLexicalComposerContext();
  useEffect(() => editor.registerCommand(PASTE_COMMAND, (event) => {
    if (!("clipboardData" in event)) return false;
    const dataTransfer = event.clipboardData;
    if (!dataTransfer) return false;
    const existingChecklistKeys = new Set<string>();
    editor.getEditorState().read(() => {
      const stack: LexicalNode[] = [$getRoot()];
      while (stack.length) {
        const node = stack.pop()!;
        if (node instanceof CheckListItemNode) existingChecklistKeys.add(node.getKey());
        if ($isElementNode(node)) stack.push(...node.getChildren());
      }
    });
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      $insertDataTransferForRichText(dataTransfer, selection, editor);
      regenerateInsertedChecklistIds($getRoot(), existingChecklistKeys);
    }, { tag: "notes-paste-normalize" });
    return true;
  }, COMMAND_PRIORITY_HIGH), [editor]);
  return null;
};

const StockChecklistTransformPlugin = () => {
  const [editor] = useLexicalComposerContext();
  useEffect(() => editor.registerNodeTransform(ListNode, (list) => {
      if (list.getListType() !== "check") return;
      const custom = $createCheckListNode();
      for (const child of list.getChildren()) {
        if (!$isListItemNode(child)) continue;
        const item = $createCheckListItemNode(crypto.randomUUID(), child.getChecked() === true);
        for (const nested of child.getChildren()) item.append(nested);
        custom.append(item);
      }
    list.replace(custom);
  }), [editor]);
  return null;
};

const KeyboardShortcutsPlugin = () => {
  const [editor] = useLexicalComposerContext();
  useEffect(() => editor.registerCommand(KEY_DOWN_COMMAND, (event) => {
    if (!(event.metaKey || event.ctrlKey)) return false;
    const format: TextFormatType | null = event.key.toLowerCase() === "b"
      ? "bold"
      : event.key.toLowerCase() === "i"
        ? "italic"
        : event.key.toLowerCase() === "u"
          ? "underline"
          : event.shiftKey && event.key.toLowerCase() === "s"
            ? "strikethrough"
            : event.shiftKey && event.key.toLowerCase() === "c"
              ? "code"
              : null;
    if (!format) return false;
    event.preventDefault();
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
    return true;
  }, COMMAND_PRIORITY_LOW), [editor]);
  return null;
};

const SlashCommandPlugin = ({ onCommand, labels }: { onCommand: (command: EditorCommand) => void; labels: EditorLabels }) => {
  const [editor] = useLexicalComposerContext();
  const [open, setOpen] = useState(false);
  useEffect(() => editor.registerUpdateListener(({ editorState }) => {
    editorState.read(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || !selection.isCollapsed()) return setOpen(false);
      const anchor = selection.anchor.getNode().getTopLevelElementOrThrow();
      setOpen(anchor.getTextContent().endsWith("/"));
    });
  }), [editor]);
  if (!open) return null;
  const commands: Array<[EditorCommand, string]> = [
    ["paragraph", labels.paragraph], ["heading1", labels.heading1], ["heading2", labels.heading2],
    ["bullet", labels.bullet], ["number", labels.number], ["checklist", labels.checklist],
    ["quote", labels.quote], ["code", labels.code],
  ];
  return (
    <div role="menu" aria-label={labels.slash} className="absolute inset-x-5 top-full z-20 mt-2 grid w-56 max-w-[calc(100%-2.5rem)] gap-1 rounded-lg border border-border bg-popover p-2 shadow-lg">
      {commands.map(([command, label]) => (
        <button key={command} type="button" role="menuitem" onMouseDown={(event) => event.preventDefault()} onClick={() => {
          editor.update(() => {
            const selection = $getSelection();
            if (!$isRangeSelection(selection)) return;
            const node = selection.anchor.getNode();
            if (node.getTextContent().endsWith("/") && "setTextContent" in node) {
              (node as { setTextContent: (value: string) => void }).setTextContent(node.getTextContent().slice(0, -1));
            }
          });
          setOpen(false);
          onCommand(command);
        }} className="rounded-md px-3 py-2 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {label}
        </button>
      ))}
    </div>
  );
};

const EmptyChecklistEnterPlugin = () => {
  const [editor] = useLexicalComposerContext();
  useEffect(() => editor.registerCommand(KEY_DOWN_COMMAND, (event) => {
    if (event.key !== "Enter") return false;
    let handled = false;
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;
      const item = resolveChecklistItemAnchor(selection.anchor.getNode());
      if (!(item instanceof CheckListItemNode) || item.getTextContent().trim() !== "") return;
      const list = item.getParent();
      if (!list) return;
      const paragraph = $createParagraphNode();
      list.getTopLevelElementOrThrow().insertAfter(paragraph);
      item.remove();
      if (list.getChildrenSize() === 0) list.remove();
      paragraph.select();
      handled = true;
    }, { tag: "notes-empty-checklist-enter" });
    if (handled) event.preventDefault();
    return handled;
  }, COMMAND_PRIORITY_LOW), [editor]);
  return null;
};
export const NotesEditor = forwardRef<NotesEditorHandle, {
  document: Record<string, unknown>;
  editable: boolean;
  labels: EditorLabels;
  availablePages: NotePageSummary[];
  checklistItems: NoteChecklistItemSummary[];
  memberNames?: Map<string, string>;
  onChange: (document: LexicalJsonDocument) => void;
  onChecklistToggle: (itemId: string, checked: boolean) => Promise<void> | void;
}>(function NotesEditor({
  document,
  editable,
  labels,
  availablePages,
  checklistItems,
  memberNames = new Map(),
  onChange,
  onChecklistToggle,
}, ref) {
  assertPersistableLexicalDocument(document);
  const editorDocument = normalizeLexicalDocumentForEditor(document);
  const editorRef = useRef<LexicalEditor | null>(null);
  const [linkMode, setLinkMode] = useState<"external" | "internal" | null>(null);
  const [linkValue, setLinkValue] = useState("");
  const [linkError, setLinkError] = useState(false);
  const [activeCommands, setActiveCommands] = useState<ReadonlySet<EditorCommand>>(() => new Set());
  const initialConfig = useMemo(() => ({
    namespace: "almirant-notes",
    editable,
    editorState: JSON.stringify(editorDocument),
    nodes: [HeadingNode, QuoteNode, CodeNode, LinkNode, ListNode, ListItemNode, CheckListNode, CheckListItemNode],
    theme: {
      paragraph: "notes-editor-paragraph",
      heading: { h1: "notes-editor-h1", h2: "notes-editor-h2", h3: "notes-editor-h3" },
      quote: "notes-editor-quote",
      link: "notes-editor-link",
      list: { ul: "notes-editor-list", ol: "notes-editor-list", listitem: "notes-editor-listitem" },
      text: { bold: "font-semibold", italic: "italic", underline: "underline", strikethrough: "line-through", code: "notes-editor-inline-code" },
      code: "notes-editor-code",
    },
    onError: (error: Error) => { throw error; },
  // The composer must not be recreated for each autosave response; server replacements use the handle below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  const capture = useCallback((editor: LexicalEditor) => { editorRef.current = editor; editor.setEditable(editable); }, [editable]);
  useEffect(() => editorRef.current?.setEditable(editable), [editable]);
  useImperativeHandle(ref, () => ({
    getDocument: () => editorRef.current!.getEditorState().toJSON() as LexicalJsonDocument,
    setDocument: (nextDocument) => {
      const normalized = normalizeLexicalDocumentForEditor(nextDocument);
      const editor = editorRef.current;
      if (!editor) return;
      editor.setEditorState(editor.parseEditorState(JSON.stringify(normalized)), { tag: "notes-server-sync" });
    },
    focus: () => editorRef.current?.focus(),
  }), []);

  const command = useCallback((value: EditorCommand) => {
    const editor = editorRef.current;
    if (!editor || !editable) return;
    const textFormats: Partial<Record<EditorCommand, TextFormatType>> = {
      bold: "bold", italic: "italic", underline: "underline", strike: "strikethrough", "inline-code": "code",
    };
    if (textFormats[value]) return void editor.dispatchCommand(FORMAT_TEXT_COMMAND, textFormats[value]!);
    if (value === "bullet") return void editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
    if (value === "number") return void editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
    if (value === "link" || value === "internal-link") {
      setLinkMode(value === "link" ? "external" : "internal");
      setLinkValue("");
      setLinkError(false);
      return;
    }
    editor.update(() => {
      const selection = $getSelection();
      if (value === "checklist") {
        const list = $createCheckListNode();
        list.append($createCheckListItemNode().append($createTextNode("")));
        if ($isRangeSelection(selection)) selection.insertNodes([list]); else $getRoot().append(list);
        return;
      }
      if (value === "paragraph") $setBlocksType(selection, () => $createParagraphNode());
      if (value === "heading1") $setBlocksType(selection, () => $createHeadingNode("h1"));
      if (value === "heading2") $setBlocksType(selection, () => $createHeadingNode("h2"));
      if (value === "quote") $setBlocksType(selection, () => $createQuoteNode());
      if (value === "code") $setBlocksType(selection, () => $createCodeNode(null));
    });
  }, [editable]);

  const saveLink = () => {
    const href = linkMode === "internal" ? `/notes/${linkValue}` : linkValue.trim();
    if (!isSafeNoteUrl(href)) return setLinkError(true);
    editorRef.current?.dispatchCommand(TOGGLE_LINK_COMMAND, { url: href, rel: "noopener noreferrer" });
    setLinkMode(null);
  };

  return (
    <div className={cn("relative overflow-visible border-y border-border/70 bg-background", !editable && "bg-muted/10")}>
      <EditorToolbar editable={editable} labels={labels} activeCommands={activeCommands} onCommand={command} />
      <LexicalComposer initialConfig={initialConfig}>
        <CaptureEditorPlugin onReady={capture} />
        <ToolbarSelectionPlugin onActiveChange={setActiveCommands} />
        <div className="relative">
          <RichTextPlugin
            contentEditable={<ContentEditable aria-label={labels.bodyPlaceholder} className="notes-editor-content min-h-[42vh] px-5 py-6 outline-none md:px-10" />}
            placeholder={<p className="pointer-events-none absolute left-5 top-6 text-muted-foreground md:left-10">{labels.bodyPlaceholder}</p>}
            ErrorBoundary={LexicalErrorBoundary}
          />
          <SlashCommandPlugin onCommand={command} labels={labels} />
        </div>
        <HistoryPlugin />
        <ListPlugin />
        <LinkPlugin validateUrl={isSafeNoteUrl} />
        <SafeLinkPlugin />
        <KeyboardShortcutsPlugin />
        <ChecklistInteractionPlugin enabled={editable} onToggle={onChecklistToggle} />
        <ChecklistIdentityPlugin />
        <ChecklistPasteIdentityPlugin />
        <StockChecklistTransformPlugin />
        <EmptyChecklistEnterPlugin />
        <ChecklistAuditPlugin items={checklistItems} members={memberNames} labels={labels} />
        <OnChangePlugin ignoreSelectionChange onChange={(state: EditorState, _editor, tags) => {
          if (tags.has("notes-server-sync")) return;
          const next = normalizeLexicalDocumentForEditor(state.toJSON());
          onChange(next);
        }} />
      </LexicalComposer>
      <Dialog open={linkMode !== null} onOpenChange={(open) => { if (!open) setLinkMode(null); }}>
        <DialogContent data-notes-surface>
          <DialogHeader>
            <DialogTitle>{linkMode === "internal" ? labels.pageLink : labels.link}</DialogTitle>
            <DialogDescription>{linkMode === "internal" ? labels.internalLink : labels.linkPrompt}</DialogDescription>
          </DialogHeader>
          {linkMode === "internal" ? (
            <div className="space-y-2">
              <Label htmlFor="notes-internal-link">{labels.pageLink}</Label>
              <select id="notes-internal-link" value={linkValue} onChange={(event) => setLinkValue(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value="">—</option>
                {availablePages.map((page) => <option key={page.id} value={page.id}>{page.title || labels.untitled}</option>)}
              </select>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="notes-external-link">{labels.link}</Label>
              <Input id="notes-external-link" value={linkValue} onChange={(event) => { setLinkValue(event.target.value); setLinkError(false); }} />
            </div>
          )}
          {linkError && <p role="alert" className="text-sm text-destructive">{labels.invalidLink}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setLinkMode(null)}>{labels.cancel}</Button>
            <Button type="button" onClick={saveLink}>{labels.saveLink}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
});

export const getChecklistItemsFromDocument = (document: LexicalJsonDocument): Array<{ itemId: string; checked: boolean }> => {
  const result: Array<{ itemId: string; checked: boolean }> = [];
  const stack = [...document.root.children];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.type === "check-listitem") result.push({ itemId: String(node.itemId), checked: Boolean(node.checked) });
    if (Array.isArray(node.children)) stack.push(...node.children);
  }
  return result;
};
