// ---------------------------------------------------------------------------
// TipTap HTML to Email-safe HTML converter
//
// Transforms TipTap editor HTML into inline-styled, email-client-safe HTML
// with optional text-aware truncation that never breaks tags mid-way.
// ---------------------------------------------------------------------------

const MENTION_COLOR = "#6366f1";

const ENTITY_MAP: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&amp;": "&",
  "&quot;": "\"",
  "&#39;": "'",
  "&#x27;": "'",
  "&nbsp;": " ",
};

/**
 * Map of allowed opening tags to their email-safe replacements.
 * Tags not in this map are stripped (their text content is preserved).
 */
const TAG_MAP: Record<string, string> = {
  p: '<p style="margin:0 0 8px;line-height:1.5;">',
  strong: "<strong>",
  em: "<em>",
  s: '<span style="text-decoration:line-through;">',
  code: '<code style="background:#f1f5f9;padding:2px 4px;border-radius:3px;font-size:13px;">',
  ul: '<ul style="margin:0 0 8px;padding-left:24px;">',
  ol: '<ol style="margin:0 0 8px;padding-left:24px;">',
  li: '<li style="margin:0 0 4px;">',
  br: "<br>",
};

/** Closing tag overrides (only needed when the replacement tag name differs). */
const CLOSING_TAG_MAP: Record<string, string> = {
  s: "</span>",
};

/**
 * Convert TipTap editor HTML into email-safe inline-styled HTML with optional
 * text-aware truncation.
 *
 * @param html          Raw HTML from TipTap editor
 * @param maxTextLength Optional max visible-text character count before truncation
 * @returns             Email-safe HTML string ready for embedding in an email template
 */
export const tiptapHtmlToEmailHtml = (
  html: string,
  maxTextLength?: number,
): string => {
  if (!html || html.trim().length === 0) return "";

  const normalizedHtml = normalizeInputHtml(html);
  if (!normalizedHtml) return "";

  // We walk through the HTML token-by-token (tags and text segments).
  // For each token we either transform the tag or keep the text as-is,
  // while counting visible characters for truncation.

  const tokens = tokenize(normalizedHtml);
  const openTagStack: string[] = []; // stack of canonical tag names for closing
  let textLength = 0;
  let truncated = false;
  const parts: string[] = [];

  for (const token of tokens) {
    if (truncated) break;

    if (token.type === "tag") {
      const transformed = transformTag(token.raw);

      if (transformed === null) {
        // Stripped unknown tag -- skip it entirely
        continue;
      }

      // Track open/close for truncation close-out
      if (token.isClosing) {
        openTagStack.pop();
      } else if (!token.selfClosing) {
        openTagStack.push(token.tagName);
      }

      parts.push(transformed);
    } else {
      // Text node
      let text = token.raw;

      if (maxTextLength !== undefined && textLength + text.length > maxTextLength) {
        const remaining = maxTextLength - textLength;
        text = text.slice(0, remaining) + "...";
        parts.push(text);
        textLength = maxTextLength;
        truncated = true;
        continue;
      }

      textLength += text.length;
      parts.push(text);
    }
  }

  // Close any tags that were still open when we truncated
  if (truncated) {
    for (let i = openTagStack.length - 1; i >= 0; i--) {
      const tagName = openTagStack[i]!;
      parts.push(CLOSING_TAG_MAP[tagName] ?? `</${tagName}>`);
    }
  }

  return parts.join("");
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface Token {
  type: "tag" | "text";
  raw: string;
  /** Only present when type === "tag" */
  tagName: string;
  isClosing: boolean;
  selfClosing: boolean;
}

const decodeHtmlEntities = (value: string): string =>
  value.replace(
    /&(lt|gt|amp|quot|#39|#x27|nbsp);/gi,
    (match) => ENTITY_MAP[match.toLowerCase()] ?? match
  );

const normalizeInputHtml = (value: string): string => {
  let normalized = value.trim();
  if (!normalized) return "";

  // Some payloads can arrive as JSON-stringified HTML (`"<p>...</p>"`).
  for (let i = 0; i < 2; i++) {
    if (!(normalized.startsWith("\"") && normalized.endsWith("\""))) {
      break;
    }

    try {
      const parsed = JSON.parse(normalized);
      if (typeof parsed !== "string") break;
      normalized = parsed.trim();
    } catch {
      break;
    }
  }

  return decodeHtmlEntities(normalized);
};

const escapeAttribute = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/**
 * Splits HTML into a sequence of tag tokens and text tokens.
 */
const tokenize = (html: string): Token[] => {
  const result: Token[] = [];
  // Matches any HTML tag (opening, closing, self-closing)
  const tagRegex = /<\/?[a-zA-Z][^>]*\/?>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(html)) !== null) {
    // Text before this tag
    if (match.index > lastIndex) {
      result.push({
        type: "text",
        raw: html.slice(lastIndex, match.index),
        tagName: "",
        isClosing: false,
        selfClosing: false,
      });
    }

    const raw = match[0];
    const isClosing = raw.startsWith("</");
    const selfClosing = /\/>$/.test(raw) || raw.toLowerCase() === "<br>" || raw.toLowerCase() === "<br/>";
    const tagNameMatch = raw.match(/<\/?([a-zA-Z][a-zA-Z0-9]*)/);
    const tagName = tagNameMatch ? tagNameMatch[1]!.toLowerCase() : "";

    result.push({ type: "tag", raw, tagName, isClosing, selfClosing });
    lastIndex = match.index + raw.length;
  }

  // Trailing text
  if (lastIndex < html.length) {
    result.push({
      type: "text",
      raw: html.slice(lastIndex),
      tagName: "",
      isClosing: false,
      selfClosing: false,
    });
  }

  return result;
};

