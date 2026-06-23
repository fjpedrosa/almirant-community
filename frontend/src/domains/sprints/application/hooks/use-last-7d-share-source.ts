"use client";

import { useMemo } from "react";
import { useDonePreviewByDateRange } from "./use-sprints";
import { buildLast7dShareSource } from "./use-sprint-share";

const toLocalDate = (value: Date): string =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;

const getLast7dRange = () => {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 6);

  return {
    from,
    to,
    fromISO: toLocalDate(from),
    toISO: toLocalDate(to),
  };
};

export const useLast7dShareSource = (boardId: string, enabled = true) => {
  const range = useMemo(() => getLast7dRange(), []);

  const query = useDonePreviewByDateRange(
    boardId,
    range.fromISO,
    range.toISO,
    enabled
  );

  const source = useMemo(
    () => buildLast7dShareSource(query.data ?? []),
    [query.data]
  );

  return {
    source,
    items: query.data ?? [],
    isLoading: query.isLoading,
    fromISO: range.fromISO,
    toISO: range.toISO,
  };
};
