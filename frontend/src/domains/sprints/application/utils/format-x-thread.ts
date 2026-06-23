import type {
  SprintShareFormatInput,
  SprintShareSection,
  SprintShareThreadDraft,
} from "../../domain/types";

const DEFAULT_MAX_POST_LENGTH = 280;
const MIN_MAX_POST_LENGTH = 120;
const MAX_BULLETS = 5;
const MAX_CONTEXT_HIGHLIGHTS = 12;
const DEFAULT_CTA = "Built with Almirant — plan, control, document, ship: https://almirant.ai";

const VALUE_KEYWORDS = [
  "user",
  "customer",
  "faster",
  "easier",
  "clearer",
  "visibility",
  "automation",
  "quality",
  "control",
  "planning",
  "documentation",
  "workflow",
  "report",
  "share",
  "collaboration",
  "onboarding",
];

const TECHNICAL_KEYWORDS = [
  "refactor",
  "endpoint",
  "schema",
  "migration",
  "drizzle",
  "websocket",
  "lint",
  "typecheck",
  "ci",
  "orm",
  "query",
  "hook",
  "tsx",
  "ts",
];

const normalizeWhitespace = (value: string): string =>
  value.replace(/\s+/g, " ").trim();

const sanitizeLine = (value: string): string =>
  normalizeWhitespace(
    value
      .replace(/[#*_`]/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\b(?:[A-Z]+-\d+)\b/g, "")
      .replace(/^\d+[\).\s]+/, "")
  );

const truncate = (value: string, maxLength: number): string => {
  const clean = sanitizeLine(value);
  if (clean.length <= maxLength) return clean;
  if (maxLength <= 3) return clean.slice(0, maxLength);
  return `${clean.slice(0, maxLength - 3).trimEnd()}...`;
};

const normalizeKey = (value: string): string =>
  sanitizeLine(value).toLowerCase();

const scoreCandidate = (value: string): number => {
  const normalized = normalizeKey(value);
  if (!normalized) return -100;

  let score = 0;

  for (const keyword of VALUE_KEYWORDS) {
    if (normalized.includes(keyword)) score += 2;
  }

  for (const keyword of TECHNICAL_KEYWORDS) {
    if (normalized.includes(keyword)) score -= 2;
  }

  if (/\//.test(normalized)) score -= 2;
  if (normalized.length > 110) score -= 1;
  if (normalized.length < 16) score -= 1;

  return score;
};

const candidateFromSectionSummary = (section: SprintShareSection): string | null => {
  const heading = sanitizeLine(section.heading);
  const summary = sanitizeLine(section.summary);
  if (!summary) return null;
  if (!heading) return summary;
  return `${heading}: ${summary}`;
};

const extractCandidates = (sections: SprintShareSection[]): string[] => {
  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const section of sections) {
    const summaryCandidate = candidateFromSectionSummary(section);
    if (summaryCandidate) {
      const key = normalizeKey(summaryCandidate);
      if (!seen.has(key)) {
        seen.add(key);
        candidates.push(summaryCandidate);
      }
    }

    for (const highlight of section.highlights) {
      const clean = sanitizeLine(highlight);
      if (!clean) continue;
      const key = normalizeKey(clean);
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(clean);
    }
  }

  return candidates;
};

const pickHighlights = (sections: SprintShareSection[], limit: number) => {
  const candidates = extractCandidates(sections);
  const sorted = [...candidates].sort((a, b) => {
    const byScore = scoreCandidate(b) - scoreCandidate(a);
    if (byScore !== 0) return byScore;
    return a.length - b.length;
  });

  const selected = sorted.slice(0, Math.max(1, limit)).map((item) => truncate(item, 58));
  return {
    selected,
    total: sorted.length,
    overflow: Math.max(0, sorted.length - selected.length),
  };
};

const buildValueSummary = (sections: SprintShareSection[]): string => {
  const snippets = sections
    .map((section) => sanitizeLine(section.summary))
    .filter(Boolean)
    .slice(0, 2);

  if (snippets.length === 0) {
    return "we shipped updates people can feel.";
  }

  return truncate(snippets.join(" "), 90);
};

const buildHookLine = (mode: SprintShareFormatInput["mode"], valueSummary: string): string => {
  const base = mode === "last7d"
    ? "Shipped more than meetings this week 😎"
    : "Sprint closed and users felt the upgrades 😎";
  return truncate(`${base} ${valueSummary}`, 120);
};

const enforceSingleEmoji = (value: string): string => {
  const emojis = Array.from(value.matchAll(/\p{Extended_Pictographic}/gu)).map((match) => match[0]);
  if (emojis.length <= 1) return value;
  const firstEmoji = emojis[0];
  let consumed = false;
  return value.replace(/\p{Extended_Pictographic}/gu, (emoji) => {
    if (!consumed && emoji === firstEmoji) {
      consumed = true;
      return emoji;
    }
    return "";
  });
};

const buildPost = (args: {
  hook: string;
  bullets: string[];
  overflow: number;
  cta: string;
}): string => {
  const bulletLines = args.bullets.map((bullet) => `• ${sanitizeLine(bullet)}`).filter(Boolean);
  if (args.overflow > 0) {
    bulletLines.push(`• +${args.overflow} more improvements`);
  }
  return [sanitizeLine(args.hook), ...bulletLines, sanitizeLine(args.cta)]
    .filter(Boolean)
    .join("\n");
};

const compactPostToMaxLength = (
  hook: string,
  rawBullets: string[],
  overflowCount: number,
  maxLength: number
): string => {
  let compactHook = enforceSingleEmoji(sanitizeLine(hook));
  let bullets = rawBullets.map((item) => sanitizeLine(item)).filter(Boolean).slice(0, MAX_BULLETS);
  let overflow = Math.max(0, overflowCount);

  const cta = DEFAULT_CTA;

  const compose = () =>
    buildPost({
      hook: compactHook,
      bullets,
      overflow,
      cta,
    });

  while (compose().length > maxLength && bullets.length > 1) {
    bullets.pop();
    overflow += 1;
  }

  while (compose().length > maxLength && bullets.some((bullet) => bullet.length > 24)) {
    bullets = bullets.map((bullet) => truncate(bullet, Math.max(24, bullet.length - 6)));
  }

  if (compose().length > maxLength) {
    compactHook = truncate(compactHook, 72);
  }

  if (compose().length <= maxLength) {
    return compose();
  }

  const firstBullet = bullets[0] ? `• ${truncate(bullets[0], 54)}` : "• Shipped meaningful product improvements";
  const compactBody = `${compactHook}\n${firstBullet}`;
  const maxBodyLength = Math.max(24, maxLength - cta.length - 1);
  const trimmedBody = truncate(compactBody, maxBodyLength);
  const fallback = `${trimmedBody}\n${cta}`;
  if (fallback.length <= maxLength) return fallback;

  return truncate(compactHook, maxBodyLength) + `\n${cta}`;
};

const isCtaLine = (line: string): boolean => {
  const normalized = line.toLowerCase();
  return normalized.includes("almirant") && normalized.includes("http");
};

const toDraft = (input: SprintShareFormatInput, text: string): SprintShareThreadDraft => {
  const cleanText = text.includes("\n")
    ? text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n")
    : sanitizeLine(text);

  return {
    mode: input.mode,
    title: sanitizeLine(input.title),
    totalTweets: 1,
    tweets: [
      {
        index: 1,
        text: cleanText,
        characterCount: cleanText.length,
      },
    ],
  };
};

export const buildSharePostPromptInput = (input: SprintShareFormatInput): string => {
  const valueSummary = buildValueSummary(input.sections);
  const highlights = pickHighlights(input.sections, MAX_CONTEXT_HIGHLIGHTS);

  const lines = [
    `Share mode: ${input.mode}`,
    `Title: ${sanitizeLine(input.title)}`,
    `Value summary: ${valueSummary}`,
    `Candidate user-facing improvements (${highlights.selected.length}/${highlights.total}):`,
    ...highlights.selected.map((item) => `- ${item}`),
  ];

  if (highlights.overflow > 0) {
    lines.push(`Additional improvements not listed individually: ${highlights.overflow}`);
  }

  return lines.join("\n");
};

export const formatGeneratedSharePost = (
  input: SprintShareFormatInput,
  generatedText: string
): SprintShareThreadDraft => {
  const lines = generatedText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const contentLines = lines.filter((line) => !isCtaLine(line));

  const parsedHook = contentLines.find((line) => !line.startsWith("•") && !line.startsWith("- ")) ?? "";
  const parsedBullets = contentLines
    .filter((line) => line.startsWith("•") || line.startsWith("- "))
    .map((line) => line.replace(/^[-•]\s*/, ""));

  const fallbackHighlights = pickHighlights(input.sections, MAX_BULLETS);
  const hook = parsedHook || buildHookLine(input.mode, buildValueSummary(input.sections));
  const bullets = parsedBullets.length > 0 ? parsedBullets : fallbackHighlights.selected;
  const overflow = fallbackHighlights.total > bullets.length
    ? fallbackHighlights.total - bullets.length
    : 0;

  const maxPostLength = Math.max(
    MIN_MAX_POST_LENGTH,
    input.maxTweetLength ?? DEFAULT_MAX_POST_LENGTH
  );

  const compacted = compactPostToMaxLength(hook, bullets, overflow, maxPostLength);
  return toDraft(input, compacted);
};

export const formatXThread = (input: SprintShareFormatInput): SprintShareThreadDraft => {
  const valueSummary = buildValueSummary(input.sections);
  const highlights = pickHighlights(input.sections, MAX_BULLETS);
  const hook = buildHookLine(input.mode, valueSummary);

  const maxPostLength = Math.max(
    MIN_MAX_POST_LENGTH,
    input.maxTweetLength ?? DEFAULT_MAX_POST_LENGTH
  );

  const compacted = compactPostToMaxLength(
    hook,
    highlights.selected,
    highlights.overflow,
    maxPostLength
  );

  return toDraft(input, compacted);
};
