const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "strong",
  "em",
  "s",
  "u",
  "code",
  "pre",
  "ul",
  "ol",
  "li",
  "a",
  "span",
  "h1",
  "h2",
  "h3",
  "img",
]);

const ALLOWED_ATTRS = new Set([
  "href",
  "target",
  "rel",
  "class",
  "data-type",
  "data-id",
  "data-label",
  "src",
  "alt",
]);

const VOID_TAGS = new Set(["br", "img"]);

const TAG_PATTERN = /<\/?([a-zA-Z0-9-]+)([^>]*)>/g;
const ATTR_PATTERN =
  /([:@a-zA-Z0-9_-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

const DANGEROUS_BLOCK_TAGS = ["script", "style", "iframe", "object", "embed", "link", "meta"];

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const escapeAttr = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const normalizeEditorAssetUrl = (value: string): string => {
  try {
    const urlObj = value.startsWith("/")
      ? new URL(value, "http://localhost")
      : new URL(value);
    const pathParts = urlObj.pathname.split("/").filter(Boolean);

    const imageIndex = pathParts.indexOf("editor-images");
    if (imageIndex !== -1) {
      return `/api/uploads/images/${pathParts.slice(imageIndex).join("/")}`;
    }

    const fileIndex = pathParts.indexOf("editor-files");
    if (fileIndex !== -1) {
      return `/api/uploads/files/${pathParts.slice(fileIndex).join("/")}`;
    }

    return value;
  } catch {
    return value;
  }
};

const stripDangerousBlocks = (html: string): string => {
  let sanitized = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const tag of DANGEROUS_BLOCK_TAGS) {
    sanitized = sanitized.replace(
      new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"),
      ""
    );
    sanitized = sanitized.replace(new RegExp(`<${tag}\\b[^>]*\\/?>`, "gi"), "");
  }
  return sanitized;
};

const isSafeUrl = (value: string, attrName: "href" | "src"): boolean => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;

  if (
    normalized.startsWith("/") ||
    normalized.startsWith("./") ||
    normalized.startsWith("../") ||
    normalized.startsWith("#")
  ) {
    return true;
  }

  if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
    return true;
  }

  if (attrName === "href" && (normalized.startsWith("mailto:") || normalized.startsWith("tel:"))) {
    return true;
  }

  if (attrName === "src" && /^data:image\/[a-z0-9.+-]+;base64,/i.test(normalized)) {
    return true;
  }

  return false;
};

const sanitizeAttributes = (rawAttrs: string): string => {
  const attrs: string[] = [];
  let targetBlank = false;
  let relValue: string | null = null;

  ATTR_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTR_PATTERN.exec(rawAttrs)) !== null) {
    const name = match[1].toLowerCase();
    if (!ALLOWED_ATTRS.has(name)) continue;

    const rawValue = match[2] ?? match[3] ?? match[4] ?? "";
    const value = rawValue.trim();
    const normalizedValue =
      name === "href" || name === "src" ? normalizeEditorAssetUrl(value) : value;

    if (name === "href" || name === "src") {
      if (!isSafeUrl(normalizedValue, name)) continue;
    }

    if (name === "target") {
      if (!["_blank", "_self", "_parent", "_top"].includes(normalizedValue)) continue;
      targetBlank = normalizedValue === "_blank";
    }

    if (name === "rel") {
      relValue = normalizedValue;
      continue;
    }

    attrs.push(`${name}="${escapeAttr(normalizedValue)}"`);
  }

  if (targetBlank) {
    const relParts = new Set(
      (relValue ?? "")
        .split(/\s+/)
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean)
    );
    relParts.add("noopener");
    relParts.add("noreferrer");
    attrs.push(`rel="${escapeAttr(Array.from(relParts).join(" "))}"`);
  } else if (relValue) {
    attrs.push(`rel="${escapeAttr(relValue)}"`);
  }

  return attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
};

const isHtmlContent = (content: string): boolean => /<[a-z][\s\S]*>/i.test(content);

export const sanitizeCommentHtml = (content: string): string => {
  const baseHtml = isHtmlContent(content)
    ? content
    : `<p>${escapeHtml(content).replaceAll("\n", "<br>")}</p>`;

  const stripped = stripDangerousBlocks(baseHtml);

  return stripped.replace(TAG_PATTERN, (full, rawTagName: string, rawAttrs: string) => {
    const tagName = rawTagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tagName)) return "";

    const isClosingTag = full.startsWith("</");
    if (isClosingTag) {
      return VOID_TAGS.has(tagName) ? "" : `</${tagName}>`;
    }

    const attrs = sanitizeAttributes(rawAttrs ?? "");
    if (VOID_TAGS.has(tagName)) {
      return `<${tagName}${attrs}>`;
    }

    return `<${tagName}${attrs}>`;
  });
};
