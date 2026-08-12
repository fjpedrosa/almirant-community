import { randomUUID } from "node:crypto";

export type LexicalNode = {
  type?: string;
  version?: number;
  children?: LexicalNode[];
  text?: string;
  /** Element nodes use ElementFormatType strings; text nodes use numeric bitmasks. */
  format?: number | string;
  direction?: string | null;
  indent?: number;
  textFormat?: number;
  textStyle?: string;
  detail?: number;
  mode?: string;
  style?: string;
  tag?: string;
  url?: string;
  rel?: string | null;
  target?: string | null;
  title?: string | null;
  language?: string | null;
  theme?: string;
  listType?: string;
  start?: number;
  value?: number;
  itemId?: string;
  checked?: boolean;
  [key: string]: unknown;
};

export type LexicalDocument = {
  root: LexicalNode;
};

export type ChecklistProjection = {
  itemId: string;
  ordinal: number;
  text: string;
  checked: boolean;
};

export type LinkProjection = {
  targetPageId: string;
  ordinal: number;
  text: string;
};

export type ChecklistCompletionTransition = {
  itemId: string;
  checked: boolean;
  completedAt: Date | null;
};

export type LexicalValidation = {
  valid: boolean;
  errors: string[];
};

// Bounds keep validation/rendering safe for untrusted editor payloads.
const MAX_LEXICAL_DEPTH = 64;
const MAX_LEXICAL_NODES = 10_000;
const MAX_LEXICAL_TEXT_BYTES = 1_000_000;
const MAX_ORDERED_MARKER = 999_999_999;
const MAX_LEXICAL_CHILD_SLOTS = 10_000;
const MAX_LEXICAL_FIELDS_PER_NODE = 64;
// Projection fields are persisted independently; cap each rendered field and
// aggregate checklist/link labels at 4 MiB to prevent bounded ASTs amplifying
// into unbounded Markdown/plaintext payloads.
const MAX_PROJECTED_OUTPUT_BYTES = 4 * 1024 * 1024;

const isOrderedListNode = (node: LexicalNode): boolean =>
  node.type === "list" && (node.listType === "number" || node.tag === "ol");

const ELEMENT_FORMATS = new Set(["", "left", "center", "right", "justify", "start", "end"]);
const ELEMENT_LEXICAL_FIELDS = new Set(["type", "version", "children", "direction", "format", "indent", "textFormat", "textStyle"]);
const ROOT_LEXICAL_FIELDS = new Set([...ELEMENT_LEXICAL_FIELDS]);
const PARAGRAPH_LEXICAL_FIELDS = new Set([...ELEMENT_LEXICAL_FIELDS]);
const TEXT_LEXICAL_FIELDS = new Set(["type", "version", "text", "format", "detail", "mode", "style"]);

const LEXICAL_FIELDS_BY_TYPE: Record<string, Set<string>> = {
  root: ROOT_LEXICAL_FIELDS,
  paragraph: PARAGRAPH_LEXICAL_FIELDS,
  text: TEXT_LEXICAL_FIELDS,
  link: new Set([...ELEMENT_LEXICAL_FIELDS, "url", "rel", "target", "title"]),
  "check-listitem": new Set([...ELEMENT_LEXICAL_FIELDS, "itemId", "checked"]),
  list: new Set([...ELEMENT_LEXICAL_FIELDS, "listType", "start", "tag"]),
  listitem: new Set([...ELEMENT_LEXICAL_FIELDS, "value", "checked"]),
  "check-list": ELEMENT_LEXICAL_FIELDS,
  heading: new Set([...ELEMENT_LEXICAL_FIELDS, "tag"]),
  code: new Set([...ELEMENT_LEXICAL_FIELDS, "language", "theme"]),
  linebreak: new Set(["type", "version"]),
  quote: ELEMENT_LEXICAL_FIELDS,
};

class LexicalBoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LexicalBoundError";
  }
}

