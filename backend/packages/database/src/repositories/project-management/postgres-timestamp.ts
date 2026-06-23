/**
 * Convert JavaScript dates into a parameter format PostgreSQL accepts for
 * `timestamptz` comparisons.
 *
 * Why this exists: passing a Date object through the runner/API path can reach
 * postgres as the JS display string (`Sun May ... GMT+0000 (...)`), which
 * PostgreSQL rejects for `timestamp with time zone`. ISO-8601 is stable and
 * accepted by Postgres.
 */
export const toPostgresTimestamptzParam = (date: Date): string => {
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid timestamp");
  }

  return date.toISOString();
};
