import { useTranslations } from "next-intl";
import { AlertCircle, CheckCircle2, HelpCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AskConfidenceLevel } from "../../domain/types";

// ---------------------------------------------------------------------------
// Component: AskConfidenceBadge
// ---------------------------------------------------------------------------
// Displays the confidence level as a colored badge with icon.
// ---------------------------------------------------------------------------

export interface AskConfidenceBadgeProps {
  confidenceLevel: AskConfidenceLevel;
}

const confidenceClassNames: Record<AskConfidenceLevel, string> = {
  high: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  medium:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  low: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

const confidenceIcons: Record<AskConfidenceLevel, React.ReactNode> = {
  high: <CheckCircle2 className="size-3" />,
  medium: <AlertCircle className="size-3" />,
  low: <HelpCircle className="size-3" />,
};

export const AskConfidenceBadge: React.FC<AskConfidenceBadgeProps> = ({
  confidenceLevel,
}) => {
  const t = useTranslations("ask");

  return (
    <Badge
      variant="secondary"
      className={cn("gap-1 text-xs", confidenceClassNames[confidenceLevel])}
    >
      {confidenceIcons[confidenceLevel]}
      {t(`response.confidence.${confidenceLevel}`)}
    </Badge>
  );
};
