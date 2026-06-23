/**
 * Check if HTML content has visible content (text, images, or file links).
 * Used to validate comment submissions - blocks empty comments
 * but allows image-only or attachment-only comments.
 */
export const hasVisibleContent = (html: string): boolean => {
  // Check for embedded images
  if (/<img\s/i.test(html)) return true;
  // Check for links (file attachments)
  if (/<a\s[^>]*href=/i.test(html)) return true;
  // Check for visible text after stripping HTML tags
  const stripped = html.replace(/<[^>]*>/g, "").trim();
  return stripped.length > 0;
};
