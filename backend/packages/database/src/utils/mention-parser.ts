/**
 * Parses @mentions from HTML content produced by Tiptap's Mention extension.
 *
 * The editor renders mentions as:
 *   <span data-type="mention" data-id="userId">@Name</span>
 *
 * This function extracts all unique user IDs from such spans.
 * It looks for elements that contain both data-type="mention" and data-id="..."
 * to avoid false positives from other elements that may also use data-id.
 */
export const parseMentionsFromHtml = (html: string): string[] => {
  if (!html || html.trim().length === 0) {
    return [];
  }

  const ids = new Set<string>();

  // Match elements that have data-type="mention" AND data-id="..."
  // Handles attributes in any order within the same tag.
  const tagRegex = /<[^>]*data-type=["']mention["'][^>]*>/gi;
  const dataIdRegex = /data-id=["']([^"']+)["']/i;

  let tagMatch: RegExpExecArray | null;

  while ((tagMatch = tagRegex.exec(html)) !== null) {
    const tag = tagMatch[0];
    const idMatch = dataIdRegex.exec(tag);
    if (idMatch?.[1]) {
      const id = idMatch[1].trim();
      if (id.length > 0) {
        ids.add(id);
      }
    }
  }

  return Array.from(ids);
};
