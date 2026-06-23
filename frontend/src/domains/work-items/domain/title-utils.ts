/**
 * Strip AI-generated prefixes from work item titles.
 *
 * Handles patterns like:
 *   "F1/S1.1 - Real title"   → "Real title"
 *   "E1/F2/S3.4: Real title" → "Real title"
 *   "S1. Real title"         → "Real title"
 *   "F1 - Real title"        → "Real title"
 *   "T3.2 - Real title"      → "Real title"
 *
 * If no prefix is detected the original title is returned unchanged.
 */
const PREFIX_RE = /^(?:[EFSBT]\d+(?:\.\d+)*(?:\/[EFSBT]\d+(?:\.\d+)*)*)\s*[-:.]\s*/i;

export const stripTitlePrefix = (title: string): string =>
  title.replace(PREFIX_RE, "");
