"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { UseQueryResult } from "@tanstack/react-query";
import {
  Activity,
  Copy,
  RefreshCw,
  Zap,
  ChevronDown,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import useFormattedDate from "@/domains/shared/application/hooks/use-formatted-date";
import type {
  DebugAnalysisStatus,
  DebugBundleMeta,
  IncidentBundleResponse,
  IncidentBundleTimelineEntry,
} from "../../domain/types";

export interface IncidentBundleInspectorProps {
  bundleId: string;
  meta: DebugBundleMeta;
  query: UseQueryResult<IncidentBundleResponse>;
  onRefresh: () => void;
  onReanalyze: () => void;
  isRefreshing: boolean;
  isReanalyzing: boolean;
}

const STATUS_CLASS: Record<DebugAnalysisStatus, string> = {
  queued:
    "bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-800",
  running:
    "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800",
  completed:
    "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800",
  failed:
    "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800",
};

const NOT_SCHEDULED_CLASS = "bg-muted text-muted-foreground border-border";

const ACTOR_DOT_CLASS: Record<IncidentBundleTimelineEntry["actor"], string> = {
  user: "bg-blue-500",
  backend: "bg-slate-500",
  runner: "bg-violet-500",
  ai: "bg-emerald-500",
  system: "bg-muted-foreground",
};

const VISIBLE_COUNT = 50;

export const IncidentBundleInspector: React.FC<IncidentBundleInspectorProps> = ({
  bundleId,
  meta,
  query,
  onRefresh,
  onReanalyze,
  isRefreshing,
  isReanalyzing,
}) => {
  const t = useTranslations("feedback");
  const { formatRelative, formatDateTime } = useFormattedDate();
  const [showAllEntries, setShowAllEntries] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(bundleId);
      showToast.success(t("incidentBundle.copied"));
    } catch {
      showToast.error(t("incidentBundle.copyError"));
    }
  };

  // --- Loading / error / empty states ---
  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <h4 className="text-sm font-medium flex items-center gap-2">
          <Activity className="h-4 w-4" />
          {t("incidentBundle.title")}
        </h4>
        <p className="text-xs text-muted-foreground italic">{t("incidentBundle.loading")}</p>
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="space-y-4">
        <h4 className="text-sm font-medium flex items-center gap-2">
          <Activity className="h-4 w-4" />
          {t("incidentBundle.title")}
        </h4>
        <div className="rounded border border-red-200 bg-red-50 p-2 dark:border-red-800 dark:bg-red-900/20">
          <p className="text-xs font-medium text-red-700 dark:text-red-400 mb-0.5">
            {t("incidentBundle.loadError")}
          </p>
          {query.error instanceof Error && (
            <p className="text-xs text-red-600 dark:text-red-300">{query.error.message}</p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={isRefreshing}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isRefreshing ? "animate-spin" : ""}`} />
          {t("incidentBundle.refresh")}
        </Button>
      </div>
    );
  }

  const data = query.data;

  // --- Main render ---
  const bundle = data?.bundle;
  const timeline = data?.timeline;
  const entries = timeline?.entries ?? [];
  const visibleEntries = showAllEntries ? entries : entries.slice(0, VISIBLE_COUNT);

  return (
    <div className="space-y-4">
      {/* Header */}
      <h4 className="text-sm font-medium flex items-center gap-2">
        <Activity className="h-4 w-4" />
        {t("incidentBundle.title")}
      </h4>

      {/* Identity row */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Bundle ID — truncated + copy button */}
        <div className="flex items-center gap-1">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="font-mono text-xs text-muted-foreground cursor-default">
                  {bundleId.slice(0, 8)}…
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="font-mono text-xs break-all">{bundleId}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <button
            onClick={handleCopy}
            className="text-muted-foreground hover:text-foreground transition-colors"
            title={t("incidentBundle.copy")}
          >
            <Copy className="h-3 w-3" />
          </button>
        </div>

        {/* Status badge */}
        <Badge
          variant="outline"
          className={`text-xs font-medium ${meta.status ? STATUS_CLASS[meta.status] : NOT_SCHEDULED_CLASS}`}
        >
          {meta.status
            ? t(`incidentBundle.statusLabels.${meta.status}`)
            : t("incidentBundle.statusLabels.notScheduled")}
        </Badge>

        {/* Started at */}
        {meta.startedAt && (
          <span className="text-xs text-muted-foreground">
            {t("incidentBundle.startedAt")}: {formatDateTime(meta.startedAt)}
          </span>
        )}
      </div>

      {/* Actions row */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={isRefreshing}
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isRefreshing ? "animate-spin" : ""}`} />
          {t("incidentBundle.refresh")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onReanalyze}
          disabled={isReanalyzing}
        >
          <Zap className="h-3.5 w-3.5 mr-1.5" />
          {t("incidentBundle.reanalyze")}
        </Button>
      </div>

      {/* Stale note */}
      {(meta.status === "queued" || meta.status === "running") && (
        <p className="text-xs text-muted-foreground italic">{t("incidentBundle.mayBeStale")}</p>
      )}

      {/* Job info */}
      {bundle?.job && (
        <>
          <Separator />
          <div className="space-y-2">
            <h5 className="text-xs font-medium text-muted-foreground">{t("incidentBundle.job")}</h5>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <div>
                <span className="text-muted-foreground">{t("incidentBundle.jobStatus")}</span>
                <p className="font-medium">{bundle.job.status}</p>
              </div>
              <div>
                <span className="text-muted-foreground">{t("incidentBundle.jobType")}</span>
                <p className="font-medium">{bundle.job.jobType}</p>
              </div>
              {bundle.job.skillName && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">{t("incidentBundle.skill")}</span>
                  <p className="font-mono text-[11px]">{bundle.job.skillName}</p>
                </div>
              )}
            </div>
            {bundle.job.errorMessage && (
              <div className="rounded border border-red-200 bg-red-50 p-2 dark:border-red-800 dark:bg-red-900/20">
                <p className="text-xs font-medium text-red-700 dark:text-red-400 mb-0.5">
                  {t("incidentBundle.errorMessage")}
                </p>
                <p className="text-xs text-red-600 dark:text-red-300 line-clamp-3">
                  {bundle.job.errorMessage}
                </p>
              </div>
            )}
          </div>
        </>
      )}

      {/* Counters */}
      {bundle && (
        <>
          <Separator />
          <div className="space-y-2">
            <h5 className="text-xs font-medium text-muted-foreground">{t("incidentBundle.counts")}</h5>
            <div className="flex items-center gap-6 text-xs">
              <div>
                <span className="text-muted-foreground">{t("incidentBundle.sessionEvents")}</span>
                <p className="font-semibold">{bundle.sessionEvents.length}</p>
              </div>
              <div>
                <span className="text-muted-foreground">{t("incidentBundle.jobLogs")}</span>
                <p className="font-semibold">{bundle.jobLogs.length}</p>
              </div>
              <div>
                <span className="text-muted-foreground">{t("incidentBundle.errorMemory")}</span>
                <p className="font-semibold">{bundle.errorMemory.length}</p>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Error memory */}
      {bundle && bundle.errorMemory.length > 0 && (
        <>
          <Separator />
          <div className="space-y-2">
            <h5 className="text-xs font-medium text-muted-foreground">{t("incidentBundle.errorMemory")}</h5>
            <ul className="space-y-1.5">
              {bundle.errorMemory.map((entry, i) => (
                <li key={i} className="text-xs">
                  <span className="font-medium">{entry.title}</span>
                  <span className="text-muted-foreground ml-1.5">
                    {entry.type} · {entry.topicKey}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {/* Timeline */}
      {timeline && (
        <>
          <Separator />
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <h5 className="text-xs font-medium text-muted-foreground">
                {t("incidentBundle.timeline")} ({entries.length})
              </h5>
              {timeline.truncated && (
                <span className="text-xs text-yellow-600 dark:text-yellow-400">
                  {t("incidentBundle.timelineTruncated")}
                </span>
              )}
            </div>

            {entries.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                {t("incidentBundle.timelineEmpty")}
              </p>
            ) : (
              <Collapsible defaultOpen={true}>
                <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  <ChevronDown className="h-3.5 w-3.5" />
                  {t("incidentBundle.timeline")}
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ul className="mt-2 space-y-1.5">
                    {visibleEntries.map((entry, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span
                          className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${ACTOR_DOT_CLASS[entry.actor]}`}
                        />
                        <div className="min-w-0 flex-1">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-[11px] font-mono text-muted-foreground cursor-default">
                                  {entry.source} · {formatRelative(entry.t)}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="bottom">
                                <p className="font-mono text-xs">{formatDateTime(entry.t)}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          <p className="text-xs line-clamp-2">{entry.summary}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {!showAllEntries && entries.length > VISIBLE_COUNT && (
                    <button
                      onClick={() => setShowAllEntries(true)}
                      className="mt-2 text-xs text-primary hover:underline"
                    >
                      {t("incidentBundle.showAll", { count: entries.length })}
                    </button>
                  )}
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        </>
      )}
    </div>
  );
};
