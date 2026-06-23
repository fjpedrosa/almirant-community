"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { useAiFormatText } from "@/domains/shared/application/hooks/use-ai-format-text";
import { parseChangelogForShare } from "../utils/parse-changelog-for-share";
import {
  buildSharePostPromptInput,
  formatGeneratedSharePost,
  formatXThread,
} from "../utils/format-x-thread";
import type {
  DoneItemPreview,
  SprintReportData,
  SprintShareSource,
  SprintShareFormatInput,
  SprintShareThreadDraft,
} from "../../domain/types";

const MAX_HIGHLIGHTS_PER_SECTION = 6;
const X_INTENT_URL = "https://x.com/intent/tweet";

const asHighlight = (title: string): string => title;

const fallbackSectionsFromReport = (report: SprintReportData) => {
  if (report.completedTasks.items.length === 0) return [];

  return [
    {
      heading: "Completed items",
      summary: `${report.completedTasks.count} completed items in ${report.sprint.name}.`,
      highlights: report.completedTasks.items
        .slice(0, MAX_HIGHLIGHTS_PER_SECTION)
        .map((item) => asHighlight(item.title)),
    },
  ];
};

export const buildSprintShareSourceFromReport = (
  report: SprintReportData
): SprintShareSource | null => {
  const parsed = report.changelog
    ? parseChangelogForShare(report.changelog)
    : { title: null, sections: [] };

  const sections = parsed.sections.length > 0
    ? parsed.sections
    : fallbackSectionsFromReport(report);

  if (sections.length === 0) return null;

  return {
    mode: "sprint",
    title: parsed.title ?? report.sprint.name,
    intro: "Sprint wrap-up.",
    sections,
  };
};

const pickBestGroupHeading = (item: DoneItemPreview): string => {
  const ancestors = item.ancestors ?? [];

  const feature = ancestors.find((ancestor) => ancestor.type === "feature");
  if (feature) return feature.title;

  const epic = ancestors.find((ancestor) => ancestor.type === "epic");
  if (epic) return epic.title;

  const directParent = ancestors[0];
  if (directParent) return directParent.title;

  return "Updates";
};

export const buildLast7dShareSource = (
  items: DoneItemPreview[]
): SprintShareSource | null => {
  if (items.length === 0) return null;

  const grouped = new Map<string, DoneItemPreview[]>();
  for (const item of items) {
    const key = pickBestGroupHeading(item);
    const current = grouped.get(key) ?? [];
    current.push(item);
    grouped.set(key, current);
  }

  const sections = Array.from(grouped.entries()).map(([heading, groupItems]) => ({
    heading,
    summary: `${groupItems.length} completed items in the last 7 days.`,
    highlights: groupItems
      .slice(0, MAX_HIGHLIGHTS_PER_SECTION)
      .map((item) => item.title),
  }));

  return {
    mode: "last7d",
    title: "Last 7 days of progress",
    intro: "Weekly product progress.",
    sections,
  };
};

export const useSprintShare = (source: SprintShareSource | null) => {
  const t = useTranslations("sprints.report.share");
  const { mutate: formatWithAi, isPending: isAiFormatting } = useAiFormatText();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [draft, setDraft] = useState<SprintShareThreadDraft | null>(null);
  const generationRef = useRef(0);
  const formatWithAiRef = useRef(formatWithAi);

  useEffect(() => {
    formatWithAiRef.current = formatWithAi;
  }, [formatWithAi]);

  const formatInput = useMemo<SprintShareFormatInput | null>(() => {
    if (!source) return null;

    return {
      mode: source.mode,
      title: source.title,
      intro: source.intro,
      sections: source.sections,
      ctaText: source.ctaText,
      ctaUrl: source.ctaUrl,
      hashtags: source.hashtags,
    };
  }, [source]);

  useEffect(() => {
    if (!formatInput) {
      setDraft(null);
      return;
    }

    setDraft(formatXThread(formatInput));
  }, [formatInput]);

  useEffect(() => {
    if (!isDialogOpen || !formatInput) return;

    generationRef.current += 1;
    const currentGeneration = generationRef.current;

    formatWithAiRef.current(
      {
        text: buildSharePostPromptInput(formatInput),
        fieldContext: "sharePost",
      },
      {
        onSuccess: (data) => {
          if (generationRef.current !== currentGeneration) return;
          setDraft(formatGeneratedSharePost(formatInput, data.formattedText));
        },
      }
    );
  }, [isDialogOpen, formatInput]);

  const threadText = useMemo(() => {
    if (!draft) return "";
    return draft.tweets.map((tweet) => tweet.text).join("\n\n");
  }, [draft]);

  const isShareAvailable = !!draft && draft.totalTweets > 0;

  const openDialog = useCallback(() => {
    if (!isShareAvailable) {
      showToast.info(t("toastNoContent"));
      return;
    }
    setIsDialogOpen(true);
  }, [isShareAvailable, t]);

  const closeDialog = useCallback(() => {
    setIsDialogOpen(false);
  }, []);

  const copyThread = useCallback(async () => {
    if (!threadText) {
      showToast.error(t("toastNoContent"));
      return;
    }

    try {
      setIsCopying(true);
      await navigator.clipboard.writeText(threadText);
      showToast.success(t("toastCopySuccess"));
    } catch {
      showToast.error(t("toastCopyError"));
    } finally {
      setIsCopying(false);
    }
  }, [threadText, t]);

  const openIntent = useCallback(async () => {
    if (!draft) {
      showToast.error(t("toastNoContent"));
      return;
    }

    const firstTweet = draft.tweets[0]?.text;
    if (!firstTweet) {
      showToast.error(t("toastNoContent"));
      return;
    }

    if (threadText) {
      try {
        await navigator.clipboard.writeText(threadText);
      } catch {
        // Non-blocking: open intent should continue even if clipboard fails.
      }
    }

    const url = `${X_INTENT_URL}?text=${encodeURIComponent(firstTweet)}`;
    window.open(url, "_blank", "noopener,noreferrer");

    if (draft.totalTweets > 1) {
      showToast.success(t("toastOpenMulti"));
      return;
    }

    showToast.success(t("toastOpenSingle"));
  }, [draft, threadText, t]);

  return {
    draft,
    isDialogOpen,
    isCopying,
    isShareAvailable,
    openDialog,
    closeDialog,
    setIsDialogOpen,
    copyThread,
    openIntent,
    isPreparing: isAiFormatting,
  };
};
