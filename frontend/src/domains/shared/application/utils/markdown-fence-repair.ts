const FENCE_LINE_PATTERN = /^\s{0,3}(`{3,}|~{3,})(.*)$/;
const SUMMARY_BOUNDARY_PATTERN =
  /^\s{0,3}#{1,6}\s+(?:summary|summar[yi]|resumen|result|resultado|results|final|completion|completed|conclusion|conclusi[oó]n)\b/i;

type OpenFence = {
  marker: "`" | "~";
  length: number;
};

const parseFenceLine = (
  line: string,
): { marker: "`" | "~"; length: number; info: string } | null => {
  const match = line.match(FENCE_LINE_PATTERN);
  const fence = match?.[1];
  if (!fence) return null;

  const marker = fence[0] as "`" | "~";
  return { marker, length: fence.length, info: match[2] ?? "" };
};

const closesFence = (line: string, openFence: OpenFence): boolean => {
  const fence = parseFenceLine(line);
  return (
    fence != null &&
    fence.marker === openFence.marker &&
    fence.length >= openFence.length &&
    fence.info.trim() === ""
  );
};

/**
 * Best-effort repair for model output that opens a markdown code fence and
 * forgets to close it before a final human-readable summary section.
 *
 * Why this exists: one malformed agent message should not visually swallow the
 * rest of the transcript into a `<pre>` block. We keep normal balanced markdown
 * untouched, close known final-summary boundaries before rendering, and add a
 * final closing fence if the content still ends while inside code.
 */
export const repairDanglingMarkdownFences = (content: string): string => {
  if (!content.includes("```") && !content.includes("~~~")) return content;

  const lines = content.split("\n");
  const repaired: string[] = [];
  let openFence: OpenFence | null = null;
  let changed = false;

  for (const line of lines) {
    if (openFence && SUMMARY_BOUNDARY_PATTERN.test(line)) {
      repaired.push(openFence.marker.repeat(openFence.length));
      repaired.push("");
      openFence = null;
      changed = true;
    }

    repaired.push(line);

    const fence = parseFenceLine(line);
    if (!fence) continue;

    if (!openFence) {
      openFence = fence;
      continue;
    }

    if (closesFence(line, openFence)) {
      openFence = null;
    }
  }

  if (openFence) {
    repaired.push(openFence.marker.repeat(openFence.length));
    changed = true;
  }

  return changed ? repaired.join("\n") : content;
};
