import { useTranslations } from "next-intl";
import { RotateCcw, Loader2, Plus, AlertCircle, Clock, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SessionEndedBannerProps {
  onRestart: () => void;
  onNewSession?: () => void;
  isRestarting: boolean;
  reason?: string | null;
}

const reasonIcons: Record<string, React.ElementType> = {
  no_items_created: AlertCircle,
  idle_timeout: Clock,
  killed_by_user: XCircle,
};

export const SessionEndedBanner: React.FC<SessionEndedBannerProps> = ({
  onRestart,
  onNewSession,
  isRestarting,
  reason,
}) => {
  const t = useTranslations("aiPlanning.sessionEnded");
  const Icon = (reason && reasonIcons[reason]) || AlertCircle;

  const messageKey = reason === "no_items_created"
    ? "noItems"
    : reason === "idle_timeout"
      ? "idleTimeout"
      : reason === "killed_by_user"
        ? "killedByUser"
        : "default";

  // Primary action depends on reason:
  // - no_items_created / idle_timeout: retry (resume session)
  // - killed_by_user: new session (user intentionally stopped)
  // - default: retry
  const showRetry = reason !== "killed_by_user";
  const showNewSession = !!onNewSession;

  return (
    <div className="px-4 py-4 shrink-0" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
      <div className="max-w-3xl mx-auto flex flex-col items-center gap-3 rounded-2xl border border-border bg-muted/40 p-5">
        <Icon className="size-5 text-muted-foreground" />
        <p className="text-sm text-muted-foreground text-center">
          {t(messageKey)}
        </p>
        <div className="flex items-center gap-2">
          {showRetry && (
            <Button
              onClick={onRestart}
              disabled={isRestarting}
              className="min-h-[44px] gap-2"
            >
              {isRestarting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t("restarting")}
                </>
              ) : (
                <>
                  <RotateCcw className="size-4" />
                  {t("retry")}
                </>
              )}
            </Button>
          )}
          {showNewSession && (
            <Button
              variant={showRetry ? "outline" : "default"}
              onClick={onNewSession}
              disabled={isRestarting}
              className="min-h-[44px] gap-2"
            >
              <Plus className="size-4" />
              {t("newSession")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
