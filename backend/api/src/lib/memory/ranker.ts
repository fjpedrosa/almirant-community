import type { ObservationSearchRow } from "@almirant/database";

export const OBSERVATION_TYPE_PREFIX: Record<string, string> = {
  decision: "decision/",
  architecture: "arch/",
  bugfix: "bugfix/",
  pattern: "pattern/",
  config: "config/",
  discovery: "discovery/",
  learning: "learning/",
  error_diagnosis: "error/",
  work_item: "work-item/",
  todo_item: "todo/",
  seed: "seed/",
};

export type ConfidenceBand = "trusted" | "retrievable" | "quarantined";

export const normalizeTopicKey = (type: string, topicKey: string): string => {
  const prefix = OBSERVATION_TYPE_PREFIX[type];
  if (!prefix) return topicKey.trim();
  const normalized = topicKey.trim().replace(/^\/+/, "");
  return normalized.startsWith(prefix) ? normalized : `${prefix}${normalized}`;
};

export const validateTopicKeyForType = (type: string, topicKey: string) => {
  const normalized = normalizeTopicKey(type, topicKey);
  if (!/^[a-z0-9-]+(\/[a-z0-9-]+){0,3}$/.test(normalized)) {
    throw new Error(
      `Invalid topicKey "${topicKey}". Expected slug format like "${OBSERVATION_TYPE_PREFIX[type] ?? "topic/"}example".`
    );
  }
  return normalized;
};

export const parseConfidence = (value: unknown): number => {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : 0;
  if (Number.isNaN(parsed)) return 0;
  return Math.min(1, Math.max(0, parsed));
};

export const getConfidenceBand = (
  confidence: unknown,
  verifiedByUserId?: string | null
): ConfidenceBand => {
  if (verifiedByUserId) return "trusted";
  const parsed = parseConfidence(confidence);
  if (parsed >= 0.8) return "trusted";
  if (parsed >= 0.4) return "retrievable";
  return "quarantined";
};

export const rankObservationResults = (
  results: ObservationSearchRow[],
  query: string
) => {
  const normalizedQuery = query.trim().toLowerCase();
  return results
    .map((row) => {
      const tsRank =
        typeof row.rank === "number" ? row.rank : Number(row.rank ?? 0);
      const ageDays = Math.max(
        0,
        (Date.now() - new Date(row.updatedAt).getTime()) / 86_400_000
      );
      const recencyScore = Math.max(0, 1 - ageDays / 30);
      const exactTopicBoost =
        row.topicKey.toLowerCase() === normalizedQuery ||
        normalizedQuery.includes(row.topicKey.toLowerCase())
          ? 1
          : 0;
      const score = tsRank * 0.5 + recencyScore * 0.3 + exactTopicBoost * 0.2;
      return {
        observation: row,
        score: Number(score.toFixed(4)),
        confidence: parseConfidence(row.confidence),
        confidenceBand: getConfidenceBand(row.confidence, row.verifiedByUserId),
        charLength: row.title.length + row.content.length,
      };
    })
    .sort((a, b) => b.score - a.score);
};
