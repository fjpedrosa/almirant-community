import { useTranslations } from "next-intl";
import { Info, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import type { SetupCompletionBannerProps } from "../../domain/types";

export const SetupCompletionBanner = ({
  pendingSteps,
  onGoToOnboarding,
  onDismiss,
}: SetupCompletionBannerProps) => {
  const t = useTranslations("onboarding.banner");

  return (
    <Alert className="border-blue-500/50 bg-blue-50 text-blue-900 dark:bg-blue-950/30 dark:text-blue-200 relative">
      <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
      <AlertDescription className="flex items-center justify-between gap-4">
        <span>
          {t("message", { count: pendingSteps })}{" "}
          <Link
            href="/onboarding"
            onClick={(e) => {
              e.preventDefault();
              onGoToOnboarding();
            }}
            className="font-medium underline underline-offset-2 hover:no-underline"
          >
            {t("action")}
          </Link>
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200"
          onClick={onDismiss}
        >
          <X className="h-4 w-4" />
        </Button>
      </AlertDescription>
    </Alert>
  );
};
