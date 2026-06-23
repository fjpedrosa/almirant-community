const stripDiacritics = (input: string): string => {
  // NFD splits diacritics into separate code points; then we strip the marks.
  return input.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
};

const toWords = (input: string): string[] => {
  const ascii = stripDiacritics(input)
    .toLowerCase()
    .replace(/['`"’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  return ascii ? ascii.split(/\s+/g).filter(Boolean) : [];
};

const sanitizeGitRef = (input: string): string => {
  // Conservative subset of git-check-ref-format rules.
  // Allow only: A-Z a-z 0-9 / - _ . (we'll also collapse dots and slashes defensively)
  let s = input
    .replace(/[^A-Za-z0-9/._-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/\/+/g, "/")
    .replace(/-+/g, "-")
    .replace(/^[-/.]+/, "")
    .replace(/[-/.]+$/, "");

  // Disallow sequences that git rejects.
  s = s.replace(/@\{/g, "-");
  s = s.replace(/\.lock$/g, "-lock");

  return s;
};

export const generateBranchName = (taskId: string, title: string): string => {
  const prefix = `agent/${taskId}-`;
  const maxLen = 60;
  const budget = Math.max(0, maxLen - prefix.length);

  const words = toWords(title);
  const parts: string[] = [];

  let current = "";
  for (const w of words) {
    const next = current ? `${current}-${w}` : w;
    if (next.length > budget) break;
    current = next;
    parts.push(w);
  }

  let slug = parts.join("-");
  if (!slug) {
    // Fallback: minimal, still deterministic.
    slug = "task";
  }

  const full = sanitizeGitRef(`${prefix}${slug}`);
  if (!full) {
    return sanitizeGitRef(`agent/${taskId}`) || `agent/${taskId}`;
  }

  // Hard cap as a final guard.
  return full.length <= maxLen ? full : full.slice(0, maxLen).replace(/[-/.]+$/, "");
};
