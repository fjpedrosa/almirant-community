import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  XIcon,
  Rocket,
  Loader2,
  Wrench,
  GitMerge,
  XCircle,
  RotateCcw,
  ExternalLink,
  ArrowRight,
  Users,
  Hash,
  Calendar,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ClusterStatusBadge } from "./cluster-status-badge";
import { ClusterDetailPrMergedBanner } from "./cluster-detail-pr-merged-banner";
import { ClusterDetailTimeline } from "./cluster-detail-timeline";
import { deriveLaunchButtonState } from "../../domain/cluster-launch-cta";
import { formatReasonLabel } from "../../domain/cluster-reason-labels";
import { shouldShowPrMergedBanner } from "../../domain/should-show-pr-merged-banner";
import type { ClusterTimelineEvent } from "../../domain/cluster-timeline";
import type {
  BugFixAttemptStatus,
  ClusterActiveAttemptSummary,
  ClusterIncidentContext,
  ClusterLastChangeSummary,
  ClusterStatus,
  ClusterSummary,
  TriageCluster,
} from "../../domain/types";
import type { ClusterSummaryStats } from "../../domain/cluster-summary";

export interface ClusterDetailHeroProps {
  cluster: Pick<
    TriageCluster,
    "title" | "summary" | "suggestedType" | "suggestedPriority" | "itemCount"
  >;
  summary: ClusterSummary;
  stats: ClusterSummaryStats;
  onLaunchInvestigation: () => void;
  onClose: () => void;
  canLaunch: boolean;
  isLaunching: boolean;
  /**
   * Optional dismiss action. When both `onDismiss` and `canDismiss` are
   * provided, the hero renders a destructive "Descartar" button next to
   * the launch CTA. Hidden when the current cluster status does not allow
   * a transition to `dismissed`.
   */
  onDismiss?: () => void;
  canDismiss?: boolean;
  /**
   * Flat timeline of the cluster history (7 event kinds). Rendered inside the
   * hero under the last-change line as a collapsible descriptor list.
   */
  timelineEvents: ClusterTimelineEvent[];
  /**
   * URL of the PR linked to the resolved cluster, if any. Shown inside the
   * "PR mergeado — validación en curso" banner as a "Ver PR" link.
   */
  prUrl: string | null;
  /**
   * Override for the current time. Injected for testability. Defaults to
   * `new Date()` on every render when omitted.
   */
  now?: Date;
}

interface AttemptVisualConfig {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  iconClassName: string;
  badgeClassName: string;
}

const attemptStatusConfig: Record<BugFixAttemptStatus, AttemptVisualConfig> = {
  analyzing: {
    label: "Analizando",
    icon: Loader2,
    iconClassName: "mr-1.5 h-3.5 w-3.5 animate-spin",
    badgeClassName:
      "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800",
  },
  proposed: {
    label: "Propuesto",
    icon: Wrench,
    iconClassName: "mr-1.5 h-3.5 w-3.5",
    badgeClassName:
      "bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800",
  },
  implementing: {
    label: "Implementando",
    icon: Loader2,
    iconClassName: "mr-1.5 h-3.5 w-3.5 animate-spin",
    badgeClassName:
      "bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-900/20 dark:text-indigo-300 dark:border-indigo-800",
  },
  merged: {
    label: "Mergeado",
    icon: GitMerge,
    iconClassName: "mr-1.5 h-3.5 w-3.5",
    badgeClassName:
      "bg-green-50 text-green-800 border-green-200 dark:bg-green-900/20 dark:text-green-300 dark:border-green-800",
  },
  failed: {
    label: "Fallido",
    icon: XCircle,
    iconClassName: "mr-1.5 h-3.5 w-3.5",
    badgeClassName:
      "bg-red-50 text-red-800 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800",
  },
};

const statusLabels: Record<ClusterStatus, string> = {
  open: "Open",
  investigating: "Investigating",
  fix_ready: "Fix Ready",
  resolved: "Resolved",
  regression: "Regression",
  dismissed: "Dismissed",
  promoted: "Promoted",
};

const triggeredByLabels: Record<
  ClusterLastChangeSummary["triggeredByKind"],
  string
> = {
  user: "usuario",
  system: "sistema",
  agent: "agente",
  webhook: "webhook",
};

