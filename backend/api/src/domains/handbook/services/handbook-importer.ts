import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const DEFAULT_MAX_CHUNK_WORDS = 450;

export type HandbookImportCandidate = {
  title: string;
  slug: string;
  summary: string | null;
  content: string;
  category: string;
  sourcePath: string;
  contentHash: string;
};

export type HandbookChunkCandidate = {
  chunkIndex: number;
  headingPath: string | null;
  content: string;
  tokenCount: number;
};

const removeDiacritics = (value: string): string =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export const slugifyHandbookTitle = (value: string): string => {
  const slug = removeDiacritics(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  return slug || "handbook-entry";
};

const titleFromPath = (filePath: string): string => {
  const base = path.basename(filePath, path.extname(filePath));
  return base
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const extractTitle = (content: string, filePath: string): string => {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || titleFromPath(filePath);
};

const extractSummary = (content: string): string | null => {
  const withoutHeading = content.replace(/^#\s+.+$/m, "").trim();
  const paragraph = withoutHeading
    .split(/\n\s*\n/g)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .find((part) => part.length > 0 && !part.startsWith("---"));

  if (!paragraph) return null;
  return paragraph.length > 280 ? `${paragraph.slice(0, 277)}...` : paragraph;
};

export const hashHandbookContent = (content: string): string =>
  createHash("sha256").update(content).digest("hex");

export const buildHandbookImportCandidate = ({
  rootPath,
  filePath,
  content,
}: {
  rootPath: string;
  filePath: string;
  content: string;
}): HandbookImportCandidate => {
  const relativePath = path.relative(rootPath, filePath).split(path.sep).join("/");
  const pathParts = relativePath.split("/");
  const category = pathParts.length > 1 ? pathParts[0] || "general" : "general";
  const title = extractTitle(content, filePath);
  const sourceSlug = slugifyHandbookTitle(relativePath.replace(/\.mdx?$/i, ""));

  return {
    title,
    slug: sourceSlug,
    summary: extractSummary(content),
    content,
    category,
    sourcePath: relativePath,
    contentHash: hashHandbookContent(content),
  };
};

const estimateTokenCount = (content: string): number =>
  Math.ceil(content.trim().split(/\s+/).filter(Boolean).length * 1.35);

const splitOversizedContent = (
  content: string,
  maxWords: number,
  headingPath: string | null,
  startIndex: number,
): HandbookChunkCandidate[] => {
  const words = content.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) {
    return [{ chunkIndex: startIndex, headingPath, content: content.trim(), tokenCount: estimateTokenCount(content) }];
  }

  const chunks: HandbookChunkCandidate[] = [];
  for (let i = 0; i < words.length; i += maxWords) {
    const chunkContent = words.slice(i, i + maxWords).join(" ");
    chunks.push({
      chunkIndex: startIndex + chunks.length,
      headingPath,
      content: chunkContent,
      tokenCount: estimateTokenCount(chunkContent),
    });
  }
  return chunks;
};

export const chunkMarkdownContent = (
  content: string,
  maxWords = DEFAULT_MAX_CHUNK_WORDS,
): HandbookChunkCandidate[] => {
  const lines = content.split(/\r?\n/);
  const sections: Array<{ headingPath: string | null; lines: string[] }> = [];
  const headingStack: Array<{ level: number; title: string }> = [];
  let current: { headingPath: string | null; lines: string[] } = { headingPath: null, lines: [] };

  const flush = () => {
    const sectionContent = current.lines.join("\n").trim();
    if (sectionContent.length > 0) sections.push({ ...current, lines: [sectionContent] });
  };

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flush();
      const level = headingMatch[1]!.length;
      const title = headingMatch[2]!.trim();
      while (headingStack.length > 0 && headingStack[headingStack.length - 1]!.level >= level) {
        headingStack.pop();
      }
      headingStack.push({ level, title });
      current = {
        headingPath: headingStack.map((item) => item.title).join(" > "),
        lines: [line],
      };
    } else {
      current.lines.push(line);
    }
  }
  flush();

  const chunks: HandbookChunkCandidate[] = [];
  for (const section of sections) {
    const sectionContent = section.lines.join("\n").trim();
    const sectionChunks = splitOversizedContent(
      sectionContent,
      maxWords,
      section.headingPath,
      chunks.length,
    );
    chunks.push(...sectionChunks);
  }

  return chunks.length > 0
    ? chunks.map((chunk, index) => ({ ...chunk, chunkIndex: index }))
    : [{ chunkIndex: 0, headingPath: null, content: content.trim(), tokenCount: estimateTokenCount(content) }];
};

export const discoverMarkdownFiles = async (rootPath: string): Promise<string[]> => {
  const rootStat = await stat(rootPath);
  if (!rootStat.isDirectory()) {
    throw new Error(`Handbook root path is not a directory: ${rootPath}`);
  }

  const files: string[] = [];
  const visit = async (dir: string) => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "build") continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
      } else if (entry.isFile() && /\.mdx?$/i.test(entry.name)) {
        files.push(fullPath);
      }
    }
  };

  await visit(rootPath);
  return files.sort();
};

export const loadHandbookImportCandidates = async (rootPath: string): Promise<HandbookImportCandidate[]> => {
  const files = await discoverMarkdownFiles(rootPath);
  const candidates: HandbookImportCandidate[] = [];

  for (const filePath of files) {
    const content = await readFile(filePath, "utf8");
    candidates.push(buildHandbookImportCandidate({ rootPath, filePath, content }));
  }

  return candidates;
};
