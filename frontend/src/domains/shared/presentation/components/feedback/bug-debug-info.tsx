"use client";

import { useTranslations } from "next-intl";
import { format } from "date-fns";
import {
  Monitor,
  Globe,
  Terminal,
  Image as ImageIcon,
  ExternalLink,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { feedbackApi } from "@/lib/api/client";
// Local declaration keeps the strong `TraceSinkEntry[]` narrowing on
// `traceSink`. The structurally-compatible shared declaration lives at
// `@almirant/shared/debug-context` and is the wire-shape source of truth
// for backend consumers. Keep both in sync when adding fields.
import type { DebugContext } from "@/domains/feedback/domain/types";

interface BugDebugInfoProps {
  debugContext: DebugContext;
  /**
   * Identifier of the owning feedback item. Used to resolve the screenshot
   * via `GET /api/feedback-items/:id/screenshot`, which enforces access
   * based on feedback-item ownership (admin OR author) rather than the
   * uploader's active organization (see A-1906).
   */
  feedbackItemId: string;
}

const MAX_USER_AGENT_LENGTH = 60;

const truncateUserAgent = (userAgent: string): string => {
  if (userAgent.length <= MAX_USER_AGENT_LENGTH) return userAgent;
  return `${userAgent.slice(0, MAX_USER_AGENT_LENGTH)}...`;
};

const formatTimestamp = (timestamp: string): string => {
  try {
    return format(new Date(timestamp), "d MMM yyyy, HH:mm:ss");
  } catch {
    return timestamp;
  }
};

export const BugDebugInfo: React.FC<BugDebugInfoProps> = ({
  debugContext,
  feedbackItemId,
}) => {
  const t = useTranslations("feedback");

  const {
    screenshotUrl,
    screenshotKey,
    userAgent,
    viewportWidth,
    viewportHeight,
    devicePixelRatio,
    platform,
    browser,
    os,
    architecture,
    language,
    pathname,
    pageUrl,
    timestamp,
    consoleErrors,
  } = debugContext;

  // Resolve screenshots via the feedback-item-scoped endpoint so admins can
  // view screenshots uploaded by other users. The endpoint handles both new
  // items (metadata.screenshotKey) and legacy items (metadata.screenshotUrl).
  const hasScreenshot = Boolean(screenshotKey) || Boolean(screenshotUrl);
  const resolvedScreenshotUrl = hasScreenshot
    ? feedbackApi.buildScreenshotUrl(feedbackItemId)
    : null;

  return (
    <div className="space-y-4">
      <h4 className="text-sm font-medium flex items-center gap-2">
        <Terminal className="h-4 w-4" />
        {t("detail.debugInfo")}
      </h4>

      {/* Screenshot */}
      <div className="space-y-2">
        <h5 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <ImageIcon className="h-3 w-3" />
          {t("detail.screenshot")}
        </h5>
        {resolvedScreenshotUrl ? (
          <a
            href={resolvedScreenshotUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block relative group overflow-hidden rounded-md border bg-muted/30"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- Feedback screenshot served via backend auth endpoint */}
            <img
              src={resolvedScreenshotUrl}
              alt="Screenshot"
              className="w-full h-auto max-h-48 object-contain"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
              <ExternalLink className="h-5 w-5 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-md" />
            </div>
          </a>
        ) : (
          <div className="flex items-center justify-center h-24 rounded-md border border-dashed bg-muted/30 text-muted-foreground text-sm">
            {t("detail.noScreenshot")}
          </div>
        )}
      </div>

      <Separator />

      {/* Browser Info */}
      <div className="space-y-2">
        <h5 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <Monitor className="h-3 w-3" />
          {t("detail.browserInfo")}
        </h5>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <div>
            <span className="text-muted-foreground">{t("detail.browser")}</span>
            <p className="font-medium">{browser || "-"}</p>
          </div>
          <div>
            <span className="text-muted-foreground">{t("detail.os")}</span>
            <p className="font-medium">{os || platform || "-"}</p>
          </div>
          <div>
            <span className="text-muted-foreground">{t("detail.architecture")}</span>
            <p className="font-mono">{architecture || "-"}</p>
          </div>
          <div>
            <span className="text-muted-foreground">{t("detail.viewport")}</span>
            <p className="font-mono">
              {viewportWidth}x{viewportHeight} @{devicePixelRatio}x
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">{t("detail.language")}</span>
            <p className="font-medium">{language || "-"}</p>
          </div>
          <div className="col-span-2">
            <span className="text-muted-foreground">{t("detail.userAgent")}</span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <p className="font-mono text-[11px] truncate cursor-help">
                    {truncateUserAgent(userAgent)}
                  </p>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-md">
                  <p className="font-mono text-xs break-all">{userAgent}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </div>

      <Separator />

      {/* Page Context */}
      <div className="space-y-2">
        <h5 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <Globe className="h-3 w-3" />
          {t("detail.pageContext")}
        </h5>
        <div className="space-y-2 text-xs">
          <div>
            <span className="text-muted-foreground">{t("detail.route")}</span>
            <p className="font-mono">{pathname}</p>
          </div>
          <div>
            <span className="text-muted-foreground">{t("detail.url")}</span>
            <p className="font-mono text-[11px] break-all">{pageUrl}</p>
          </div>
          <div>
            <span className="text-muted-foreground">{t("detail.timestamp")}</span>
            <p className="font-medium">{formatTimestamp(timestamp)}</p>
          </div>
        </div>
      </div>

      <Separator />

      {/* Console Errors */}
      <div className="space-y-2">
        <h5 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <Terminal className="h-3 w-3" />
          {t("detail.consoleErrors")}
        </h5>
        {consoleErrors.length > 0 ? (
          <div className="rounded-md border bg-muted/30 p-2 max-h-32 overflow-y-auto">
            <ul className="space-y-1">
              {consoleErrors.map((error, index) => (
                <li
                  key={index}
                  className="font-mono text-[11px] text-destructive break-all"
                >
                  {error}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic">
            {t("detail.noErrors")}
          </p>
        )}
      </div>
    </div>
  );
};
