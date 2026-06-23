import type {
  SprintShareParseResult,
  SprintShareSection,
} from "../../domain/types";

const MARKDOWN_IMAGE_REGEX = /^!\[[^\]]*]\([^)]+\)\s*$/;
const MARKDOWN_CODE_FENCE_REGEX = /^```/;
const MARKDOWN_HEADING_1_REGEX = /^#\s+/;
const MARKDOWN_HEADING_2_REGEX = /^##\s+/;
const MARKDOWN_BULLET_REGEX = /^[-*]\s+/;

const stripMarkdown = (value: string): string =>
  value
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^>\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();

const sectionFromLines = (
  heading: string,
  lines: string[]
): SprintShareSection | null => {
  let insideCodeBlock = false;
  const summaryParts: string[] = [];
  const highlights: string[] = [];

  for (const rawLine of lines) {
    if (MARKDOWN_CODE_FENCE_REGEX.test(rawLine.trim())) {
      insideCodeBlock = !insideCodeBlock;
      continue;
    }

    if (insideCodeBlock) continue;

    const line = rawLine.trim();
    if (!line || MARKDOWN_IMAGE_REGEX.test(line)) continue;
    if (line.startsWith("**Cambios principales:**")) continue;

    if (MARKDOWN_BULLET_REGEX.test(line)) {
      const highlight = stripMarkdown(line.replace(MARKDOWN_BULLET_REGEX, ""));
      if (highlight.length > 0) highlights.push(highlight);
      continue;
    }

    if (!line.startsWith(">")) {
      summaryParts.push(stripMarkdown(line));
    }
  }

  const summary = summaryParts.filter(Boolean).join(" ").trim();
  if (!summary && highlights.length === 0) return null;

  if (!summary && highlights.length > 0) {
    return {
      heading,
      summary: highlights[0] ?? "",
      highlights,
    };
  }

  return {
    heading,
    summary,
    highlights,
  };
};

export const parseChangelogForShare = (markdown: string): SprintShareParseResult => {
  const lines = markdown.split("\n");
  const sections: SprintShareSection[] = [];
  let title: string | null = null;
  let currentHeading = "";
  let currentSectionLines: string[] = [];

  const flushSection = () => {
    const section = sectionFromLines(currentHeading, currentSectionLines);
    if (section) sections.push(section);
    currentSectionLines = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (MARKDOWN_HEADING_1_REGEX.test(line)) {
      title = line.replace(MARKDOWN_HEADING_1_REGEX, "").trim();
      continue;
    }

    if (MARKDOWN_HEADING_2_REGEX.test(line)) {
      if (currentHeading || currentSectionLines.length > 0) {
        flushSection();
      }
      currentHeading = line.replace(MARKDOWN_HEADING_2_REGEX, "").trim();
      continue;
    }

    currentSectionLines.push(rawLine);
  }

  if (currentHeading || currentSectionLines.length > 0) {
    flushSection();
  }

  if (sections.length === 0) {
    const fallbackSection = sectionFromLines("", lines);
    if (fallbackSection) {
      sections.push(fallbackSection);
    }
  }

  return {
    title,
    sections,
  };
};
