"use client";

import { useLocale, useTranslations } from "next-intl";
import { format } from "date-fns";
import { enUS, es } from "date-fns/locale";
import { MessageSquare, User, Calendar, ExternalLink, GitBranch, Hash } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BugDebugInfo } from "@/domains/shared/presentation/components/feedback";
import { FeedbackStatusSelect } from "./feedback-status-select";
import { IncidentBundleInspector } from "./incident-bundle-inspector";
import type { IncidentBundleInspectorProps } from "./incident-bundle-inspector";
import { BugFixAttemptStatusBadge } from "@/domains/shared/presentation/components/bug-fix-attempt-status-badge";
import { FeedbackCommentsSectionContainer } from "../containers/feedback-comments-section-container";
import { useFeedbackTraceability } from "../../application/hooks/use-feedback-traceability";
import type {
  FeedbackItem,
  FeedbackStatus,
  DebugContext,
  FeedbackBugFixAttempt,
  BugFixAttemptPrState,
  BugFixAttemptPrCiStatus,
  BugFixAttemptPrReviewStatus,
} from "../../domain/types";
import type { FeedbackMentionMemberSource } from "../../application/mention-member-source";

interface FeedbackDetailPanelProps {
  item: FeedbackItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUserId?: string | null;
  onStatusChange?: (id: string, status: FeedbackStatus) => void;
  incidentBundle?: IncidentBundleInspectorProps | null;
  mentionMemberSource?: FeedbackMentionMemberSource;
}

const STATUS_VARIANT_MAP: Record<
  FeedbackStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  new: "default",
  triaged: "secondary",
  in_progress: "default",
  pending_validation: "outline",
  implementing: "default",
  deployed: "secondary",
  verified: "outline",
  cancelled: "destructive",
};

const PR_STATE_CLASS: Record<BugFixAttemptPrState, string> = {
  open: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800",
  closed: "bg-muted text-muted-foreground border-border",
  merged: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-900/30 dark:text-violet-400 dark:border-violet-800",
};

const PR_CI_CLASS: Record<BugFixAttemptPrCiStatus, string> = {
  success: "text-green-600 dark:text-green-400",
  failure: "text-red-600 dark:text-red-400",
  in_progress: "text-blue-600 dark:text-blue-400",
  pending: "text-yellow-600 dark:text-yellow-400",
  queued: "text-yellow-600 dark:text-yellow-400",
  cancelled: "text-muted-foreground",
  skipped: "text-muted-foreground",
  neutral: "text-muted-foreground",
};

const PR_REVIEW_CLASS: Record<BugFixAttemptPrReviewStatus, string> = {
  approved: "text-green-600 dark:text-green-400",
  changes_requested: "text-red-600 dark:text-red-400",
  pending: "text-muted-foreground",
  commented: "text-yellow-600 dark:text-yellow-400",
  dismissed: "text-muted-foreground",
};

const resolveDateLocale = (locale: string) =>
  locale.startsWith("es") ? es : enUS;

const formatDate = (dateStr: string, locale: string): string => {
  try {
    const date = new Date(dateStr);
    return format(date, "d MMM yyyy, HH:mm", { locale: resolveDateLocale(locale) });
  } catch {
    return dateStr;
  }
};

/**
 * Extracts DebugContext from metadata if present, otherwise returns null.
 * We check for the presence of userAgent field which is unique to DebugContext.
 */
const extractDebugContext = (
  metadata: Record<string, unknown>
): DebugContext | null => {
  if (
    typeof metadata === "object" &&
    metadata !== null &&
    "userAgent" in metadata &&
    typeof metadata.userAgent === "string"
  ) {
    return metadata as unknown as DebugContext;
  }
  return null;
};

