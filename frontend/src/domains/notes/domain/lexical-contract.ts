const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const INTERNAL_NOTE_PATTERN = /^\/notes\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const URI_NOTE_PATTERN = /^(?:note|notes):\/\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
const LINK_ENTITY_PATTERN = /&(?:#x([0-9a-f]+)|#([0-9]+)|([a-z][a-z0-9]+));/gi;

const decodeLinkEntities = (url: string): string => url.replace(LINK_ENTITY_PATTERN, (match, hex: string | undefined, decimal: string | undefined, name: string | undefined) => {
  if (name) return { colon: ":", amp: "&", tab: "\t", newline: "\n" }[name.toLowerCase()] ?? match;
  const value = Number.parseInt(hex ?? decimal!, hex ? 16 : 10);
  return Number.isFinite(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : match;
});

export type LexicalJsonNode = Record<string, unknown> & {
  type: string;
  version?: number;
  children?: LexicalJsonNode[];
};

export type LexicalJsonDocument = {
  root: LexicalJsonNode & { type: "root"; children: LexicalJsonNode[] };
};

export const emptyLexicalDocument: LexicalJsonDocument = {
  root: { type: "root", version: 1, children: [] },
};

const sanitizeLexicalNode = (value: LexicalJsonNode, checklistIds: Set<string>): LexicalJsonNode => {
  if (value.type === "list" && value.listType === "check") {
    return {
      type: "check-list",
      version: value.version ?? 1,
      children: (value.children ?? []).map((child) => {
        // Lexical's stock ListItemNode serializes its ordinal as `value`.
        // That field is not part of the custom checklist contract.
        const stockItem = { ...child };
        delete stockItem.value;
        return sanitizeLexicalNode({
          ...stockItem,
          type: "check-listitem",
          itemId: crypto.randomUUID(),
          checked: child.checked === true,
        }, checklistIds);
      }),
    };
  }
  const node: LexicalJsonNode = { ...value };
  if (value.type === "check-listitem") {
    const originalId = typeof value.itemId === "string" ? value.itemId : "";
    const itemId = isStableChecklistItemId(originalId) && !checklistIds.has(originalId)
      ? originalId
      : crypto.randomUUID();
    checklistIds.add(itemId);
    node.itemId = itemId;
    node.checked = value.checked === true;
  }
  if (Array.isArray(value.children)) node.children = value.children.map((child) => sanitizeLexicalNode(child, checklistIds));
  return node;
};

const cloneWithFreshChecklistIds = (value: LexicalJsonNode, checklistIds: Set<string>): LexicalJsonNode => {
  const node: LexicalJsonNode = { ...value };
  if (value.type === "check-listitem") {
    let itemId = crypto.randomUUID();
    while (checklistIds.has(itemId)) itemId = crypto.randomUUID();
    checklistIds.add(itemId);
    node.itemId = itemId;
  }
  if (Array.isArray(value.children)) node.children = value.children.map((child) => cloneWithFreshChecklistIds(child, checklistIds));
  return node;
};

export const normalizeLexicalDocumentForEditor = (value: unknown): LexicalJsonDocument => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_LEXICAL_DOCUMENT");
  const input = value as { root?: unknown };
  if (!input.root || typeof input.root !== "object" || Array.isArray(input.root)) throw new Error("INVALID_LEXICAL_ROOT");
  const document = { root: sanitizeLexicalNode(input.root as LexicalJsonNode, new Set()) } as LexicalJsonDocument;
  assertPersistableLexicalDocument(document);
  if (document.root.children.length > 0) return document;
  return {
    ...document,
    root: {
      ...document.root,
      children: [{
        type: "paragraph",
        version: 1,
        children: [],
        direction: null,
        format: "",
        indent: 0,
        textFormat: 0,
        textStyle: "",
      }],
    },
  };
};

export const cloneLexicalDocumentWithFreshChecklistIds = (value: unknown): LexicalJsonDocument => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_LEXICAL_DOCUMENT");
  const input = value as { root?: unknown };
  if (!input.root || typeof input.root !== "object" || Array.isArray(input.root)) throw new Error("INVALID_LEXICAL_ROOT");
  const root = cloneWithFreshChecklistIds(input.root as LexicalJsonNode, new Set<string>());
  const document = { root } as LexicalJsonDocument;
  assertPersistableLexicalDocument(document);
  return document;
};