export type LexicalProjection = {
  markdown: string;
  plaintext: string;
  checklist: ChecklistProjection[];
  links: LinkProjection[];
  completionTransitions: ChecklistCompletionTransition[];
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const noteTargetFromUrl = (url: string): string | null => {
  const match = url.match(/^(?:note:\/\/|notes:\/\/|\/notes\/)([0-9a-f-]{36})$/);
  return match && UUID_PATTERN.test(match[1]!) ? match[1]! : null;
};

const MARKDOWN_ESCAPABLE = new Set(["*", "_", "~", "`", "[", "]", "(", ")", "<", ">", "|"]);
const markdownUtf8Bytes = (value: string): number => new TextEncoder().encode(value).byteLength;
const isAsciiHorizontalWhitespace = (character: string | undefined): boolean =>
  character === " " || character === "\t";
const isInlineDelimiterBoundaryWhitespace = (character: string | undefined): boolean =>
  character !== undefined && /[\t\n\f\r\p{Zs}]/u.test(character);
const isAsciiDigit = (character: string | undefined): boolean =>
  character !== undefined && character >= "0" && character <= "9";

type MarkdownLineShape = {
  leadingEnd: number;
  escapeStart: number;
  escapeEnd: number;
  encodedTrailingStart: number;
};

/** Analyze one line with the same ASCII-only CommonMark rules used to render it. */
const markdownLineShape = (line: string): MarkdownLineShape => {
  let leadingEnd = 0;
  while (leadingEnd < line.length && isAsciiHorizontalWhitespace(line[leadingEnd])) leadingEnd += 1;
  let escapeStart = -1;
  let escapeEnd = -1;
  let encodedTrailingStart = line.length;

  const marker = line[leadingEnd];
  if (marker === "-" || marker === "=") {
    let markerEnd = leadingEnd;
    while (line[markerEnd] === marker) markerEnd += 1;
    let trailingEnd = markerEnd;
    while (trailingEnd < line.length && isAsciiHorizontalWhitespace(line[trailingEnd])) trailingEnd += 1;
    if (markerEnd > leadingEnd && trailingEnd === line.length) {
      escapeStart = leadingEnd;
      escapeEnd = leadingEnd + 1;
      encodedTrailingStart = markerEnd;
      return { leadingEnd, escapeStart, escapeEnd, encodedTrailingStart };
    }
  }

  let digitsEnd = leadingEnd;
  while (isAsciiDigit(line[digitsEnd])) digitsEnd += 1;
  if (
    digitsEnd > leadingEnd &&
    (line[digitsEnd] === "." || line[digitsEnd] === ")") &&
    isAsciiHorizontalWhitespace(line[digitsEnd + 1])
  ) {
    escapeStart = digitsEnd;
    escapeEnd = digitsEnd + 1;
    return { leadingEnd, escapeStart, escapeEnd, encodedTrailingStart };
  }

  let hashEnd = leadingEnd;
  while (line[hashEnd] === "#") hashEnd += 1;
  if (
    hashEnd - leadingEnd >= 1 &&
    hashEnd - leadingEnd <= 6 &&
    (hashEnd === line.length || isAsciiHorizontalWhitespace(line[hashEnd]))
  ) {
    escapeStart = leadingEnd;
    escapeEnd = hashEnd;
  } else if (
    ["#", ">", "+", "-"].includes(line[leadingEnd] ?? "") &&
    isAsciiHorizontalWhitespace(line[leadingEnd + 1])
  ) {
    escapeStart = leadingEnd;
    escapeEnd = leadingEnd + 1;
  }
  return { leadingEnd, escapeStart, escapeEnd, encodedTrailingStart };
};

const isEntityStart = (value: string, index: number): boolean => {
  if (value[index] !== "&") return false;
  let cursor = index + 1;
  if (cursor >= value.length) return false;
  while (cursor < value.length && value[cursor] !== ";") {
    const character = value[cursor]!;
    if (!(character === "#" || isAsciiDigit(character) || (character >= "A" && character <= "Z") || (character >= "a" && character <= "z"))) return false;
    cursor += 1;
  }
  return cursor > index + 1 && value[cursor] === ";";
};

const forEachMarkdownLine = (
  value: string,
  visitor: (line: string, lineEnding: string) => void,
): void => {
  let start = 0;
  while (start < value.length) {
    let end = start;
    while (end < value.length && value[end] !== "\r" && value[end] !== "\n") end += 1;
    let lineEnding = "";
    if (value[end] === "\r" && value[end + 1] === "\n") lineEnding = "\r\n";
    else if (value[end] === "\r" || value[end] === "\n") lineEnding = value[end]!;
    visitor(value.slice(start, end), lineEnding);
    start = end + lineEnding.length;
  }
  if (value.length === 0) visitor("", "");
};

/** Exact UTF-8 preflight for {@link escapeMarkdownText}; it allocates no projection. */
const estimateEscapedMarkdownBytes = (value: string): number => {
  let bytes = 0;
  forEachMarkdownLine(value, (line, lineEnding) => {
    const shape = markdownLineShape(line);
    for (let index = 0; index < line.length;) {
      const codePoint = line.codePointAt(index)!;
      const character = String.fromCodePoint(codePoint);
      const width = character.length;
      if (
        (index < shape.leadingEnd || index >= shape.encodedTrailingStart) &&
        isAsciiHorizontalWhitespace(character)
      ) {
        bytes += character === "\t" ? 4 : 5;
      } else {
        if (
          (index >= shape.escapeStart && index < shape.escapeEnd) ||
          character === "\\" ||
          MARKDOWN_ESCAPABLE.has(character) ||
          isEntityStart(line, index)
        ) bytes += 1;
        bytes += markdownUtf8Bytes(character);
      }
      index += width;
    }
    bytes += markdownUtf8Bytes(lineEnding);
  });
  return bytes;
};

const escapeMarkdownText = (value: string): string => {
  const predictedBytes = estimateEscapedMarkdownBytes(value);
  if (predictedBytes > MAX_PROJECTED_OUTPUT_BYTES) {
    throw new Error(`OUTPUT_TOO_LARGE: Lexical Markdown projection exceeds maximum projected output of ${MAX_PROJECTED_OUTPUT_BYTES} bytes`);
  }
  let output = "";
  forEachMarkdownLine(value, (line, lineEnding) => {
    const shape = markdownLineShape(line);
    for (let index = 0; index < line.length;) {
      const codePoint = line.codePointAt(index)!;
      const character = String.fromCodePoint(codePoint);
      const width = character.length;
      if (
        (index < shape.leadingEnd || index >= shape.encodedTrailingStart) &&
        isAsciiHorizontalWhitespace(character)
      ) {
        output += character === "\t" ? "&#9;" : "&#32;";
      } else {
        if (
          (index >= shape.escapeStart && index < shape.escapeEnd) ||
          character === "\\" ||
          MARKDOWN_ESCAPABLE.has(character) ||
          isEntityStart(line, index)
        ) output += "\\";
        output += character;
      }
      index += width;
    }
    output += lineEnding;
  });
  return output;
};

const assertProjectedOutput = (value: string, projection: "Markdown" | "plaintext"): void => {
  if (value.length > MAX_PROJECTED_OUTPUT_BYTES || new TextEncoder().encode(value).byteLength > MAX_PROJECTED_OUTPUT_BYTES) {
    throw new Error(`OUTPUT_TOO_LARGE: Lexical ${projection} projection exceeds maximum projected output of ${MAX_PROJECTED_OUTPUT_BYTES} bytes`);
  }
};

const assertProjectedAmplification = (base: string, newlineCount: number, prefix: string, projection: "Markdown" | "plaintext"): void => {
  const predictedBytes = projectedByteLength(base) + (newlineCount + 1) * projectedByteLength(prefix);
  if (predictedBytes > MAX_PROJECTED_OUTPUT_BYTES) {
    throw new Error(`OUTPUT_TOO_LARGE: Lexical ${projection} projection exceeds maximum projected output of ${MAX_PROJECTED_OUTPUT_BYTES} bytes`);
  }
};

const assertProjectedLength = (length: number, projection: "Markdown" | "plaintext"): void => {
  if (length > MAX_PROJECTED_OUTPUT_BYTES) {
    throw new Error(`OUTPUT_TOO_LARGE: Lexical ${projection} projection exceeds maximum projected output of ${MAX_PROJECTED_OUTPUT_BYTES} bytes`);
  }
};

const projectedByteLength = (value: string): number => new TextEncoder().encode(value).byteLength;

/** Join only after proving the joined output fits the bound. */
const joinProjected = (values: string[], separator: string, projection: "Markdown" | "plaintext"): string => {
  let bytes = Math.max(0, values.length - 1) * projectedByteLength(separator);
  for (const value of values) {
    bytes += projectedByteLength(value);
    if (bytes > MAX_PROJECTED_OUTPUT_BYTES) {
      throw new Error(`OUTPUT_TOO_LARGE: Lexical ${projection} projection exceeds maximum projected output of ${MAX_PROJECTED_OUTPUT_BYTES} bytes`);
    }
  }
  return values.join(separator);
};

/** Prefix lines only after proving indentation cannot amplify past the bound. */
const indentProjectedLines = (value: string, prefix: string, projection: "Markdown" | "plaintext"): string => {
  let newlineCount = 0;
  for (const character of value) if (character === "\n") newlineCount += 1;
  assertProjectedAmplification(value, newlineCount, prefix, projection);
  const lines = value.split("\n").map((line) => joinProjected([prefix, line], "", projection));
  return joinProjected(lines, "\n", projection);
};

const maxBacktickRun = (value: string): number => {
  let maxRun = 0;
  for (const match of value.matchAll(/`+/g)) maxRun = Math.max(maxRun, match[0].length);
  return maxRun;
};

const inlineCode = (value: string): string => {
  const maxRun = maxBacktickRun(value);
  const fence = "`".repeat(Math.max(1, maxRun + 1));
  return joinProjected([fence, " ", value, " ", fence], "", "Markdown");
};

const encodedBoundaryBytes = (value: string, start: number, end: number): number => {
  let bytes = 0;
  for (let index = start; index < end; index += 1) {
    const character = value[index]!;
    bytes += character === " " ? 5 : character === "\t" ? 4 : character === "\r" || character === "\n" ? 5 : markdownUtf8Bytes(character);
  }
  return bytes;
};

const estimateFormattedMarkdownBytes = (value: string, bits: number): number => {
  let start = 0;
  while (start < value.length && isInlineDelimiterBoundaryWhitespace(value[start])) start += 1;
  let end = value.length;
  while (end > start && isInlineDelimiterBoundaryWhitespace(value[end - 1])) end -= 1;
  const leading = encodedBoundaryBytes(value, 0, start);
  const trailing = encodedBoundaryBytes(value, end, value.length);
  if (start === value.length) return leading;
  const core = value.slice(start, end);
  if (bits & 16) {
    const fenceLength = Math.max(1, maxBacktickRun(core) + 1);
    return leading + trailing + markdownUtf8Bytes(core) + fenceLength * 2 + 2;
  }
  const wrappers = (bits & 4 ? 4 : 0) + (bits & 2 ? 2 : 0) + (bits & 1 ? 4 : 0);
  return leading + trailing + estimateEscapedMarkdownBytes(core) + wrappers;
};

const encodeBoundaryWhitespace = (boundary: string): string => {
  let output = "";
  for (const character of boundary) {
    if (character === " ") output += "&#32;";
    else if (character === "\t") output += "&#9;";
    else if (character === "\r") output += "&#13;";
    else if (character === "\n") output += "&#10;";
    else output += character;
  }
  return output;
};

const withBoundaryWhitespace = (value: string, render: (core: string) => string): string => {
  let start = 0;
  while (start < value.length && isInlineDelimiterBoundaryWhitespace(value[start])) start += 1;
  let end = value.length;
  while (end > start && isInlineDelimiterBoundaryWhitespace(value[end - 1])) end -= 1;
  if (start === value.length) return encodeBoundaryWhitespace(value);
  return joinProjected(
    [
      encodeBoundaryWhitespace(value.slice(0, start)),
      render(value.slice(start, end)),
      encodeBoundaryWhitespace(value.slice(end)),
    ],
    "",
    "Markdown",
  );
};

const formatMarkdownText = (value: string, format: number | string | undefined): string => {
  const bits = typeof format === "number" ? format : Number(format) || 0;
  if (!bits) return escapeMarkdownText(value);
  if (estimateFormattedMarkdownBytes(value, bits) > MAX_PROJECTED_OUTPUT_BYTES) {
    throw new Error(`OUTPUT_TOO_LARGE: Lexical Markdown projection exceeds maximum projected output of ${MAX_PROJECTED_OUTPUT_BYTES} bytes`);
  }
  return withBoundaryWhitespace(value, (core) => {
    if (bits & 16) return inlineCode(core);
    let output = escapeMarkdownText(core);
    if (bits & 4) output = joinProjected(["~~", output, "~~"], "", "Markdown");
    if (bits & 2) output = joinProjected(["*", output, "*"], "", "Markdown");
    if (bits & 1) output = joinProjected(["**", output, "**"], "", "Markdown");
    return output;
  });
};

const NAMED_LINK_ENTITIES: Record<string, string> = {
  colon: ":",
  amp: "&",
  tab: "\t",
  newline: "\n",
  newLine: "\n",
  cr: "\r",
  space: " ",
};

const decodeLinkEntities = (url: string): string => url.replace(/&(?:#x([0-9a-f]+)|#([0-9]+)|([A-Za-z][A-Za-z0-9]+));/gi, (match, hex: string | undefined, decimal: string | undefined, name: string | undefined) => {
  if (name) return NAMED_LINK_ENTITIES[name.toLowerCase()] ?? match;
  const value = Number.parseInt(hex ?? decimal!, hex ? 16 : 10);
  return Number.isFinite(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : match;
});

const canonicalLinkUrl = (url: string): string => decodeLinkEntities(url).replace(/[\u0000-\u0020\u007f]/g, "").trim();
const isSafeExternalUrl = (url: string): boolean => {
  const decodedForShape = decodeLinkEntities(url);
  const canonical = canonicalLinkUrl(url).toLowerCase();
  const scheme = canonical.match(/^([a-z][a-z0-9+.-]*):/)?.[1];
  if (!scheme) {
    // A non-scheme prefix is a relative reference, including literal `&` or
    // `;` characters. Only entity/control obfuscation in that would-be prefix
    // is rejected; query/path payloads are intentionally not inspected.
    const decodedColon = decodedForShape.indexOf(":");
    const relativeDelimiter = decodedForShape.search(/[\/?#]/);
    if (relativeDelimiter >= 0 && (decodedColon < 0 || relativeDelimiter < decodedColon)) return true;
    const rawColonIndex = url.search(/:|&(?:#x0*3a|#0*58|colon);/i);
    const rawPrefix = rawColonIndex >= 0 ? url.slice(0, rawColonIndex) : url;
    if (/[\u0000-\u0020\u007f]/.test(rawPrefix)) return false;
    return true;
  }
  // Query/path delimiters before a colon make the destination relative even
  // when a later query value contains an absolute URL.
  const relativeDelimiter = decodedForShape.search(/[\/?#]/);
  const schemeEnd = decodedForShape.indexOf(":");
  if (relativeDelimiter >= 0 && relativeDelimiter < schemeEnd) return true;
  // Do not permit entity/whitespace/control obfuscation in a valid scheme
  // prefix. Query and path entities after the colon remain valid.
  const rawSchemeRegion = url.match(/^(?:(?:&(?:#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]+);)|[^:])*?(?::|&(?:#x0*3a|#0*58|colon);)/i)?.[0] ?? url;
  if (/&(?:#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]+);|[\u0000-\u0020\u007f]/i.test(rawSchemeRegion)) return false;
  return !scheme || scheme === "http" || scheme === "https" || scheme === "mailto";
};

const sanitizeExternalDestination = (url: string): string => url
  .replace(/\r/g, "%0D")
  .replace(/\n/g, "%0A")
  .replace(/ /g, "%20")
  .replace(/</g, "%3C")
  .replace(/>/g, "%3E")
  .replace(/\\/g, "%5C");

const validateLexicalDocumentSnapshot = (
  document: unknown,
): LexicalValidation => {
  const errors: string[] = [];
  if (!document || typeof document !== "object") {
    return { valid: false, errors: ["document must be an object"] };
  }
  const root = (document as { root?: unknown }).root;
  if (!root || typeof root !== "object") {
    return { valid: false, errors: ["document.root must be an object"] };
  }

  const itemIds = new Set<string>();
  const supportedTypes = new Set(["root", "paragraph", "text", "link", "check-listitem", "list", "listitem", "check-list", "heading", "code", "linebreak", "quote"]);
  const containerTypes = new Set(["root", "paragraph", "link", "check-listitem", "list", "listitem", "check-list", "heading", "code", "quote"]);
  const leafTypes = new Set(["text", "linebreak"]);
  const elementFormatTypes = new Set(["root", "paragraph", "link", "check-listitem", "list", "listitem", "check-list", "heading", "code", "quote"]);
  const rootChildren = new Set(["paragraph", "heading", "quote", "code", "list", "check-list", "check-listitem"]);
  const inlineChildren = new Set(["text", "link", "linebreak"]);
  const listItemChildren = new Set(["text", "link", "linebreak", "list", "check-list", "check-listitem"]);
  const childTypes: Record<string, Set<string>> = {
    root: rootChildren,
    paragraph: inlineChildren,
    heading: inlineChildren,
    quote: inlineChildren,
    link: new Set(["text", "linebreak"]),
    code: new Set(["text", "linebreak"]),
    list: new Set(["listitem"]),
    "check-list": new Set(["check-listitem"]),
    listitem: listItemChildren,
    "check-listitem": inlineChildren,
  };
  const seenNodes = new WeakSet<object>();
  let nodeCount = 0;
  let textBytes = 0;
  const walk = (node: LexicalNode, path: string, depth = 0): void => {
    if (!node || typeof node !== "object") {
      errors.push(`${path} must be an object`);
      return;
    }
    if (seenNodes.has(node)) throw new LexicalBoundError(`${path} is cyclic`);
    seenNodes.add(node);
    nodeCount += 1;
    if (nodeCount > MAX_LEXICAL_NODES) throw new LexicalBoundError(`Lexical document exceeds maximum node count of ${MAX_LEXICAL_NODES}`);
    if (depth > MAX_LEXICAL_DEPTH) throw new LexicalBoundError(`Lexical document exceeds maximum depth of ${MAX_LEXICAL_DEPTH}`);
    if (typeof node.type !== "string") {
      errors.push(`${path}.type must be a string`);
      return;
    }
    if (!supportedTypes.has(node.type)) {
      errors.push(`${path}.type is unsupported`);
      return;
    }
    if (path === "root" && node.type !== "root") {
      errors.push("document.root.type must be 'root'");
    }
    if (node.type === "text") {
      if (typeof node.text !== "string") errors.push(`${path}.text must be a string`);
      else {
        textBytes += new TextEncoder().encode(node.text).byteLength;
        if (textBytes > MAX_LEXICAL_TEXT_BYTES) throw new LexicalBoundError(`Lexical document exceeds maximum text bytes of ${MAX_LEXICAL_TEXT_BYTES}`);
      }
      if (node.format !== undefined && (typeof node.format !== "number" || !Number.isFinite(node.format) || !Number.isInteger(node.format) || node.format < 0)) {
        errors.push(`${path}.format must be a finite numeric bitmask`);
      }
    }
    if (elementFormatTypes.has(node.type) && node.format !== undefined && (typeof node.format !== "string" || !ELEMENT_FORMATS.has(node.format))) {
      errors.push(`${path}.format must be a valid element format`);
    }
    if (node.version !== undefined && (typeof node.version !== "number" || !Number.isInteger(node.version) || node.version < 0)) {
      errors.push(`${path}.version must be a non-negative integer`);
    }
    if (node.direction !== undefined && node.direction !== null && node.direction !== "ltr" && node.direction !== "rtl") errors.push(`${path}.direction must be 'ltr', 'rtl', or null`);
    if (node.indent !== undefined && (typeof node.indent !== "number" || !Number.isInteger(node.indent) || node.indent < 0)) errors.push(`${path}.indent must be a non-negative integer`);
    if (node.textFormat !== undefined && (typeof node.textFormat !== "number" || !Number.isInteger(node.textFormat) || node.textFormat < 0)) errors.push(`${path}.textFormat must be a non-negative integer`);
    if (node.textStyle !== undefined && typeof node.textStyle !== "string") errors.push(`${path}.textStyle must be a string`);
    if (node.detail !== undefined && (typeof node.detail !== "number" || !Number.isInteger(node.detail) || node.detail < 0)) errors.push(`${path}.detail must be a non-negative integer`);
    if (node.mode !== undefined && node.mode !== "normal" && node.mode !== "token" && node.mode !== "segmented") errors.push(`${path}.mode must be 'normal', 'token', or 'segmented'`);
    if (node.style !== undefined && typeof node.style !== "string") errors.push(`${path}.style must be a string`);
    if (containerTypes.has(node.type) && !Array.isArray(node.children)) {
      errors.push(`${path}.children must be an array`);
      return;
    }
    if (node.children !== undefined && !Array.isArray(node.children)) {
      errors.push(`${path}.children must be an array`);
      return;
    }
    if (leafTypes.has(node.type) && node.children !== undefined) {
      errors.push(`${path}.children is not allowed on ${node.type}`);
      return;
    }
    if (node.type === "check-listitem") {
      if (typeof node.itemId !== "string" || !UUID_PATTERN.test(node.itemId)) {
        errors.push(`${path}.itemId must be a lowercase canonical UUID`);
      } else if (itemIds.has(node.itemId)) {
        errors.push(`${path}.itemId is duplicated`);
      } else {
        itemIds.add(node.itemId);
      }
      if (typeof node.checked !== "boolean") {
        errors.push(`${path}.checked must be boolean`);
      }
    }
    if (node.type === "link") {
      if (typeof node.url !== "string") {
        errors.push(`${path}.url must be a string`);
      }
      for (const field of ["rel", "target", "title"] as const) {
        if (node[field] !== undefined && node[field] !== null && typeof node[field] !== "string") errors.push(`${path}.${field} must be a string or null`);
      }
      const target = typeof node.url === "string" ? noteTargetFromUrl(node.url) : null;
      if (typeof node.url === "string" && /^(?:note:\/\/|notes:\/\/|\/notes\/)/.test(node.url) && !target) {
        errors.push(`${path}.url must contain a valid note UUID`);
      }
      if (typeof node.url === "string" && !target && !isSafeExternalUrl(node.url)) errors.push(`${path}.url uses an unsafe scheme`);
    }
    if (node.type === "list") {
      if (node.listType === "check") {
        errors.push(`${path}.listType 'check' requires custom check-list/check-listitem nodes with stable itemId`);
      } else if (node.listType !== undefined && node.listType !== "bullet" && node.listType !== "number") {
        errors.push(`${path}.listType must be 'bullet' or 'number'`);
      }
      if (node.tag !== undefined && node.tag !== "ul" && node.tag !== "ol") errors.push(`${path}.tag must be 'ul' or 'ol'`);
      if (node.listType === "bullet" && node.tag === "ol") errors.push(`${path} listType 'bullet' conflicts with tag 'ol'`);
      if (node.listType === "number" && node.tag === "ul") errors.push(`${path} listType 'number' conflicts with tag 'ul'`);
      if (node.start !== undefined && (typeof node.start !== "number" || !Number.isInteger(node.start))) errors.push(`${path}.start must be an integer`);
      else if (typeof node.start === "number" && (node.start < 0 || node.start > MAX_ORDERED_MARKER)) errors.push(`${path}.start must be between 0 and ${MAX_ORDERED_MARKER}`);
      if (isOrderedListNode(node)) {
        let next = typeof node.start === "number" && Number.isInteger(node.start) && node.start >= 0 && node.start <= MAX_ORDERED_MARKER ? node.start : 1;
        for (const [index, child] of (Array.isArray(node.children) ? node.children : []).entries()) {
          if (!child || typeof child !== "object" || (child as LexicalNode).type !== "listitem") continue;
          const childPath = `${path}.children[${index}]`;
          const explicit = (child as LexicalNode).value !== undefined;
          const value = explicit ? (child as LexicalNode).value : next;
          if (!explicit && typeof value === "number" && Number.isInteger(value) && (value < 0 || value > MAX_ORDERED_MARKER)) errors.push(`${childPath}.value overflows ordered marker range`);
          if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_ORDERED_MARKER) next = value + 1;
        }
      }
    }
    if (node.type === "listitem" && node.value !== undefined) {
      if (typeof node.value !== "number" || !Number.isInteger(node.value)) errors.push(`${path}.value must be an integer`);
      else if (node.value < 0 || node.value > MAX_ORDERED_MARKER) errors.push(`${path}.value must be between 0 and ${MAX_ORDERED_MARKER}`);
    }
    if (node.type === "listitem" && node.checked !== undefined) {
      errors.push(`${path}.checked requires custom check-list/check-listitem nodes with stable itemId`);
    }
    if (node.type === "heading" && (typeof node.tag !== "string" || !/^h[1-6]$/.test(node.tag))) {
      errors.push(`${path}.tag must be a heading tag h1-h6`);
    }
    if (node.type === "code" && node.language !== undefined && node.language !== null && typeof node.language !== "string") {
      errors.push(`${path}.language must be a string or null`);
    }
    if (node.type === "code" && node.theme !== undefined && typeof node.theme !== "string") {
      errors.push(`${path}.theme must be a string`);
    }
    let nestedListSeen = false;
    for (const [index, child] of (Array.isArray(node.children) ? node.children : []).entries()) {
      const childPath = `${path}.children[${index}]`;
      if (child && typeof child === "object" && typeof (child as LexicalNode).type === "string") {
        const allowed = childTypes[node.type];
        if (allowed && !allowed.has((child as LexicalNode).type!)) {
          errors.push(`${childPath}.type '${(child as LexicalNode).type}' is not allowed under ${node.type}`);
        }
        const childType = (child as LexicalNode).type!;
        const nestedList = childType === "list" || childType === "check-list";
        if (node.type === "listitem") {
          if (nestedList && nestedListSeen) errors.push(`${childPath} nested list may appear only once`);
          if (nestedList) nestedListSeen = true;
          else if (nestedListSeen) errors.push(`${childPath} nested list must be terminal`);
        }
      }
      walk(child!, childPath, depth + 1);
    }
  };
  try {
    walk(root as LexicalNode, "root");
  } catch (error) {
    if (error instanceof LexicalBoundError) return { valid: false, errors: [error.message] };
    throw error;
  }
  return { valid: errors.length === 0, errors };
};

class LexicalSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LexicalSnapshotError";
  }
}

/**
 * Reads the caller's Lexical graph once into bounded plain data. This runs
 * before any asynchronous repository lock and deliberately does not clone
 * unknown object graphs, which prevents accessor/unknown-field bombs from
 * forcing an unbounded structuredClone.
 */
export const snapshotLexicalDocument = (document: unknown): LexicalDocument => {
  if (!document || typeof document !== "object") throw new LexicalSnapshotError("document must be an object");
  const source = document as Record<string, unknown>;
  try {
    const prototype = Object.getPrototypeOf(source);
    if (prototype !== Object.prototype && prototype !== null) throw new LexicalSnapshotError("document must be a plain object");
  } catch (error) {
    if (error instanceof LexicalSnapshotError) throw error;
    throw new LexicalSnapshotError("document prototype could not be read");
  }
  let wrapperKeys: string[];
  try {
    wrapperKeys = Object.keys(source);
  } catch {
    throw new LexicalSnapshotError("document fields could not be read");
  }
  for (const key of wrapperKeys) {
    if (key !== "root") throw new LexicalSnapshotError(`document.${key} is unsupported`);
  }
  let rootValue: unknown;
  try {
    rootValue = source.root;
  } catch {
    throw new LexicalSnapshotError("document.root could not be read");
  }
  if (!rootValue || typeof rootValue !== "object") throw new LexicalSnapshotError("document.root must be an object");
  const seen = new WeakSet<object>();
  let nodeCount = 0;
  let childSlots = 0;
  let textBytes = 0;
  const encoder = new TextEncoder();
  const addTextBytes = (value: string) => {
    const remaining = MAX_LEXICAL_TEXT_BYTES - textBytes;
    // Reject obviously oversized strings before TextEncoder allocates a large
    // buffer. Values near the bound are encoded once to account for UTF-8.
    if (value.length > remaining + 1) {
      throw new LexicalSnapshotError(`Lexical document exceeds maximum text bytes of ${MAX_LEXICAL_TEXT_BYTES}`);
    }
    const encodedLength = encoder.encode(value).byteLength;
    textBytes += encodedLength;
    if (textBytes > MAX_LEXICAL_TEXT_BYTES) {
      throw new LexicalSnapshotError(`Lexical document exceeds maximum text bytes of ${MAX_LEXICAL_TEXT_BYTES}`);
    }
  };

  const cloneNode = (nodeValue: unknown, path: string, depth: number): LexicalNode => {
    nodeCount += 1;
    if (nodeCount > MAX_LEXICAL_NODES) throw new LexicalSnapshotError(`Lexical document exceeds maximum node count of ${MAX_LEXICAL_NODES}`);
    if (depth > MAX_LEXICAL_DEPTH) throw new LexicalSnapshotError(`Lexical document exceeds maximum depth of ${MAX_LEXICAL_DEPTH}`);
    if (!nodeValue || typeof nodeValue !== "object") throw new LexicalSnapshotError(`${path} must be an object`);
    if (seen.has(nodeValue)) throw new LexicalSnapshotError(`${path} is cyclic`);
    seen.add(nodeValue);
    const sourceNode = nodeValue as Record<string, unknown>;
    let nodeType: unknown;
    try {
      nodeType = sourceNode.type;
      const prototype = Object.getPrototypeOf(sourceNode);
      if (prototype !== Object.prototype && prototype !== null) throw new LexicalSnapshotError(`${path} must be a plain object`);
    } catch (error) {
      if (error instanceof LexicalSnapshotError) throw error;
      throw new LexicalSnapshotError(`${path} prototype could not be read`);
    }
    if (typeof nodeType !== "string") throw new LexicalSnapshotError(`${path}.type must be a string`);
    const allowedFields = LEXICAL_FIELDS_BY_TYPE[nodeType] ?? new Set(["type"]);
    let keys: string[];
    try {
      keys = Object.keys(sourceNode);
    } catch {
      throw new LexicalSnapshotError(`${path} fields could not be read`);
    }
    if (keys.length > MAX_LEXICAL_FIELDS_PER_NODE) throw new LexicalSnapshotError(`Lexical document exceeds maximum fields per node of ${MAX_LEXICAL_FIELDS_PER_NODE}`);
    const result: LexicalNode = { type: nodeType };
    for (const key of keys) {
      if (key === "type") continue;
      let value: unknown;
      try {
        value = sourceNode[key];
      } catch {
        throw new LexicalSnapshotError(`${path}.${key} could not be read`);
      }
      if (key === "children") {
        let isArray = false;
        try {
          isArray = Array.isArray(value);
        } catch {
          throw new LexicalSnapshotError(`${path}.children must be an array`);
        }
        if (!isArray) {
          throw new LexicalSnapshotError(`${path}.children must be an array`);
        }
        try {
          const prototype = Object.getPrototypeOf(value);
          if (prototype !== Array.prototype) throw new LexicalSnapshotError(`${path}.children must be a plain array`);
        } catch (error) {
          if (error instanceof LexicalSnapshotError) throw error;
          throw new LexicalSnapshotError(`${path}.children prototype could not be read`);
        }
        let length: number;
        try {
          length = (value as unknown[]).length;
        } catch {
          throw new LexicalSnapshotError(`${path}.children must be an array`);
        }
        childSlots += length;
        if (childSlots > MAX_LEXICAL_CHILD_SLOTS) throw new LexicalSnapshotError(`Lexical document exceeds maximum child slots of ${MAX_LEXICAL_CHILD_SLOTS}`);
        const children: LexicalNode[] = [];
        for (let index = 0; index < length; index += 1) {
          let child: unknown;
          try {
            child = (value as unknown[])[index];
          } catch {
            throw new LexicalSnapshotError(`${path}.children[${index}] could not be read`);
          }
          children.push(cloneNode(child, `${path}.children[${index}]`, depth + 1));
        }
        result.children = children;
      } else if (!allowedFields.has(key)) {
        if (typeof value === "string") addTextBytes(value);
        throw new LexicalSnapshotError(`${path}.${key} is unsupported`);
      } else if (value && typeof value === "object") {
        throw new LexicalSnapshotError(`${path}.${key} must be a primitive field`);
      } else {
        if (value === undefined) {
          if (["version", "indent", "textFormat", "detail", "start", "value"].includes(key)) throw new LexicalSnapshotError(`${path}.${key} must be a JSON-safe integer`);
          if (key === "format") throw new LexicalSnapshotError(`${path}.${key} must be a ${nodeType === "text" ? "finite numeric bitmask" : "valid element format"}`);
          throw new LexicalSnapshotError(`${path}.${key} must be a JSON-safe value`);
        }
        if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") {
          if (key === "direction") throw new LexicalSnapshotError(`${path}.${key} must be a JSON-safe string or null`);
          if (key === "format") throw new LexicalSnapshotError(`${path}.${key} must be a ${nodeType === "text" ? "finite numeric bitmask" : "valid element format"}`);
          if (["version", "indent", "textFormat", "detail", "start", "value"].includes(key)) throw new LexicalSnapshotError(`${path}.${key} must be a JSON-safe integer`);
          throw new LexicalSnapshotError(`${path}.${key} must be a JSON-safe value`);
        }
        if (typeof value === "number" && !Number.isFinite(value)) {
          if (key === "direction") throw new LexicalSnapshotError(`${path}.${key} must be a JSON-safe string or null`);
          if (key === "format") throw new LexicalSnapshotError(`${path}.${key} must be a ${nodeType === "text" ? "finite numeric bitmask" : "valid element format"}`);
          if (["version", "indent", "textFormat", "detail", "start", "value"].includes(key)) throw new LexicalSnapshotError(`${path}.${key} must be a JSON-safe integer`);
          throw new LexicalSnapshotError(`${path}.${key} must be a JSON-safe value`);
        }
        const stringFields = new Set(["text", "direction", "textStyle", "mode", "style", "tag", "url", "rel", "target", "title", "language", "theme", "listType", "itemId"]);
        const nullableStringFields = new Set(["direction", "rel", "target", "title", "language"]);
        const integerFields = new Set(["version", "indent", "textFormat", "detail", "start", "value"]);
        const booleanFields = new Set(["checked"]);
        if (stringFields.has(key) && typeof value !== "string" && !(nullableStringFields.has(key) && value === null)) {
          throw new LexicalSnapshotError(`${path}.${key} must be a string${nullableStringFields.has(key) ? " or null" : ""}`);
        }
        if (key === "direction" && value !== null && value !== "ltr" && value !== "rtl") {
          throw new LexicalSnapshotError(`${path}.direction must be 'ltr', 'rtl', or null`);
        }
        if (key === "mode" && value !== "normal" && value !== "token" && value !== "segmented") {
          throw new LexicalSnapshotError(`${path}.mode must be 'normal', 'token', or 'segmented'`);
        }
        if (key === "format") {
          if (nodeType === "text") {
            if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
              throw new LexicalSnapshotError(`${path}.${key} must be a finite numeric bitmask`);
            }
          } else if (typeof value !== "string" || !ELEMENT_FORMATS.has(value)) {
            throw new LexicalSnapshotError(`${path}.${key} must be a valid element format`);
          }
        }
        if (integerFields.has(key) && (typeof value !== "number" || !Number.isInteger(value))) {
          if (key === "start" || key === "value") throw new LexicalSnapshotError(`${path}.${key} must be an integer`);
          throw new LexicalSnapshotError(`${path}.${key} must be a JSON-safe integer`);
        }
        if (booleanFields.has(key) && typeof value !== "boolean") {
          throw new LexicalSnapshotError(`${path}.${key} must be a JSON-safe boolean`);
        }
        if (typeof value === "string") addTextBytes(value);
        (result as Record<string, unknown>)[key] = value;
      }
    }
    if (nodeType === "list") {
      const resultRecord = result as Record<string, unknown>;
      if (resultRecord.listType === undefined && (resultRecord.tag === "ol" || resultRecord.tag === "ul")) {
        resultRecord.listType = resultRecord.tag === "ol" ? "number" : "bullet";
      } else if (resultRecord.tag === undefined && (resultRecord.listType === "number" || resultRecord.listType === "bullet")) {
        resultRecord.tag = resultRecord.listType === "number" ? "ol" : "ul";
      }
    }
    return result;
  };

  const snapshot = { root: cloneNode(rootValue, "root", 0) };
  return snapshot;
};

export const validateLexicalDocument = (document: unknown): LexicalValidation => {
  try {
    return validateLexicalDocumentSnapshot(snapshotLexicalDocument(document));
  } catch (error) {
    if (error instanceof LexicalSnapshotError) return { valid: false, errors: [error.message] };
    throw error;
  }
};

const markdownInlineChildren = (
  children: LexicalNode[],
  checklist: ChecklistProjection[],
  links: LinkProjection[],
  state: { linkOrdinal: { value: number } },
): string => {
  const parts: string[] = [];
  let textRunParts: string[] = [];
  const flushTextRun = () => {
    if (textRunParts.length > 0) {
      const textRun = joinProjected(textRunParts, "", "plaintext");
      parts.push(escapeMarkdownText(textRun));
    }
    textRunParts = [];
  };
  for (const child of children) {
    if ((child?.type ?? "paragraph") === "text" && !(child.format && Number(child.format) !== 0)) {
      textRunParts.push(child.text ?? "");
    } else {
      flushTextRun();
      parts.push(child?.type === "text" ? formatMarkdownText(child.text ?? "", child.format) : markdownForNode(child!, checklist, links, state));
    }
  }
  flushTextRun();
  return joinProjected(parts, "", "Markdown");
};

type MarkdownState = { linkOrdinal: { value: number }; listType?: "bullet" | "number"; listValue?: number };

type MarkdownEstimate = { bytes: number; newlines: number; empty: boolean };
type MarkdownEstimateState = Pick<MarkdownState, "listType" | "listValue">;

const checkedMarkdownEstimate = (bytes: number, newlines: number, empty = bytes === 0): MarkdownEstimate => {
  if (bytes > MAX_PROJECTED_OUTPUT_BYTES) {
    throw new Error(`OUTPUT_TOO_LARGE: Lexical Markdown projection exceeds maximum projected output of ${MAX_PROJECTED_OUTPUT_BYTES} bytes`);
  }
  return { bytes, newlines, empty };
};

const concatenateMarkdownEstimates = (
  values: MarkdownEstimate[],
  separatorBytes = 0,
  separatorNewlines = 0,
): MarkdownEstimate => {
  let bytes = 0;
  let newlines = 0;
  let hasValue = false;
  for (const value of values) {
    if (value.empty) continue;
    if (hasValue) {
      bytes += separatorBytes;
      newlines += separatorNewlines;
    }
    bytes += value.bytes;
    newlines += value.newlines;
    hasValue = true;
    if (bytes > MAX_PROJECTED_OUTPUT_BYTES) checkedMarkdownEstimate(bytes, newlines, false);
  }
  return checkedMarkdownEstimate(bytes, newlines, !hasValue);
};

const countLineFeeds = (value: string, start = 0, end = value.length): number => {
  let count = 0;
  for (let index = start; index < end; index += 1) if (value[index] === "\n") count += 1;
  return count;
};

/** Join only validated source text, never projected fragments. */
const concatenateBoundedLexicalText = (values: string[]): string => {
  if (values.length === 0) return "";
  if (values.length === 1) return values[0]!;
  let bytes = 0;
  for (const value of values) {
    bytes += projectedByteLength(value);
    if (bytes > MAX_LEXICAL_TEXT_BYTES) {
      throw new LexicalBoundError(`Lexical document exceeds maximum text bytes of ${MAX_LEXICAL_TEXT_BYTES}`);
    }
  }
  return values.join("");
};

const estimateFormattedText = (value: string, format: number | string | undefined): MarkdownEstimate => {
  const bits = typeof format === "number" ? format : Number(format) || 0;
  if (!bits) return checkedMarkdownEstimate(estimateEscapedMarkdownBytes(value), countLineFeeds(value));
  let start = 0;
  while (start < value.length && isInlineDelimiterBoundaryWhitespace(value[start])) start += 1;
  let end = value.length;
  while (end > start && isInlineDelimiterBoundaryWhitespace(value[end - 1])) end -= 1;
  return checkedMarkdownEstimate(estimateFormattedMarkdownBytes(value, bits), countLineFeeds(value, start, end));
};

const estimateSanitizedExternalDestinationBytes = (url: string): number => {
  let bytes = 0;
  for (let index = 0; index < url.length;) {
    const codePoint = url.codePointAt(index)!;
    const character = String.fromCodePoint(codePoint);
    bytes += character === "\r" || character === "\n" || character === " " || character === "<" || character === ">" || character === "\\"
      ? 3
      : markdownUtf8Bytes(character);
    index += character.length;
  }
  return bytes;
};

const estimateCodeContent = (children: LexicalNode[]): {
  bytes: number;
  newlines: number;
  endsWithLineFeed: boolean;
  maxBackticks: number;
} => {
  let bytes = 0;
  let newlines = 0;
  let endsWithLineFeed = false;
  let currentBackticks = 0;
  let maxBackticks = 0;
  for (const child of children) {
    if (child.type === "linebreak") {
      bytes += 1;
      newlines += 1;
      endsWithLineFeed = true;
      currentBackticks = 0;
      continue;
    }
    const value = child.text ?? "";
    bytes += projectedByteLength(value);
    newlines += countLineFeeds(value);
    if (value.length > 0) endsWithLineFeed = value.endsWith("\n");
    for (const character of value) {
      if (character === "`") {
        currentBackticks += 1;
        maxBackticks = Math.max(maxBackticks, currentBackticks);
      } else {
        currentBackticks = 0;
      }
    }
  }
  return { bytes, newlines, endsWithLineFeed, maxBackticks };
};

const estimateMarkdownInlineChildren = (
  children: LexicalNode[],
  state: MarkdownEstimateState,
): MarkdownEstimate => {
  const estimates: MarkdownEstimate[] = [];
  let textRunParts: string[] = [];
  const flushTextRun = () => {
    if (textRunParts.length > 0) {
      const value = concatenateBoundedLexicalText(textRunParts);
      estimates.push(checkedMarkdownEstimate(estimateEscapedMarkdownBytes(value), countLineFeeds(value)));
      textRunParts = [];
    }
  };
  for (const child of children) {
    if ((child?.type ?? "paragraph") === "text" && !(child.format && Number(child.format) !== 0)) {
      textRunParts.push(child.text ?? "");
    } else {
      flushTextRun();
      estimates.push(child?.type === "text"
        ? estimateFormattedText(child.text ?? "", child.format)
        : estimateMarkdownNode(child!, state));
    }
  }
  flushTextRun();
  return concatenateMarkdownEstimates(estimates);
};

/** Exact whole-document Markdown preflight; no projected child string exists yet. */
const estimateMarkdownNode = (
  node: LexicalNode,
  state: MarkdownEstimateState = {},
): MarkdownEstimate => {
  const type = node.type ?? "paragraph";
  if (type === "text") return checkedMarkdownEstimate(estimateEscapedMarkdownBytes(node.text ?? ""), countLineFeeds(node.text ?? ""));
  if (type === "linebreak") return checkedMarkdownEstimate(1, 1, false);
  if (type === "link") {
    const text = estimateMarkdownInlineChildren(node.children ?? [], state);
    const targetPageId = typeof node.url === "string" ? noteTargetFromUrl(node.url) : null;
    if (targetPageId) {
      return checkedMarkdownEstimate(
        projectedByteLength("[") + text.bytes + projectedByteLength("](note://") + projectedByteLength(targetPageId) + projectedByteLength(")"),
        text.newlines,
        false,
      );
    }
    if (node.url) {
      return checkedMarkdownEstimate(
        projectedByteLength("[") + text.bytes + projectedByteLength("](<") + estimateSanitizedExternalDestinationBytes(node.url) + projectedByteLength(">)"),
        text.newlines,
        false,
      );
    }
    return text;
  }
  if (type === "check-listitem") {
    const text = estimateMarkdownInlineChildren(node.children ?? [], state);
    return checkedMarkdownEstimate(projectedByteLength("- [ ] ") + text.bytes, text.newlines, false);
  }
  if (type === "listitem") {
    const inline = estimateMarkdownInlineChildren(
      (node.children ?? []).filter((child) => !["list", "check-list"].includes(child?.type ?? "")),
      state,
    );
    const nested = concatenateMarkdownEstimates(
      (node.children ?? [])
        .filter((child) => ["list", "check-list"].includes(child?.type ?? ""))
        .map((child) => estimateMarkdownNode(child!, state)),
      1,
      1,
    );
    const marker = state.listType === "number" ? `${typeof node.value === "number" ? node.value : state.listValue ?? 1}.` : "-";
    const indentationBytes = nested.empty ? 0 : nested.bytes + (nested.newlines + 1) * (marker.length + 1);
    return checkedMarkdownEstimate(
      projectedByteLength(marker) + 1 + inline.bytes + (nested.empty ? 0 : 1 + indentationBytes),
      inline.newlines + (nested.empty ? 0 : 1 + nested.newlines),
      false,
    );
  }
  if (type === "code") {
    const content = estimateCodeContent(node.children ?? []);
    const fenceLength = Math.max(3, content.maxBackticks + 1);
    return checkedMarkdownEstimate(
      fenceLength * 2 + 1 + content.bytes + (content.endsWithLineFeed ? 0 : 1),
      1 + content.newlines + (content.endsWithLineFeed ? 0 : 1),
      false,
    );
  }
  if (type === "paragraph") return estimateMarkdownInlineChildren(node.children ?? [], state);
  if (type === "heading") {
    const content = estimateMarkdownInlineChildren(node.children ?? [], state);
    const level = Math.min(Math.max(Number(node.tag?.slice(1)) || 1, 1), 6);
    return checkedMarkdownEstimate(level + 1 + content.bytes, content.newlines, false);
  }
  if (type === "quote") {
    const children = node.children ?? [];
    const inlineOnly = children.every((child) => ["text", "link", "linebreak"].includes(child?.type ?? ""));
    const content = inlineOnly
      ? estimateMarkdownInlineChildren(children, state)
      : concatenateMarkdownEstimates(children.map((child) => estimateMarkdownNode(child!, state)));
    return checkedMarkdownEstimate(content.bytes + (content.newlines + 1) * projectedByteLength("> "), content.newlines, false);
  }
  if (type === "list" || type === "check-list") {
    const ordered = isOrderedListNode(node);
    let next = typeof node.start === "number" && Number.isInteger(node.start) ? node.start : 1;
    const values = (node.children ?? []).map((child) => {
      const value = typeof child?.value === "number" ? child.value : next;
      next = value + 1;
      return estimateMarkdownNode(child!, { listType: ordered ? "number" : "bullet", listValue: value });
    });
    return concatenateMarkdownEstimates(values, 1, 1);
  }
  const childValues = (node.children ?? []).map((child) => estimateMarkdownNode(child!, state));
  if (type === "root") return concatenateMarkdownEstimates(childValues, 2, 2);
  return concatenateMarkdownEstimates(childValues);
};

const assertMarkdownEstimate = (root: LexicalNode): void => {
  checkedMarkdownEstimate(estimateMarkdownNode(root).bytes, 0);
};

const markdownForNode = (
  node: LexicalNode,
  checklist: ChecklistProjection[],
  links: LinkProjection[],
  state: MarkdownState,
): string => {
  const type = node.type ?? "paragraph";
  if (type === "text") return escapeMarkdownText(node.text ?? "");
  if (type === "linebreak") return "\n";
  if (type === "link") {
    const text = markdownInlineChildren(node.children ?? [], checklist, links, state);
    const targetPageId = typeof node.url === "string" ? noteTargetFromUrl(node.url) : null;
    if (targetPageId) {
      links.push({ targetPageId, ordinal: state.linkOrdinal.value++, text: plainInlineChildren(node.children ?? []) });
      return joinProjected(["[", text, "](note://", targetPageId, ")"], "", "Markdown");
    }
    return node.url
      ? joinProjected(["[", text, "](<", sanitizeExternalDestination(node.url), ">)"], "", "Markdown")
      : text;
  }
  if (type === "check-listitem") {
    const itemId = node.itemId!;
    const text = markdownInlineChildren(node.children ?? [], checklist, links, state);
    checklist.push({ itemId, ordinal: checklist.length, text: plainInlineChildren(node.children ?? []), checked: node.checked === true });
    return joinProjected(["- [", node.checked ? "x" : " ", "] ", text], "", "Markdown");
  }
  if (type === "listitem") {
    const inline = markdownInlineChildren((node.children ?? []).filter((child) => !["list", "check-list"].includes(child?.type ?? "")), checklist, links, state);
    const nestedValues = (node.children ?? []).filter((child) => ["list", "check-list"].includes(child?.type ?? "")).map((child) => markdownForNode(child!, checklist, links, state)).filter(Boolean);
    const nested = joinProjected(nestedValues, "\n", "Markdown");
    const marker = state.listType === "number" ? `${typeof node.value === "number" ? node.value : state.listValue ?? 1}.` : "-";
    const nestedIndent = " ".repeat(marker.length + 1);
    const indentedNested = nested ? indentProjectedLines(nested, nestedIndent, "Markdown") : "";
    const firstLine = joinProjected([marker, " ", inline], "", "Markdown");
    return joinProjected([firstLine, ...(indentedNested ? [indentedNested] : [])], "\n", "Markdown");
  }
  if (type === "code") {
    const content = joinProjected((node.children ?? []).map((child) => plainForNode(child!)), "", "Markdown");
    const fence = "`".repeat(Math.max(3, maxBacktickRun(content) + 1));
    return joinProjected([fence, "\n", content, content.endsWith("\n") ? "" : "\n", fence], "", "Markdown");
  }
  if (type === "paragraph") return markdownInlineChildren(node.children ?? [], checklist, links, state);
  if (type === "heading") {
    const headingContent = markdownInlineChildren(node.children ?? [], checklist, links, state);
    return joinProjected(["#".repeat(Math.min(Math.max(Number(node.tag?.slice(1)) || 1, 1), 6)), " ", headingContent], "", "Markdown");
  }
  if (type === "quote") {
    const children = node.children ?? [];
    const inlineOnly = children.every((child) => ["text", "link", "linebreak"].includes(child?.type ?? ""));
    const content = inlineOnly
      ? markdownInlineChildren(children, checklist, links, state)
      : joinProjected(children.map((child) => markdownForNode(child!, checklist, links, state)), "", "Markdown");
    return indentProjectedLines(content, "> ", "Markdown");
  }
  if (type === "list" || type === "check-list") {
    const ordered = isOrderedListNode(node);
    let next = typeof node.start === "number" && Number.isInteger(node.start) ? node.start : 1;
    const values = (node.children ?? []).map((child) => {
      const value = typeof child?.value === "number" ? child.value : next;
      next = value + 1;
      const childState: MarkdownState = { ...state, listType: ordered ? "number" : "bullet", listValue: value };
      return markdownForNode(child!, checklist, links, childState);
    }).filter(Boolean);
    return joinProjected(values, "\n", "Markdown");
  }
  const childValues = (node.children ?? []).map((child) => markdownForNode(child!, checklist, links, state));
  if (type === "root") {
    const values = childValues.filter(Boolean);
    return joinProjected(values, "\n\n", "Markdown");
  }
  return joinProjected(childValues, "", "Markdown");
};

const plainInlineChildren = (children: LexicalNode[]): string =>
  joinProjected(children.map((child) => plainForNode(child)), "", "plaintext");

type PlainEstimate = { bytes: number; newlines: number };

/** Estimate plaintext amplification without allocating any projected strings. */
const estimatePlainNode = (node: LexicalNode, state: Pick<MarkdownState, "listType" | "listValue"> = {}): PlainEstimate => {
  const type = node.type ?? "paragraph";
  if (type === "text") {
    const text = node.text ?? "";
    let newlines = 0;
    for (const character of text) if (character === "\n") newlines += 1;
    return { bytes: projectedByteLength(text), newlines };
  }
  if (type === "linebreak") return { bytes: 1, newlines: 1 };
  if (type === "link" || type === "code" || type === "paragraph" || type === "heading" || type === "quote") {
    let bytes = 0;
    let newlines = 0;
    for (const child of node.children ?? []) {
      const childEstimate = estimatePlainNode(child, state);
      bytes += childEstimate.bytes;
      newlines += childEstimate.newlines;
    }
    return { bytes, newlines };
  }
  if (type === "check-listitem") {
    let body = estimatePlainNode({ type: "paragraph", children: node.children ?? [] }, state);
    return { bytes: body.bytes + 2, newlines: body.newlines };
  }
  if (type === "listitem") {
    const inlineChildren = (node.children ?? []).filter((child) => !["list", "check-list"].includes(child?.type ?? ""));
    const nestedChildren = (node.children ?? []).filter((child) => ["list", "check-list"].includes(child?.type ?? ""));
    let inline: PlainEstimate = { bytes: 0, newlines: 0 };
    for (const child of inlineChildren) {
      const childEstimate = estimatePlainNode(child, state);
      inline = { bytes: inline.bytes + childEstimate.bytes, newlines: inline.newlines + childEstimate.newlines };
    }
    let nested: PlainEstimate = { bytes: 0, newlines: 0 };
    for (const child of nestedChildren) {
      const childEstimate = estimatePlainNode(child, state);
      if (nested.bytes) nested = { bytes: nested.bytes + 1, newlines: nested.newlines + 1 };
      nested = { bytes: nested.bytes + childEstimate.bytes, newlines: nested.newlines + childEstimate.newlines };
    }
    const marker = state.listType === "number" ? `${state.listValue ?? 1}.` : "-";
    const nestedIndentLength = marker.length + 1;
    const indentedBytes = nested.bytes + (nested.bytes ? nested.newlines + 1 : 0) * nestedIndentLength;
    const bytes = marker.length + 1 + inline.bytes + (nested.bytes ? 1 + indentedBytes : 0);
    const newlines = inline.newlines + nested.newlines + (nested.bytes ? 1 : 0);
    return { bytes, newlines };
  }
  if (type === "list" || type === "check-list") {
    const ordered = isOrderedListNode(node);
    let next = typeof node.start === "number" && Number.isInteger(node.start) ? node.start : 1;
    let bytes = 0;
    let newlines = 0;
    for (const child of node.children ?? []) {
      const value = typeof child?.value === "number" ? child.value : next;
      next = value + 1;
      const childEstimate = estimatePlainNode(child, { listType: ordered ? "number" : "bullet", listValue: value });
      if (bytes) {
        bytes += 1;
        newlines += 1;
      }
      bytes += childEstimate.bytes;
      newlines += childEstimate.newlines;
      if (bytes > MAX_PROJECTED_OUTPUT_BYTES) throw new Error(`OUTPUT_TOO_LARGE: Lexical plaintext projection exceeds maximum projected output of ${MAX_PROJECTED_OUTPUT_BYTES} bytes`);
    }
    return { bytes, newlines };
  }
  if (type === "root") {
    let bytes = 0;
    let newlines = 0;
    for (const child of node.children ?? []) {
      const childEstimate = estimatePlainNode(child, state);
      if (bytes) {
        bytes += 1;
        newlines += 1;
      }
      bytes += childEstimate.bytes;
      newlines += childEstimate.newlines;
      if (bytes > MAX_PROJECTED_OUTPUT_BYTES) throw new Error(`OUTPUT_TOO_LARGE: Lexical plaintext projection exceeds maximum projected output of ${MAX_PROJECTED_OUTPUT_BYTES} bytes`);
    }
    return { bytes, newlines };
  }
  return { bytes: 0, newlines: 0 };
};

const assertPlaintextEstimate = (root: LexicalNode): void => {
  const estimate = estimatePlainNode(root);
  if (estimate.bytes > MAX_PROJECTED_OUTPUT_BYTES) throw new Error(`OUTPUT_TOO_LARGE: Lexical plaintext projection exceeds maximum projected output of ${MAX_PROJECTED_OUTPUT_BYTES} bytes`);
};

function plainForNode(node: LexicalNode, state: Pick<MarkdownState, "listType" | "listValue"> = {}): string {
  const type = node.type ?? "paragraph";
  if (type === "text") return node.text ?? "";
  if (type === "linebreak") return "\n";
  if (type === "link" || type === "code") return joinProjected((node.children ?? []).map((child) => plainForNode(child!, state)), "", "plaintext");
  if (type === "check-listitem") {
    const text = joinProjected((node.children ?? []).map((child) => plainForNode(child!, state)), "", "plaintext");
    return joinProjected(["- ", text], "", "plaintext");
  }
  if (type === "listitem") {
    const inline = joinProjected((node.children ?? []).filter((child) => !["list", "check-list"].includes(child?.type ?? "")).map((child) => plainForNode(child!, state)), "", "plaintext");
    const nestedValues = (node.children ?? []).filter((child) => ["list", "check-list"].includes(child?.type ?? "")).map((child) => plainForNode(child!, state)).filter(Boolean);
    const nested = joinProjected(nestedValues, "\n", "plaintext");
    const marker = state.listType === "number" ? `${state.listValue ?? 1}.` : "-";
    const nestedIndent = " ".repeat(marker.length + 1);
    const indentedNested = nested ? indentProjectedLines(nested, nestedIndent, "plaintext") : "";
    const firstLine = joinProjected([marker, " ", inline], "", "plaintext");
    return joinProjected([firstLine, ...(indentedNested ? [indentedNested] : [])], "\n", "plaintext");
  }
  if (type === "list" || type === "check-list") {
    const ordered = isOrderedListNode(node);
    let next = typeof node.start === "number" && Number.isInteger(node.start) ? node.start : 1;
    const values = (node.children ?? []).map((child) => {
      const value = typeof child?.value === "number" ? child.value : next;
      next = value + 1;
      return plainForNode(child!, { listType: ordered ? "number" : "bullet", listValue: value });
    }).filter(Boolean);
    return joinProjected(values, "\n", "plaintext");
  }
  const childValues = (node.children ?? []).map((child) => plainForNode(child!, state));
  if (type === "root") return joinProjected(childValues.filter(Boolean), "\n", "plaintext");
  return joinProjected(childValues, "", "plaintext");
}

const snapshotAndValidateLexicalDocument = (document: LexicalDocument): LexicalDocument => {
  try {
    const snapshot = snapshotLexicalDocument(document);
    const validation = validateLexicalDocumentSnapshot(snapshot);
    if (!validation.valid) throw new Error(`Invalid Lexical document: ${validation.errors.join("; ")}`);
    return snapshot;
  } catch (error) {
    if (error instanceof LexicalSnapshotError) throw new Error(`Invalid Lexical document: ${error.message}`);
    if (error instanceof Error && error.message.startsWith("Invalid Lexical document:")) throw error;
    throw new Error("Invalid Lexical document: document could not be cloned");
  }
};

const projectLexicalSnapshot = (
  snapshot: LexicalDocument,
  options: { previousChecklist?: Array<Pick<ChecklistProjection, "itemId" | "checked">>; now?: Date } = {},
): LexicalProjection => {
  const checklist: ChecklistProjection[] = [];
  const links: LinkProjection[] = [];
  assertPlaintextEstimate(snapshot.root);
  assertMarkdownEstimate(snapshot.root);
  const markdown = markdownForNode(snapshot.root, checklist, links, { linkOrdinal: { value: 0 } });
  assertProjectedOutput(markdown, "Markdown");
  const previous = new Map((options.previousChecklist ?? []).map((item) => [item.itemId, item.checked]));
  const now = options.now ?? new Date();
  const completionTransitions = checklist
    .filter((item) => previous.has(item.itemId) && previous.get(item.itemId) !== item.checked)
    .map((item) => ({ itemId: item.itemId, checked: item.checked, completedAt: item.checked ? now : null }));
  const plaintext = plainForNode(snapshot.root);
  assertProjectedOutput(plaintext, "plaintext");
  assertProjectedLength(checklist.reduce((total, item) => total + item.itemId.length + item.text.length, 0), "plaintext");
  assertProjectedLength(links.reduce((total, link) => total + link.targetPageId.length + link.text.length, 0), "plaintext");
  return {
    markdown,
    plaintext,
    checklist,
    links,
    completionTransitions,
  };
};

export const projectLexicalDocument = (
  document: LexicalDocument,
  options: { previousChecklist?: Array<Pick<ChecklistProjection, "itemId" | "checked">>; now?: Date } = {},
): LexicalProjection => {
  const snapshot = snapshotAndValidateLexicalDocument(document);
  return projectLexicalSnapshot(snapshot, options);
};

export const projectLexicalDocumentFromSnapshot = (
  snapshot: LexicalDocument,
  options: { previousChecklist?: Array<Pick<ChecklistProjection, "itemId" | "checked">>; now?: Date } = {},
): LexicalProjection => {
  const validation = validateLexicalDocumentSnapshot(snapshot);
  if (!validation.valid) throw new Error(`Invalid Lexical document: ${validation.errors.join("; ")}`);
  return projectLexicalSnapshot(snapshot, options);
};

export const createChecklistItemId = (): string => randomUUID();

/** Return a structural copy with one stable checklist item toggled. */
export const setChecklistItemChecked = (
  document: LexicalDocument,
  itemId: string,
  checked: boolean,
): LexicalDocument => {
  const copy = snapshotAndValidateLexicalDocument(document);
  if (typeof itemId !== "string" || !UUID_PATTERN.test(itemId)) throw new Error("CHECKLIST_ITEM_ID_INVALID");
  if (typeof checked !== "boolean") throw new Error("CHECKLIST_CHECKED_INVALID");
  let matches = 0;
  const walk = (node: LexicalNode): void => {
    if (node.type === "check-listitem" && node.itemId === itemId) {
      node.checked = checked;
      matches += 1;
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(copy.root);
  if (matches !== 1) throw new Error(matches === 0 ? "CHECKLIST_ITEM_NOT_FOUND" : "CHECKLIST_ITEM_MATCH_COUNT");
  const resultValidation = validateLexicalDocumentSnapshot(copy);
  if (!resultValidation.valid) throw new Error(`Invalid Lexical document: ${resultValidation.errors.join("; ")}`);
  return copy;
};