/**
 * Transforms a single HTML tag string into its email-safe equivalent.
 * Returns null if the tag should be stripped entirely.
 */
const transformTag = (raw: string): string | null => {
  // Handle mention spans: <span data-type="mention" data-id="..." class="mention">@Name</span>
  if (/data-type=["']mention["']/i.test(raw)) {
    return `<strong style="color:${MENTION_COLOR};">`;
  }

  const isClosing = raw.startsWith("</");
  const tagNameMatch = raw.match(/<\/?([a-zA-Z][a-zA-Z0-9]*)/);
  if (!tagNameMatch) return null;

  const tagName = tagNameMatch[1]!.toLowerCase();

  if (!isClosing && tagName === "img") {
    const srcMatch = raw.match(/\ssrc=(['"])(.*?)\1/i) ?? raw.match(/\ssrc=([^\s>]+)/i);
    const src = srcMatch?.[2] ?? srcMatch?.[1] ?? "";
    if (!src || !/^https?:\/\//i.test(src)) {
      return null;
    }

    const altMatch = raw.match(/\salt=(['"])(.*?)\1/i) ?? raw.match(/\salt=([^\s>]+)/i);
    const alt = altMatch?.[2] ?? altMatch?.[1] ?? "Image";
    const safeSrc = escapeAttribute(src);
    const safeAlt = escapeAttribute(alt);
    return `<a href="${safeSrc}" target="_blank" rel="noopener noreferrer"><img src="${safeSrc}" alt="${safeAlt}" style="max-width:100%;height:auto;border-radius:6px;border:0;display:block;margin:8px 0;" /></a>`;
  }

  if (isClosing) {
    // Check if this is a known tag
    if (tagName === "span" || TAG_MAP[tagName] !== undefined) {
      // For closing </span>, it could be closing a mention <strong> or a <s>-><span>
      // We check the CLOSING_TAG_MAP first, then fall back to canonical close
      if (CLOSING_TAG_MAP[tagName]) {
        return CLOSING_TAG_MAP[tagName]!;
      }
      // If it's a </span> closing a mention, we need </strong>
      if (tagName === "span") {
        return "</strong>";
      }
      return `</${tagName}>`;
    }
    // Unknown closing tag -> strip
    return null;
  }

  // Self-closing / void tags
  if (tagName === "br") {
    return "<br>";
  }

  // Opening tag
  if (TAG_MAP[tagName] !== undefined) {
    return TAG_MAP[tagName]!;
  }

  // Unknown opening tag -> strip
  return null;
};
