export const formatTokens = (value: number): string => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toString();
};

export const formatCost = (value: number): string => `$${value.toFixed(2)}`;

export const formatDuration = (totalHours: number): string => {
  if (!Number.isFinite(totalHours) || totalHours <= 0) {
    return "0h";
  }

  const totalMinutes = Math.round(totalHours * 60);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const segments: string[] = [];

  if (days > 0) {
    segments.push(`${days}d`);
  }

  if (hours > 0) {
    segments.push(`${hours}h`);
  }

  if (minutes > 0) {
    segments.push(`${minutes}m`);
  }

  return segments.length > 0 ? segments.join(" ") : "0h";
};

export const formatDurationDaysHours = (totalHours: number): string => {
  const days = Math.floor(totalHours / 24);
  const hours = Math.round(totalHours % 24);
  if (days === 0) return `${hours}h`;
  if (hours === 0) return `${days}d`;
  return `${days}d ${hours}h`;
};

export const computeExpectedPercent = (resetsAt: string, windowDurationMs: number): number => {
  const now = Date.now();
  const resetsAtMs = new Date(resetsAt).getTime();
  const windowStartMs = resetsAtMs - windowDurationMs;
  const elapsed = now - windowStartMs;
  return Math.min(100, Math.max(0, (elapsed / windowDurationMs) * 100));
};