const formatRelativeTime = (iso: string): string => {
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return iso;
  const diffMs = target - Date.now();
  const absMs = Math.abs(diffMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const month = 30 * day;
  const year = 365 * day;

  const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
  const pick = (
    value: number,
    unit: Intl.RelativeTimeFormatUnit
  ): string => rtf.format(Math.round(value), unit);

  if (absMs < minute) return pick(diffMs / 1000, "second");
  if (absMs < hour) return pick(diffMs / minute, "minute");
  if (absMs < day) return pick(diffMs / hour, "hour");
  if (absMs < week) return pick(diffMs / day, "day");
  if (absMs < month) return pick(diffMs / week, "week");
  if (absMs < year) return pick(diffMs / month, "month");
  return pick(diffMs / year, "year");
};

const formatDateRange = (
  firstTicketAt: string | null,
  lastTicketAt: string | null
): string => {
  if (!firstTicketAt || !lastTicketAt) return "\u2014";

  const formatter = new Intl.DateTimeFormat("es-ES", {
    month: "short",
    day: "numeric",
  });

  const firstDate = new Date(firstTicketAt);
  const lastDate = new Date(lastTicketAt);

  const isSameDay =
    firstDate.getFullYear() === lastDate.getFullYear() &&
    firstDate.getMonth() === lastDate.getMonth() &&
    firstDate.getDate() === lastDate.getDate();

  const firstFormatted = formatter.format(firstDate);
  if (isSameDay) return firstFormatted;

  return `${firstFormatted} \u2014 ${formatter.format(lastDate)}`;
};

const ActiveAttemptChip: React.FC<{ attempt: ClusterActiveAttemptSummary }> = ({
  attempt,
}) => {
  const config = attemptStatusConfig[attempt.status];
  const Icon = config.icon;
  return (
    <div className="flex items-center gap-1.5">
      <Badge
        variant="outline"
        className={cn("h-6 px-2.5 text-xs font-medium", config.badgeClassName)}
        title={`Intento #${attempt.attemptNumber} · ${config.label}`}
      >
        <Icon className={config.iconClassName} />
        Intento #{attempt.attemptNumber} · {config.label}
      </Badge>
      {attempt.prUrl && (
        <a
          href={attempt.prUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-hidden focus-visible:underline"
          aria-label={
            attempt.prNumber
              ? `Abrir PR #${attempt.prNumber} en una nueva pestaña`
              : "Abrir PR en una nueva pestaña"
          }
        >
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
          {attempt.prNumber ? `#${attempt.prNumber}` : "PR"}
        </a>
      )}
    </div>
  );
};

const RegressionChip: React.FC<{ context: ClusterIncidentContext }> = ({
  context,
}) => (
  <Badge
    variant="outline"
    className="h-6 px-2.5 text-xs font-medium bg-red-50 text-red-800 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800"
    title={
      context.lastRegressionAt
        ? `Última regresión: ${new Date(context.lastRegressionAt).toLocaleString("es")}`
        : undefined
    }
  >
    <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
    Regresión #{context.regressionCount}
  </Badge>
);

const LastChangeLine: React.FC<{ change: ClusterLastChangeSummary }> = ({
  change,
}) => {
  const fromLabel = change.fromStatus ? statusLabels[change.fromStatus] : null;
  const toLabel = statusLabels[change.toStatus];
  const relative = formatRelativeTime(change.changedAt);
  const triggeredBy = triggeredByLabels[change.triggeredByKind];
  return (
    <p className="text-xs text-muted-foreground">
      <span className="font-medium text-foreground/70">Último cambio:</span>{" "}
      {fromLabel ? (
        <span className="inline-flex items-center gap-1">
          <span>{fromLabel}</span>
          <ArrowRight className="inline h-3 w-3" aria-hidden="true" />
          <span>{toLabel}</span>
        </span>
      ) : (
        <span>{toLabel}</span>
      )}
      <span> · </span>
      <time
        dateTime={change.changedAt}
        title={new Date(change.changedAt).toLocaleString("es")}
      >
        {relative}
      </time>
      <span> · </span>
      <span>{triggeredBy}</span>
      {change.reason && (
        <>
          <span> · </span>
          <span className="italic">{formatReasonLabel(change.reason)}</span>
        </>
      )}
    </p>
  );
};

/**
 * Full-width hero for the cluster detail modal. Consolidates the old toolbar
 * header and the former "summary card" into a single information-dense area.
 *
 * Visual hierarchy:
 *  1. Title row — cluster title + lifecycle pill + item count.
 *  2. Summary paragraph — cluster description.
 *  3. Stats row — authors, ticket count, date range.
 *  4. Chips row — suggested type/priority, active attempt, regression.
 *  5. Last change line — compact transition summary.
 *  6. Actions — launch CTA on the right; close button floats top-right.
 */
export const ClusterDetailHero: React.FC<ClusterDetailHeroProps> = ({
  cluster,
  summary,
  stats,
  onLaunchInvestigation,
  onClose,
  canLaunch,
  isLaunching,
  onDismiss,
  canDismiss = false,
  timelineEvents,
  prUrl,
  now,
}) => {
  const { lifecyclePhase, status, activeAttempt, incident, lastChange } =
    summary;
  const effectiveNow = now ?? new Date();
  const showBanner = shouldShowPrMergedBanner({
    lastChange,
    currentStatus: status,
    now: effectiveNow,
  });
  const launchState = deriveLaunchButtonState(
    lifecyclePhase,
    activeAttempt !== null,
    canLaunch
  );

  const isRegression = incident.kind === "regression";
  const launchDisabled = launchState.disabledReason !== null || isLaunching;
  const dateRangeText = formatDateRange(stats.firstTicketAt, stats.lastTicketAt);

  const hasChipRow =
    Boolean(cluster.suggestedType) ||
    Boolean(cluster.suggestedPriority) ||
    activeAttempt !== null ||
    isRegression;

  return (
    <header className="relative border-b bg-muted/20">
      {/* Floating close button — absolute so it stays anchored top-right */}
      <DialogPrimitive.Close asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="absolute right-3 top-3 z-10 h-8 w-8 rounded-full opacity-70 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label="Cerrar"
        >
          <XIcon className="h-4 w-4" />
          <span className="sr-only">Cerrar</span>
        </Button>
      </DialogPrimitive.Close>

      <div className="flex flex-col gap-4 px-6 py-5 pr-14 lg:flex-row lg:items-start lg:justify-between lg:gap-8">
        {/* Left: content */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {/* Title row */}
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <DialogPrimitive.Title className="truncate text-2xl font-semibold tracking-tight">
              {cluster.title}
            </DialogPrimitive.Title>
            <ClusterStatusBadge status={status} size="lg" />
            <span className="shrink-0 text-sm text-muted-foreground">
              {cluster.itemCount}{" "}
              {cluster.itemCount === 1 ? "ticket" : "tickets"}
            </span>
          </div>

          {/* PR merged banner — 24h validation window */}
          {showBanner && lastChange && (
            <ClusterDetailPrMergedBanner
              mergedAt={lastChange.changedAt}
              prUrl={prUrl}
              now={effectiveNow}
            />
          )}

          {/* Summary */}
          {cluster.summary && (
            <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
              {cluster.summary}
            </p>
          )}

          {/* Stats row */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Users className="h-4 w-4" aria-hidden="true" />
              {stats.uniqueAuthors}{" "}
              {stats.uniqueAuthors === 1 ? "autor" : "autores"}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Hash className="h-4 w-4" aria-hidden="true" />
              {stats.ticketCount}{" "}
              {stats.ticketCount === 1 ? "ticket" : "tickets"}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="h-4 w-4" aria-hidden="true" />
              {dateRangeText}
            </span>
          </div>

          {/* Chips: suggestions + active attempt + regression */}
          {hasChipRow && (
            <div className="flex flex-wrap items-center gap-2">
              {cluster.suggestedType && (
                <Badge variant="outline" className="capitalize">
                  Tipo: {cluster.suggestedType.replace("_", " ")}
                </Badge>
              )}
              {cluster.suggestedPriority && (
                <Badge variant="outline" className="capitalize">
                  Prioridad: {cluster.suggestedPriority}
                </Badge>
              )}
              {activeAttempt && <ActiveAttemptChip attempt={activeAttempt} />}
              {isRegression && <RegressionChip context={incident} />}
            </div>
          )}

          {/* Last change line */}
          {lastChange && <LastChangeLine change={lastChange} />}

          {/* Integrated cluster timeline (collapsible, descending chronological) */}
          <ClusterDetailTimeline events={timelineEvents} now={effectiveNow} />
        </div>

        {/* Right: actions */}
        {(launchState.visible || (canDismiss && onDismiss)) && (
          <div className="flex shrink-0 flex-wrap items-start gap-2 lg:pt-1">
            {launchState.visible && (
              <Button
                variant={launchState.highlight ? "destructive" : "default"}
                size="sm"
                onClick={onLaunchInvestigation}
                disabled={launchDisabled}
                title={launchState.disabledReason ?? undefined}
                aria-label={launchState.label}
              >
                {isLaunching ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Rocket className="h-4 w-4" aria-hidden="true" />
                )}
                {launchState.label}
              </Button>
            )}
            {canDismiss && onDismiss && (
              <Button
                variant="destructive"
                size="sm"
                onClick={onDismiss}
                aria-label="Descartar cluster"
                title="Descartar cluster"
              >
                <XCircle className="h-4 w-4" aria-hidden="true" />
                Descartar
              </Button>
            )}
          </div>
        )}
      </div>
    </header>
  );
};
