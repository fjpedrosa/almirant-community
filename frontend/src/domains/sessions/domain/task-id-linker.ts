// Regex for task IDs: PROJECT_PREFIX-[TYPE_PREFIX-]NUMBER
// Examples: A-T-37, A-1064, MC-S-1, A-F-125, A-E-52
export const TASK_ID_REGEX = /\b([A-Z]{1,4}(?:-[ETFSK])?-\d+)\b/g;

export function extractTaskIds(text: string): string[] {
  const matches = text.match(TASK_ID_REGEX);
  return matches ? [...new Set(matches)] : [];
}
