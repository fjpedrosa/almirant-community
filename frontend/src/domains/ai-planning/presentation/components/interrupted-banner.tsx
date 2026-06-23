import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface InterruptedBannerProps {
  reason: string;
  onResume: () => void;
  isResuming: boolean;
}

export const InterruptedBanner: React.FC<InterruptedBannerProps> = ({
  reason,
  onResume,
  isResuming,
}) => {
  const t = useTranslations("aiPlanning");

  const reasonLabel = t.has(`interrupted.reasons.${reason}`)
    ? t(`interrupted.reasons.${reason}`)
    : reason;

  return (
    <div className="mx-4 mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/30">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="flex-1 space-y-2">
          <p className="text-sm text-amber-800 dark:text-amber-200">
            {t("interrupted.message", { reason: reasonLabel })}
          </p>
          <Button
            className="min-h-[44px]"
            onClick={onResume}
            disabled={isResuming}
          >
            {t("interrupted.resumeButton")}
          </Button>
        </div>
      </div>
    </div>
  );
};
