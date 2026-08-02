"use client";

import { useState } from "react";
import {
  Loader2,
  Wrench,
  GitMerge,
  GitPullRequest,
  XCircle,
  Rocket,
  ExternalLink,
  ChevronDown,
  CheckCircle2,
  AlertTriangle,
  Circle,
  Hourglass,
  MessageSquare,
  Ban,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { parseSolutionProposed } from "../../domain/proposed-solution";
import { ProposedSolutionRenderer } from "./proposed-solution-renderer";
import type {
  BugFixAttemptPrSummary,
  BugFixAttemptStatus,
  BugFixAttemptSummary,
} from "../../domain/types";

export interface ClusterLiveStatusPaneProps {
  attempts: BugFixAttemptSummary[];
  activeAttempt: BugFixAttemptSummary | null;
  onLaunchInvestigation?: () => void;
  canLaunch?: boolean;
  isLaunching?: boolean;
  onOpenAgentRun?: (jobId: string) => void;
  /**
   * Abort the active investigation. When provided together with `canAbort`,
   * the active attempt card surfaces a destructive CTA so operators can
   * rescue stuck clusters (A-1934).
   */
  onAbort?: () => void;
  canAbort?: boolean;
  isAborting?: boolean;
}

// ---------------------------------------------------------------------------
// Status visuals
// ---------------------------------------------------------------------------

interface AttemptStatusVisual {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  iconSpin: boolean;
  badgeClass: string;
  ringClass: string;
  iconClass: string;
}

const ATTEMPT_STATUS_VISUAL: Record<BugFixAttemptStatus, AttemptStatusVisual> = {
  analyzing: {
    label: "Analizando causa raíz",
    icon: Loader2,
    iconSpin: true,
    badgeClass:
      "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800",
    ringClass:
      "bg-amber-50 ring-amber-200 dark:bg-amber-900/30 dark:ring-amber-800",
    iconClass: "text-amber-600 dark:text-amber-300",
  },
  proposed: {
    label: "Solución propuesta",
    icon: Wrench,
    iconSpin: false,
    badgeClass:
      "bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800",
    ringClass:
      "bg-blue-50 ring-blue-200 dark:bg-blue-900/30 dark:ring-blue-800",
    iconClass: "text-blue-600 dark:text-blue-300",
  },
  implementing: {
    label: "Implementando fix",
    icon: Loader2,
    iconSpin: true,
    badgeClass:
      "bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-800",
    ringClass:
      "bg-indigo-50 ring-indigo-200 dark:bg-indigo-900/30 dark:ring-indigo-800",
    iconClass: "text-indigo-600 dark:text-indigo-300",
  },
  merged: {
    label: "PR mergeado",
    icon: GitMerge,
    iconSpin: false,
    badgeClass:
      "bg-green-50 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800",
    ringClass:
      "bg-green-50 ring-green-200 dark:bg-green-900/30 dark:ring-green-800",
    iconClass: "text-green-600 dark:text-green-300",
  },
  failed: {
    label: "Intento fallido",
    icon: XCircle,
    iconSpin: false,
    badgeClass:
      "bg-red-50 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800",
    ringClass:
      "bg-red-50 ring-red-200 dark:bg-red-900/30 dark:ring-red-800",
    iconClass: "text-red-600 dark:text-red-300",
  },
};

const ACTIVE_STATUSES: BugFixAttemptStatus[] = [
  "analyzing",
  "proposed",
  "implementing",
];

const PR_STATE_LABEL: Record<
  NonNullable<BugFixAttemptPrSummary["state"]>,
  { label: string; icon: React.ComponentType<{ className?: string }>; cls: string }
> = {
  open: {
    label: "Abierto",
    icon: GitPullRequest,
    cls: "text-emerald-600 dark:text-emerald-300",
  },
  merged: {
    label: "Mergeado",
    icon: GitMerge,
    cls: "text-violet-600 dark:text-violet-300",
  },
  closed: {
    label: "Cerrado",
    icon: XCircle,
    cls: "text-red-600 dark:text-red-300",
  },
};

const REVIEW_STATE_LABEL: Record<
  NonNullable<BugFixAttemptPrSummary["reviewStatus"]>,
  { label: string; icon: React.ComponentType<{ className?: string }>; cls: string }
> = {
  pending: { label: "Pendiente", icon: Hourglass, cls: "text-muted-foreground" },
  approved: {
    label: "Aprobado",
    icon: CheckCircle2,
    cls: "text-green-600 dark:text-green-300",
  },
  changes_requested: {
    label: "Cambios pedidos",
    icon: AlertTriangle,
    cls: "text-amber-600 dark:text-amber-300",
  },
  commented: { label: "Comentado", icon: Circle, cls: "text-muted-foreground" },
  dismissed: { label: "Descartado", icon: XCircle, cls: "text-muted-foreground" },
};

const CI_STATE_LABEL: Record<
  NonNullable<BugFixAttemptPrSummary["ciStatus"]>,
  { label: string; icon: React.ComponentType<{ className?: string }>; cls: string }
> = {
  pending: { label: "Pendiente", icon: Hourglass, cls: "text-muted-foreground" },
  queued: { label: "En cola", icon: Hourglass, cls: "text-muted-foreground" },
  in_progress: {
    label: "En curso",
    icon: Loader2,
    cls: "text-blue-600 dark:text-blue-300 animate-spin",
  },
  success: {
    label: "OK",
    icon: CheckCircle2,
    cls: "text-green-600 dark:text-green-300",
  },
  failure: {
    label: "Fallido",
    icon: XCircle,
    cls: "text-red-600 dark:text-red-300",
  },
  cancelled: {
    label: "Cancelado",
    icon: XCircle,
    cls: "text-muted-foreground",
  },
  skipped: { label: "Omitido", icon: Circle, cls: "text-muted-foreground" },
  neutral: { label: "Neutral", icon: Circle, cls: "text-muted-foreground" },
};

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

const formatRelative = (iso: string): string => {
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
  const pick = (value: number, unit: Intl.RelativeTimeFormatUnit): string =>
    rtf.format(Math.round(value), unit);

  if (absMs < minute) return pick(diffMs / 1000, "second");
  if (absMs < hour) return pick(diffMs / minute, "minute");
  if (absMs < day) return pick(diffMs / hour, "hour");
  if (absMs < week) return pick(diffMs / day, "day");
  if (absMs < month) return pick(diffMs / week, "week");
  if (absMs < year) return pick(diffMs / month, "month");
  return pick(diffMs / year, "year");
};

// ---------------------------------------------------------------------------
// PR mini section
// ---------------------------------------------------------------------------

const PrSection: React.FC<{
  prNumber: number | null;
  prUrl: string | null;
  pr: BugFixAttemptPrSummary | null;
}> = ({ prNumber, prUrl, pr }) => {
  if (!prUrl && !prNumber && !pr) return null;

  const state = pr?.state ?? null;
  const stateVisual = state ? PR_STATE_LABEL[state] : null;
  const StateIcon = stateVisual?.icon;

  const reviewVisual = pr?.reviewStatus
    ? REVIEW_STATE_LABEL[pr.reviewStatus]
    : null;
  const ReviewIcon = reviewVisual?.icon;

  const ciVisual = pr?.ciStatus ? CI_STATE_LABEL[pr.ciStatus] : null;
  const CiIcon = ciVisual?.icon;

  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <GitPullRequest
            className="h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <span className="text-sm font-medium truncate">
            {prNumber ? `PR #${prNumber}` : "Pull request"}
          </span>
          {stateVisual && StateIcon && (
            <Badge
              variant="outline"
              className={cn("h-5 px-1.5 text-[11px] capitalize", stateVisual.cls)}
            >
              <StateIcon className="mr-1 h-3 w-3" aria-hidden="true" />
              {stateVisual.label}
            </Badge>
          )}
        </div>
        {prUrl && (
          <a
            href={prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            Ver PR
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        )}
      </div>

      {(reviewVisual || ciVisual) && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          {reviewVisual && ReviewIcon && (
            <div className="flex items-center gap-1.5">
              <ReviewIcon
                className={cn("h-3.5 w-3.5", reviewVisual.cls)}
                aria-hidden="true"
              />
              <span className="text-muted-foreground">Review:</span>
              <span className="font-medium">{reviewVisual.label}</span>
            </div>
          )}
          {ciVisual && CiIcon && (
            <div className="flex items-center gap-1.5">
              <CiIcon
                className={cn("h-3.5 w-3.5 shrink-0", ciVisual.cls)}
                aria-hidden="true"
              />
              <span className="text-muted-foreground">CI:</span>
              <span className="font-medium">{ciVisual.label}</span>
            </div>
          )}
        </div>
      )}

      {pr?.mergedAt && (
        <p className="text-xs text-muted-foreground">
          Mergeado {formatRelative(pr.mergedAt)}
        </p>
      )}
      {pr?.closedAt && !pr.mergedAt && (
        <p className="text-xs text-muted-foreground">
          Cerrado {formatRelative(pr.closedAt)}
        </p>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Solution proposed block — parses the JSON payload and falls back to the
// raw string when the payload does not match the canonical schema.
// ---------------------------------------------------------------------------

const SolutionProposedBlock: React.FC<{ raw: string }> = ({ raw }) => {
  const parsed = parseSolutionProposed(raw);
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Solución propuesta
      </p>
      {parsed ? (
        <ProposedSolutionRenderer solution={parsed} />
      ) : (
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{raw}</p>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Attempt card (hero-style for the active or most-recent attempt)
// ---------------------------------------------------------------------------

const AttemptCard: React.FC<{
  attempt: BugFixAttemptSummary;
  emphasis: "active" | "finished";
  onOpenAgentRun?: (jobId: string) => void;
  onAbort?: () => void;
  canAbort?: boolean;
  isAborting?: boolean;
}> = ({ attempt, emphasis, onOpenAgentRun, onAbort, canAbort, isAborting }) => {
  const visual = ATTEMPT_STATUS_VISUAL[attempt.status];
  const Icon = visual.icon;
  const showAbort = emphasis === "active" && Boolean(onAbort) && Boolean(canAbort);

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3 shadow-sm">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-1",
            visual.ringClass
          )}
        >
          <Icon
            className={cn(
              "h-5 w-5",
              visual.iconClass,
              visual.iconSpin && "animate-spin"
            )}
            aria-hidden="true"
          />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{visual.label}</h3>
            <Badge
              variant="outline"
              className={cn("h-5 px-1.5 text-[11px]", visual.badgeClass)}
            >
              Intento #{attempt.attemptNumber}
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {emphasis === "active" ? "Iniciado " : "Último update "}
            {formatRelative(attempt.createdAt)}
          </p>
        </div>

        {attempt.agentJobId && onOpenAgentRun && (
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 gap-1.5 h-8"
            onClick={() => onOpenAgentRun(attempt.agentJobId as string)}
            aria-label="Ver transcripción del agente"
          >
            <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
            Ver agente
          </Button>
        )}
      </div>

      {showAbort && (
        <Button
          size="sm"
          variant="destructive"
          className="w-full gap-1.5"
          onClick={onAbort}
          disabled={isAborting}
          aria-label="Abortar investigación activa"
        >
          {isAborting ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Ban className="h-4 w-4" aria-hidden="true" />
          )}
          Abortar y resetear
        </Button>
      )}

      {attempt.rootCause && (
        <div className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Causa raíz
          </p>
          <p className="text-sm leading-relaxed">{attempt.rootCause}</p>
        </div>
      )}

      {attempt.solutionProposed && (
        <SolutionProposedBlock raw={attempt.solutionProposed} />
      )}

      <PrSection
        prNumber={attempt.fixPrNumber}
        prUrl={attempt.fixPrUrl}
        pr={attempt.pr}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

const EmptyState: React.FC<{
  onLaunch?: () => void;
  canLaunch?: boolean;
  isLaunching?: boolean;
}> = ({ onLaunch, canLaunch, isLaunching }) => (
  <div className="rounded-lg border border-dashed bg-muted/20 p-6 text-center space-y-3">
    <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-muted">
      <Rocket className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
    </div>
    <div className="space-y-1">
      <p className="text-sm font-medium">Sin investigación activa</p>
      <p className="text-xs text-muted-foreground">
        Lanza una investigación para que un agente analice la causa raíz y
        proponga un fix.
      </p>
    </div>
    {onLaunch && (
      <Button
        size="sm"
        onClick={onLaunch}
        disabled={!canLaunch || isLaunching}
        className="w-full"
      >
        {isLaunching ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Rocket className="h-4 w-4" aria-hidden="true" />
        )}
        Lanzar investigación
      </Button>
    )}
  </div>
);

// ---------------------------------------------------------------------------
// Past attempts list (collapsed)
// ---------------------------------------------------------------------------

const PastAttemptsList: React.FC<{
  attempts: BugFixAttemptSummary[];
  onOpenAgentRun?: (jobId: string) => void;
}> = ({ attempts, onOpenAgentRun }) => {
  const [open, setOpen] = useState(false);

  if (attempts.length === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={cn(
            "group flex w-full items-center justify-between rounded-md px-3 py-2 text-left",
            "transition-colors hover:bg-muted/60 cursor-pointer",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          )}
        >
          <span className="text-sm font-medium">
            Intentos previos ({attempts.length})
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform duration-200",
              open && "rotate-180"
            )}
            aria-hidden="true"
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0">
        <ul className="mt-1 space-y-1">
          {attempts.map((a) => {
            const visual = ATTEMPT_STATUS_VISUAL[a.status];
            const Icon = visual.icon;
            return (
              <li
                key={a.id}
                className="flex items-center gap-2 rounded-md border bg-card/50 px-3 py-2 text-xs"
              >
                <Icon
                  className={cn("h-3.5 w-3.5", visual.iconClass)}
                  aria-hidden="true"
                />
                <span className="flex-1 truncate">
                  Intento #{a.attemptNumber} · {visual.label}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {formatRelative(a.createdAt)}
                </span>
                {a.agentJobId && onOpenAgentRun && (
                  <button
                    type="button"
                    onClick={() => onOpenAgentRun(a.agentJobId as string)}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label="Ver transcripción del agente"
                  >
                    <MessageSquare className="h-3 w-3" aria-hidden="true" />
                  </button>
                )}
                {a.fixPrUrl && (
                  <a
                    href={a.fixPrUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label="Abrir PR"
                  >
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
};

// ---------------------------------------------------------------------------
// Pane
// ---------------------------------------------------------------------------

/**
 * Right column of the cluster detail modal. Surfaces the "what's happening
 * right now" state for the cluster: active bug-fix attempt with live agent
 * progress + PR status, or the outcome of the most recent attempt, or an
 * empty state with a CTA to launch an investigation. Past attempts live in
 * a collapsed accordion below.
 */
export const ClusterLiveStatusPane: React.FC<ClusterLiveStatusPaneProps> = ({
  attempts,
  activeAttempt,
  onLaunchInvestigation,
  canLaunch,
  isLaunching,
  onOpenAgentRun,
  onAbort,
  canAbort,
  isAborting,
}) => {
  // If the summary didn't surface one, fall back to the first attempt in an
  // active status from the full list.
  const fallbackActive =
    activeAttempt ??
    attempts.find((a) => ACTIVE_STATUSES.includes(a.status)) ??
    null;

  const mostRecent = attempts[0] ?? null;
  const highlight = fallbackActive ?? mostRecent;
  const pastAttempts = highlight
    ? attempts.filter((a) => a.id !== highlight.id)
    : attempts;

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden">
      <div className="flex shrink-0 items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-muted-foreground">
          Estado en vivo
        </h3>
        {fallbackActive && (
          <span
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
            title="Hay un intento activo"
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            En curso
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {highlight ? (
          <AttemptCard
            attempt={highlight}
            emphasis={fallbackActive ? "active" : "finished"}
            onOpenAgentRun={onOpenAgentRun}
            onAbort={onAbort}
            canAbort={canAbort}
            isAborting={isAborting}
          />
        ) : (
          <EmptyState
            onLaunch={onLaunchInvestigation}
            canLaunch={canLaunch}
            isLaunching={isLaunching}
          />
        )}

        <PastAttemptsList
          attempts={pastAttempts}
          onOpenAgentRun={onOpenAgentRun}
        />
      </div>
    </div>
  );
};
