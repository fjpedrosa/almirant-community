import type { BoardFilterPreferences } from "./types";

export const PERSISTABLE_BOARD_FILTER_KEYS = [
  "priority",
  "assignee",
  "tagIds",
  "projectId",
  "isBug",
] as const;

const VALID_WORK_ITEM_TYPES = new Set(["epic", "feature", "story", "task"]);

type BoardFilterParamKey = (typeof PERSISTABLE_BOARD_FILTER_KEYS)[number];

type BoardFilterParamSource =
  | { get: (key: string) => string | null }
  | Record<string, string | string[] | undefined>;

const readParam = (source: BoardFilterParamSource, key: string): string | null => {
  if ("get" in source && typeof source.get === "function") {
    return source.get(key);
  }

  const value = (source as Record<string, string | string[] | undefined>)[key];
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
};

/**
 * Reads board filters independently of the dynamic filter option lists.
 *
 * Project and tag definitions are populated asynchronously. Reading these
 * values directly keeps a URL filter authoritative even while those option
 * lists are still loading, which is important for the first backend request.
 */
export const getBoardFilterParamsFromSearchParams = (
  source: BoardFilterParamSource,
  options: { includeSearch?: boolean } = {},
): Record<string, string> => {
  const params: Record<string, string> = {};

  for (const key of PERSISTABLE_BOARD_FILTER_KEYS) {
    const value = readParam(source, key);
    if (value) params[key] = value;
  }

  const type = readParam(source, "type");
  if (type && VALID_WORK_ITEM_TYPES.has(type)) params.type = type;

  if (options.includeSearch) {
    const search = readParam(source, "search");
    if (search) params.search = search;
  }

  return params;
};

export const hasExplicitBoardFilterParams = (
  source: BoardFilterParamSource,
): boolean =>
  [...PERSISTABLE_BOARD_FILTER_KEYS, "type"].some(
    (key) => readParam(source, key) !== null,
  );

export const mergePersistedBoardFilterParams = (
  currentParams: Record<string, string>,
  preferences: BoardFilterPreferences,
  hasExplicitUrlFilters: boolean,
): Record<string, string> => {
  if (hasExplicitUrlFilters) return currentParams;

  const mergedParams = { ...currentParams };
  for (const key of PERSISTABLE_BOARD_FILTER_KEYS) {
    const value = preferences[key as BoardFilterParamKey];
    if (typeof value === "string" && value.length > 0) {
      mergedParams[key] = value;
    }
  }

  return mergedParams;
};
