// ---------------------------------------------------------------------------
// Shared helper -- relative time formatter for the GitHub presentation layer.
// Pure function, no React dependency.
// ---------------------------------------------------------------------------

export const timeAgo = (dateStr: string): string => {
  const d = new Date(dateStr);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);

  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;

  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;

  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};
