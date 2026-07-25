"use client";

import { useCallback, useMemo, useState } from "react";

/** Above this many rendered lines a message is long enough that showing it in
 *  full buries the actual conversation under the launch prompt. */
const DEFAULT_LINE_THRESHOLD = 12;

/** Wrapped prose adds lines the raw `\n` count cannot see, so cap on size too. */
const DEFAULT_CHARACTER_THRESHOLD = 700;

export interface CollapsibleTextState {
  /** True when the content is long enough to be worth collapsing. */
  isCollapsible: boolean;
  /** True when the content is currently clipped. */
  isCollapsed: boolean;
  /** Total line count, for the "show more" affordance. */
  lineCount: number;
  toggle: () => void;
}

export interface UseCollapsibleTextOptions {
  lineThreshold?: number;
  characterThreshold?: number;
}

export const useCollapsibleText = (
  content: string,
  options: UseCollapsibleTextOptions = {},
): CollapsibleTextState => {
  const {
    lineThreshold = DEFAULT_LINE_THRESHOLD,
    characterThreshold = DEFAULT_CHARACTER_THRESHOLD,
  } = options;

  const [isExpanded, setIsExpanded] = useState(false);

  const lineCount = useMemo(() => content.split("\n").length, [content]);

  const isCollapsible =
    lineCount > lineThreshold || content.length > characterThreshold;

  const toggle = useCallback(() => setIsExpanded((expanded) => !expanded), []);

  return {
    isCollapsible,
    isCollapsed: isCollapsible && !isExpanded,
    lineCount,
    toggle,
  };
};
