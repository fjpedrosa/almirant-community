export function mdEscape(text: string): string {
  // For parse_mode=Markdown (not V2). Keep this minimal; just guard against null/undefined.
  return String(text ?? "");
}

export function truncate(text: string, max: number): string {
  const s = String(text ?? "");
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

export function normalizeLoose(text: string): string {
  return String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function fuzzyPickOne(
  input: string,
  candidates: { id: string; name: string }[]
): { id: string; name: string } | null {
  const q = normalizeLoose(input);
  if (!q) return null;

  const scored = candidates
    .map((c) => {
      const n = normalizeLoose(c.name);
      const exact = n === q ? 1000 : 0;
      const starts = n.startsWith(q) ? 200 : 0;
      const includes = n.includes(q) ? 100 : 0;
      const tokenHits = q
        .split(" ")
        .filter(Boolean)
        .reduce((sum, t) => sum + (n.includes(t) ? 10 : 0), 0);
      const score = exact + starts + includes + tokenHits;
      return { ...c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.name.length - b.name.length);

  return scored[0] ? { id: scored[0].id, name: scored[0].name } : null;
}