// BugFix section — always rendered for category === "bug", even when 0 attempts.
const BugFixSection: React.FC<{ attempts: FeedbackBugFixAttempt[] }> = ({
  attempts,
}) => {
  const t = useTranslations("feedback");
  const latest = attempts[0] ?? null;
  const previous = attempts.slice(1);

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium">{t("bugFix.title")}</h4>

      {!latest && (
        <p className="text-sm text-muted-foreground italic">
          {t("bugFix.empty")}
        </p>
      )}

      {latest && (
        <div className="space-y-2">
          {/* Latest attempt header */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">
              {t("bugFix.attemptLabel", { number: latest.attemptNumber })}
            </span>
            <BugFixAttemptStatusBadge status={latest.status} />
          </div>

          {/* PR info */}
          {latest.fixPrUrl && latest.pr && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground">PR #{latest.fixPrNumber}</span>
                <Badge
                  variant="outline"
                  className={`text-xs font-medium ${PR_STATE_CLASS[latest.pr.state]}`}
                >
                  {t(`bugFix.pr.state.${latest.pr.state}`)}
                </Badge>
              </div>
              <div className="flex items-center gap-3 text-xs flex-wrap">
                <span className={PR_CI_CLASS[latest.pr.ciStatus]}>
                  {t(`bugFix.pr.ci.${latest.pr.ciStatus}`)}
                </span>
                <span className={PR_REVIEW_CLASS[latest.pr.reviewStatus]}>
                  {t(`bugFix.pr.review.${latest.pr.reviewStatus}`)}
                </span>
              </div>
              <a
                href={latest.fixPrUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                {t("bugFix.openPr")}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}

          {latest.fixPrUrl && !latest.pr && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{t("bugFix.prNotSynced")}</span>
              <a
                href={latest.fixPrUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                PR #{latest.fixPrNumber ?? ""}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}

          {!latest.fixPrUrl && (
            <p className="text-xs text-muted-foreground">
              {t("bugFix.prNotCreated")}
            </p>
          )}

          {/* Branch */}
          {latest.fixBranch && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <GitBranch className="h-3 w-3 shrink-0" />
              <code className="font-mono truncate">{latest.fixBranch}</code>
            </div>
          )}

          {/* Failure reason */}
          {latest.status === "failed" && latest.failureReason && (
            <div className="rounded border border-red-200 bg-red-50 p-2 dark:border-red-800 dark:bg-red-900/20">
              <p className="text-xs font-medium text-red-700 dark:text-red-400 mb-0.5">
                {t("bugFix.failureReason")}
              </p>
              <p className="text-xs text-red-600 dark:text-red-300 line-clamp-3">
                {latest.failureReason}
              </p>
            </div>
          )}

          {/* History */}
          {previous.length > 0 && (
            <div className="space-y-1 pt-1 border-t">
              <p className="text-xs text-muted-foreground font-medium">
                {t("bugFix.history")}
              </p>
              {previous.map((attempt) => (
                <div key={attempt.id} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {t("bugFix.attemptLabel", { number: attempt.attemptNumber })}
                  </span>
                  <BugFixAttemptStatusBadge status={attempt.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const FeedbackDetailPanel: React.FC<FeedbackDetailPanelProps> = ({
  item,
  open,
  onOpenChange,
  currentUserId = null,
  onStatusChange,
  incidentBundle = null,
  mentionMemberSource,
}) => {
  const t = useTranslations("feedback");
  const locale = useLocale();

  const { data: traceability } = useFeedbackTraceability(item?.id ?? null);

  if (!item) {
    return null;
  }

  const authorDisplay = item.authorName || t("detail.anonymous");
  const debugContext = item.category === "bug" ? extractDebugContext(item.metadata) : null;
  const bugFixAttempts = traceability?.bugFixAttempts ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:w-[520px] sm:max-w-[520px] p-0 flex flex-col"
      >
        {/* Header */}
        <SheetHeader className="p-4 pb-3 shrink-0 border-b">
          <div className="flex items-start gap-3 pr-8">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border bg-muted">
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <SheetTitle className="text-base leading-tight line-clamp-2">
                {item.title}
              </SheetTitle>
              <SheetDescription className="sr-only">
                {t("detail.title")}
              </SheetDescription>
              {/* Badges + ID */}
              <div className="flex flex-wrap items-center gap-2">
                {onStatusChange ? (
                  <FeedbackStatusSelect
                    value={item.status}
                    onValueChange={(status) => onStatusChange(item.id, status)}
                  />
                ) : (
                  <Badge variant={STATUS_VARIANT_MAP[item.status]}>
                    {t(`statuses.${item.status}`)}
                  </Badge>
                )}
                <Badge variant="outline">
                  {t(`categories.${item.category}`)}
                </Badge>
                <span
                  className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground"
                  title={item.id}
                >
                  <Hash className="h-3 w-3" />
                  {item.id.slice(0, 8)}
                </span>
              </div>
            </div>
          </div>
        </SheetHeader>

        {/* Tabs */}
        <Tabs defaultValue="details" className="flex flex-1 flex-col min-h-0">
          <TabsList className="mx-4 mt-3 mb-0 w-auto justify-start shrink-0 rounded-md bg-muted/60 h-9">
            <TabsTrigger value="details" className="text-xs">
              {t("detail.tabDetails")}
            </TabsTrigger>
            <TabsTrigger value="comments" className="text-xs">
              {t("detail.tabComments")}
            </TabsTrigger>
          </TabsList>

          {/* Details tab */}
          <TabsContent
            value="details"
            className="flex-1 min-h-0 mt-0 data-[state=inactive]:hidden"
          >
            <ScrollArea className="h-full w-full">
              <div className="p-4 space-y-4">
                {/* Author and date */}
                <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <User className="h-3 w-3" />
                    {authorDisplay}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Calendar className="h-3 w-3" />
                    {formatDate(item.createdAt, locale)}
                  </span>
                </div>

                {item.authorEmail && (
                  <p className="text-xs text-muted-foreground">
                    {item.authorEmail}
                  </p>
                )}

                <Separator />

                {/* Content */}
                <div className="space-y-2">
                  <h4 className="text-sm font-medium">{t("detail.content")}</h4>
                  {item.content ? (
                    <p className="text-sm whitespace-pre-wrap">{item.content}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">-</p>
                  )}
                </div>

                {/* Bug fix section — always shown for category === "bug" */}
                {item.category === "bug" && (
                  <>
                    <Separator />
                    <BugFixSection attempts={bugFixAttempts} />
                  </>
                )}

                {item.category === "bug" && incidentBundle && (
                  <>
                    <Separator />
                    <IncidentBundleInspector {...incidentBundle} />
                  </>
                )}

                {/* Debug info for bugs with debug context */}
                {debugContext && (
                  <>
                    <Separator />
                    <BugDebugInfo
                      debugContext={debugContext}
                      feedbackItemId={item.id}
                    />
                  </>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* Comments tab */}
          <TabsContent
            value="comments"
            className="flex-1 min-h-0 mt-0 data-[state=inactive]:hidden overflow-hidden"
          >
            <FeedbackCommentsSectionContainer
              feedbackItemId={item.id}
              currentUserId={currentUserId}
              mentionMemberSource={mentionMemberSource}
            />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
};
