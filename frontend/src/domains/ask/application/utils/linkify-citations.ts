import type { AskCitation, AskCitationSourceType } from "../../domain/types";

// ---------------------------------------------------------------------------
// Utility: linkifyCitations
// ---------------------------------------------------------------------------
// Pre-processes markdown content to convert [N] citation references into
// clickable markdown links. Links open the cited source in a new tab
// when a URL can be resolved, otherwise they anchor to the citations section.
// ---------------------------------------------------------------------------

/**
 * Builds a URL for a citation based on its source type and ID.
 * Returns null if no meaningful URL can be built.
 */
const buildCitationUrl = (
  sourceType: AskCitationSourceType,
  sourceId: string
): string | null => {
  switch (sourceType) {
    case "document":
      return `/docs/${sourceId}`;
    default:
      // work_item, event, commit, observation — no universal route
      return null;
  }
};

/**
 * Replaces `[N]` citation references in the markdown content with clickable
 * markdown links. The href encodes the citation index so the custom markdown
 * `a` component can handle click behavior.
 *
 * - If a real URL exists (e.g. documents), the link opens in a new tab.
 * - Otherwise, the link uses a `#cite-N` anchor that can trigger scrolling
 *   to the citations section.
 */
export const linkifyCitations = (
  content: string,
  citations: AskCitation[]
): string => {
  if (citations.length === 0) return content;

  // Match [N] where N is 1-based index, not already inside a markdown link
  return content.replace(/\[(\d+)\]/g, (match, numStr) => {
    const index = parseInt(numStr, 10);
    if (index < 1 || index > citations.length) return match;

    const citation = citations[index - 1]!;
    const url = buildCitationUrl(citation.sourceType, citation.sourceId);

    if (url) {
      // Real URL — will open in new tab via custom `a` component
      return `[\\[${index}\\]](${url})`;
    }

    // Fallback: anchor link to citations section
    return `[\\[${index}\\]](#ask-cite-${index})`;
  });
};