export const mergeChecklistCheckedState = (
  value: LexicalJsonDocument,
  itemId: string,
  checked: boolean,
): LexicalJsonDocument => {
  const visit = (node: LexicalJsonNode): LexicalJsonNode => {
    const next = { ...node };
    if (node.type === "check-listitem" && node.itemId === itemId) next.checked = checked;
    if (Array.isArray(node.children)) next.children = node.children.map(visit);
    return next;
  };
  const document = { root: visit(value.root) } as LexicalJsonDocument;
  assertPersistableLexicalDocument(document);
  return document;
};

export const normalizeLexicalDocumentForPaste = (value: unknown, existingIds = new Set<string>()): LexicalJsonDocument => {
  const normalized = normalizeLexicalDocumentForEditor(value);
  const root = cloneWithFreshChecklistIds(normalized.root, new Set(existingIds));
  const document = { root } as LexicalJsonDocument;
  assertPersistableLexicalDocument(document);
  return document;
};

export const isStableChecklistItemId = (value: unknown): value is string =>
  typeof value === "string" && UUID_PATTERN.test(value);

export const isSafeNoteUrl = (url: string): boolean => {
  if (typeof url !== "string" || url.length === 0 || url.startsWith("//")) return false;
  const decoded = decodeLinkEntities(url);
  const canonical = decoded.replace(/[\u0000-\u0020\u007f]/g, "").trim();
  if (!canonical || canonical.startsWith("//")) return false;
  if (canonical.startsWith("/notes/")) return INTERNAL_NOTE_PATTERN.test(canonical);
  if (URI_NOTE_PATTERN.test(canonical)) return true;
  const scheme = canonical.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  if (scheme) return scheme === "http" || scheme === "https" || scheme === "mailto";
  // Relative references are valid, but entities/control characters must not
  // be allowed to smuggle a scheme into the prefix.
  const rawPrefix = url.split(/[\/?#]/, 1)[0] ?? url;
  if (/[\u0000-\u0020\u007f]/.test(rawPrefix) || /&(?:#x0*3a|#0*58|colon);/i.test(rawPrefix)) return false;
  return true;
};

export const safeNoteHref = (url: string): string => {
  if (!isSafeNoteUrl(url)) return "#";
  const internalUri = url.match(URI_NOTE_PATTERN);
  return internalUri ? `/notes/${internalUri[1]}` : url;
};

export const createChecklistBlock = (
  text = "",
  uuid: () => string = () => crypto.randomUUID(),
): LexicalJsonNode => {
  const itemId = uuid();
  if (!isStableChecklistItemId(itemId)) throw new Error("INVALID_CHECKLIST_ITEM_ID");
  return {
    type: "check-list",
    version: 1,
    children: [{
      type: "check-listitem",
      version: 1,
      itemId,
      checked: false,
      children: [{ type: "text", version: 1, text }],
    }],
  };
};

const COMMON_ELEMENT_FIELDS = ["type", "version", "children", "direction", "format", "indent"];
const SUPPORTED_ELEMENT_FIELDS = COMMON_ELEMENT_FIELDS.concat("textFormat", "textStyle");
const ELEMENT_FORMATS = new Set(["", "left", "center", "right", "justify", "start", "end"]);
const ALLOWED_FIELDS: Record<string, ReadonlySet<string>> = {
  root: new Set(SUPPORTED_ELEMENT_FIELDS),
  paragraph: new Set(SUPPORTED_ELEMENT_FIELDS),
  heading: new Set(SUPPORTED_ELEMENT_FIELDS.concat("tag")),
  quote: new Set(SUPPORTED_ELEMENT_FIELDS),
  code: new Set(SUPPORTED_ELEMENT_FIELDS.concat("language", "theme")),
  link: new Set(SUPPORTED_ELEMENT_FIELDS.concat("url", "target", "rel", "title")),
  list: new Set(SUPPORTED_ELEMENT_FIELDS.concat("listType", "start", "tag")),
  listitem: new Set(SUPPORTED_ELEMENT_FIELDS.concat("value")),
  "check-list": new Set(SUPPORTED_ELEMENT_FIELDS),
  "check-listitem": new Set(SUPPORTED_ELEMENT_FIELDS.concat("itemId", "checked")),
  text: new Set(["type", "version", "text", "detail", "format", "mode", "style"]),
  linebreak: new Set(["type", "version"]),
};

export const assertPersistableLexicalDocument = (value: unknown): true => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_LEXICAL_DOCUMENT");
  const root = (value as { root?: unknown }).root;
  if (!root || typeof root !== "object" || Array.isArray(root) || (root as { type?: unknown }).type !== "root") {
    throw new Error("INVALID_LEXICAL_ROOT");
  }
  const checklistIds = new Set<string>();
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const candidate = stack.pop();
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("INVALID_LEXICAL_NODE");
    const node = candidate as Record<string, unknown>;
    const type = node.type;
    if (typeof type !== "string" || !ALLOWED_FIELDS[type]) throw new Error("UNSUPPORTED_NODE_TYPE");
    if (Object.hasOwn(node, "direction") && node.direction !== undefined && node.direction !== null && node.direction !== "ltr" && node.direction !== "rtl") throw new Error("INVALID_LEXICAL_DIRECTION");
    if (Object.hasOwn(node, "format") && (type === "text"
      ? (typeof node.format !== "number" || !Number.isInteger(node.format) || node.format < 0)
      : (typeof node.format !== "string" || !ELEMENT_FORMATS.has(node.format)))) throw new Error("INVALID_LEXICAL_FORMAT");
    if (Object.hasOwn(node, "textFormat") && (typeof node.textFormat !== "number" || !Number.isInteger(node.textFormat) || node.textFormat < 0)) throw new Error("INVALID_LEXICAL_TEXT_FORMAT");
    if (Object.hasOwn(node, "textStyle") && typeof node.textStyle !== "string") throw new Error("INVALID_LEXICAL_TEXT_STYLE");
    if (type === "text" && Object.hasOwn(node, "mode") && node.mode !== "normal" && node.mode !== "token" && node.mode !== "segmented") throw new Error("INVALID_LEXICAL_MODE");
    if (type === "list" && node.listType === "check") throw new Error("STANDARD_CHECKLIST_NOT_PERSISTABLE");
    if (type === "listitem" && Object.hasOwn(node, "checked")) throw new Error("STANDARD_CHECKLIST_NOT_PERSISTABLE");
    for (const key of Object.keys(node)) {
      if (!ALLOWED_FIELDS[type]!.has(key)) throw new Error("UNSUPPORTED_NODE_FIELD");
    }
    if (type === "check-listitem") {
      if (!isStableChecklistItemId(node.itemId)) throw new Error("INVALID_CHECKLIST_ITEM_ID");
      if (checklistIds.has(node.itemId)) throw new Error("DUPLICATE_CHECKLIST_ITEM_ID");
      checklistIds.add(node.itemId);
      if (typeof node.checked !== "boolean") throw new Error("INVALID_CHECKLIST_STATE");
    }
    if (type === "link") {
      if (typeof node.url !== "string" || !isSafeNoteUrl(node.url)) throw new Error("UNSAFE_NOTE_LINK");
    }
    if (Object.hasOwn(node, "children")) {
      if (!Array.isArray(node.children)) throw new Error("INVALID_LEXICAL_CHILDREN");
      for (let index = node.children.length - 1; index >= 0; index -= 1) stack.push(node.children[index]);
    }
  }
  return true;
};
