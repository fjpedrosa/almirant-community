export interface CronPreset {
  label: string;
  expression: string;
}

export const CRON_PRESETS: CronPreset[] = [
  { label: "5m", expression: "*/5 * * * *" },
  { label: "15m", expression: "*/15 * * * *" },
  { label: "30m", expression: "*/30 * * * *" },
  { label: "1h", expression: "0 * * * *" },
  { label: "6h", expression: "0 */6 * * *" },
  { label: "Daily", expression: "0 9 * * *" },
  { label: "Weekly", expression: "0 9 * * 1" },
];

/** Returns the matching preset label, or null if custom. */
export const findCronPreset = (expression: string): string | null => {
  const match = CRON_PRESETS.find((p) => p.expression === expression);
  return match?.label ?? null;
};
